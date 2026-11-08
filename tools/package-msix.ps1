# Creates an unsigned Microsoft Store upload. Does not install or publish it.
[CmdletBinding()]
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath "$repoRoot/apps/desktop/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
if ($config.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a three-part application version.' }
$packageVersion = "$($config.version).0"
$sdkRoot = "${env:ProgramFiles(x86)}/Windows Kits/10/bin"
$sdk = Get-ChildItem -LiteralPath $sdkRoot -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath "$($_.FullName)/x64/makeappx.exe") } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $sdk) { throw 'Install Windows SDK with x64 MakeAppx.exe first.' }
$makeAppx = Join-Path $sdk.FullName 'x64/makeappx.exe'

Push-Location $repoRoot
try {
    if (-not $SkipBuild) {
        $env:Path = "$env:USERPROFILE/.cargo/bin;$env:Path"
        & pnpm --dir apps/desktop tauri build --no-bundle
        if ($LASTEXITCODE -ne 0) { throw 'Tauri release build failed.' }
    }

    # Fresh allowlisted staging prevents local state and obsolete helpers entering the upload.
    $output = Join-Path $repoRoot 'target/release/bundle/msix'
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $stage = Join-Path $output ("staging-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path "$stage/Assets", "$stage/helpers", "$stage/licenses" -Force | Out-Null
    $payload = @{
        'target/release/conxol.exe' = 'conxol.exe'
        'apps/desktop/src-tauri/helpers/conxol-vnc-helper.exe' = 'helpers/conxol-vnc-helper.exe'
        'LICENSE' = 'LICENSE'
        'NOTICE' = 'NOTICE'
        'apps/desktop/src/assets/fonts/JetBrainsMono-OFL.txt' = 'licenses/JetBrainsMono-OFL.txt'
        'apps/desktop/src-tauri/icons/Square44x44Logo.png' = 'Assets/Square44x44Logo.png'
        'apps/desktop/src-tauri/icons/Square150x150Logo.png' = 'Assets/Square150x150Logo.png'
        'apps/desktop/src-tauri/icons/StoreLogo.png' = 'Assets/StoreLogo.png'
    }
    foreach ($source in $payload.Keys) {
        $sourcePath = Join-Path $repoRoot $source
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Missing package input: $source" }
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $stage $payload[$source])
    }
    # Check PE machine type for every included executable, not just its filename.
    foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -Filter '*.exe') {
        $bytes = [IO.File]::ReadAllBytes($file.FullName)
        $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
        if ([BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x4550 -or
            [BitConverter]::ToUInt16($bytes, $peOffset + 4) -ne 0x8664) { throw "Not an x64 PE: $($file.Name)" }
    }
    $exeVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo("$stage/conxol.exe").ProductVersion
    if ($exeVersion -ne $config.version) { throw "Executable version $exeVersion differs from $($config.version)." }
    $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap rescap">
  <Identity Name="TonmoyRoy.Conxol" Publisher="CN=26381B29-EA81-454D-B9CC-CEFCA1E6792D"
            Version="$packageVersion" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Conxol</DisplayName>
    <PublisherDisplayName>Tonmoy Roy</PublisherDisplayName>
    <Description>Terminal and remote connection manager</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources><Resource Language="en-US" /></Resources>
  <Applications>
    <Application Id="Conxol" Executable="conxol.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="Conxol" Description="Terminal and remote connection manager"
          BackgroundColor="transparent" Square150x150Logo="Assets\Square150x150Logo.png"
          Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@
    [IO.File]::WriteAllText("$stage/AppxManifest.xml", $manifest, [Text.UTF8Encoding]::new($false))
    $package = Join-Path $output "Conxol_${packageVersion}_x64.msix"
    & $makeAppx pack /d $stage /p $package /h SHA256 /o
    if ($LASTEXITCODE -ne 0) { throw 'MakeAppx packaging/manifest validation failed.' }

    # Unpack and compare every staged byte against the output package.
    $verified = "$stage-unpacked"
    & $makeAppx unpack /p $package /d $verified /o
    if ($LASTEXITCODE -ne 0) { throw 'MakeAppx unpack validation failed.' }
    foreach ($file in Get-ChildItem -LiteralPath $stage -File -Recurse) {
        $relative = $file.FullName.Substring($stage.Length + 1)
        $copy = Join-Path $verified $relative
        if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $copy).Hash) {
            throw "Packaged content mismatch: $relative"
        }
    }
    $hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([IO.Path]::GetFileName($package))" | Set-Content -LiteralPath "$package.sha256" -Encoding ascii
    Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
        [PSCustomObject]@{ Path = $_.FullName.Substring($stage.Length + 1); SHA256 = (Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
    } | ConvertTo-Json | Set-Content -LiteralPath "$package.inventory.json" -Encoding UTF8
    Write-Host "Store upload created and round-trip verified: $package"
    Write-Host 'Unsigned: Microsoft signs after certification. Local sideloading requires signing.'
    Write-Host 'Requires Microsoft Edge WebView2 Runtime. Clean-machine installation, runtime testing and WACK remain required.'
} finally {
    Pop-Location
}
