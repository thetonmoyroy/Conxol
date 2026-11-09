param(
    [Parameter(Mandatory)][string]$InputApk,
    [Parameter(Mandatory)][string]$OutputApk
)
$ErrorActionPreference = 'Stop'
$signingDirectory = Join-Path $env:LOCALAPPDATA 'Conxol/signing/android-preview'
$keystore = Join-Path $signingDirectory 'conxol-android-preview.p12'
$passwordFile = Join-Path $signingDirectory 'password.dpapi'
$alias = 'conxol-android-preview'
New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
# The private key and DPAPI password are local to this Windows account.
$acl = Get-Acl -LiteralPath $signingDirectory
$acl.SetAccessRuleProtection($true, $false)
foreach ($principal in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
Set-Acl -LiteralPath $signingDirectory -AclObject $acl
if (!(Test-Path -LiteralPath $passwordFile)) {
    if (Test-Path -LiteralPath $keystore) { throw 'Signing keystore exists without its password file; refusing to replace it.' }
    $generated = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
    $secure = ConvertTo-SecureString -String $generated -AsPlainText -Force
    ConvertFrom-SecureString -SecureString $secure | Set-Content -LiteralPath $passwordFile -Encoding ascii
    $generated = $null
}
$secure = (Get-Content -LiteralPath $passwordFile -Raw).Trim() | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:CONXOL_ANDROID_SIGNING_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
try {
    if (!(Test-Path -LiteralPath $keystore)) {
        & "$env:JAVA_HOME/bin/keytool.exe" -genkeypair -keystore $keystore -storetype PKCS12 -alias $alias -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 10000 -dname 'CN=Conxol Android Preview,O=Conxol' -storepass:env CONXOL_ANDROID_SIGNING_PASSWORD -keypass:env CONXOL_ANDROID_SIGNING_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the Android preview signing key.' }
    }
    $buildTools = Get-ChildItem -LiteralPath "$env:ANDROID_HOME/build-tools" -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (!$buildTools) { throw 'Android SDK build tools are missing.' }
    $aligned = "$OutputApk.aligned-unsigned"
    & "$($buildTools.FullName)/zipalign.exe" -f -P 16 4 $InputApk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    & "$($buildTools.FullName)/apksigner.bat" sign --ks $keystore --ks-key-alias $alias --ks-pass env:CONXOL_ANDROID_SIGNING_PASSWORD --key-pass env:CONXOL_ANDROID_SIGNING_PASSWORD --out $OutputApk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    & "$($buildTools.FullName)/apksigner.bat" verify --verbose --print-certs $OutputApk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    & "$($buildTools.FullName)/zipalign.exe" -c -P 16 4 $OutputApk
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed.' }
    & "$env:JAVA_HOME/bin/keytool.exe" -exportcert -rfc -keystore $keystore -storetype PKCS12 -alias $alias -storepass:env CONXOL_ANDROID_SIGNING_PASSWORD -file "$OutputApk.certificate.pem"
    if ($LASTEXITCODE -ne 0) { throw 'Could not export the public signing certificate.' }
    Remove-Item -LiteralPath $aligned
    Write-Output "Signing key retained locally: $keystore"
} finally { Remove-Item Env:CONXOL_ANDROID_SIGNING_PASSWORD -ErrorAction SilentlyContinue }
