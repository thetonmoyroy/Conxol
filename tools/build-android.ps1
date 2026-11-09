param(
    [ValidateSet('aarch64', 'armv7', 'x86_64', 'i686')]
    [string]$Target = 'aarch64',
    [switch]$Release
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopPath = Join-Path $projectRoot 'apps/desktop'
$sdkPath = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (!(Test-Path -LiteralPath $sdkPath)) { throw 'Install the Android SDK and set ANDROID_HOME.' }
$env:ANDROID_HOME = $sdkPath
if (!$env:NDK_HOME) {
    $ndkVersion = Get-ChildItem -LiteralPath (Join-Path $sdkPath 'ndk') -Directory |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (!$ndkVersion) { throw 'Install an Android NDK using Android Studio.' }
    $env:NDK_HOME = $ndkVersion.FullName
}
$jdkCandidates = @($env:JAVA_HOME, (Join-Path $env:ProgramFiles 'Android/Android Studio/jbr'))
$jdkCandidates += @(Get-ChildItem -Path "$env:ProgramFiles/Java/jdk*" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | ForEach-Object FullName)
$jdkPath = $jdkCandidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'lib/jvm.cfg')) } | Select-Object -First 1
if (!$jdkPath) { throw 'Install a working JDK compatible with the generated Android Gradle project and set JAVA_HOME.' }
$env:JAVA_HOME = $jdkPath
$env:Path = "$env:USERPROFILE\.cargo\bin;$jdkPath\bin;$env:Path"
# Separate Android artifacts from a running desktop `cargo run` session.
$env:CARGO_TARGET_DIR = Join-Path $projectRoot 'target/android'

& pnpm --dir $desktopPath tauri android init --ci
if ($LASTEXITCODE -ne 0) { throw 'Android initialization failed.' }
Copy-Item -LiteralPath "$PSScriptRoot/android/MainActivity.kt" -Destination "$desktopPath/src-tauri/gen/android/app/src/main/java/com/othmane/conxol/MainActivity.kt"
# Reuse Conxol's existing launcher/adaptive icons instead of Tauri's template.
Copy-Item -Path "$desktopPath/src-tauri/icons/android/*" -Destination "$desktopPath/src-tauri/gen/android/app/src/main/res" -Recurse -Force
# Keep a debug signature/install flow without shipping hundreds of megabytes
# of native symbols. The unstripped Rust library remains in target/android.
$appGradle = Join-Path $desktopPath 'src-tauri/gen/android/app/build.gradle.kts'
$gradleText = Get-Content -LiteralPath $appGradle -Raw
$ndkRevision = ((Get-Content -LiteralPath "$env:NDK_HOME/source.properties" | Select-String '^Pkg.Revision\s*=').Line -split '=', 2)[1].Trim()
if ($gradleText.Contains('ndkVersion =')) {
    $gradleText = [regex]::Replace($gradleText, '(?m)^\s*ndkVersion\s*=.*$', "    ndkVersion = `"$ndkRevision`"")
} else {
    $gradleText = $gradleText.Replace("android {", "android {`n    ndkVersion = `"$ndkRevision`"")
}
if (!$gradleText.Contains('ndkPath =')) {
    $gradleText = $gradleText.Replace("android {", "android {`n    ndkPath = System.getenv(`"NDK_HOME`")")
}
$gradleText = [regex]::Replace($gradleText, '(?m)^\s*jniLibs\.keepDebugSymbols\.add\([^\r\n]*\)\r?\n', '')
$gradleText = $gradleText.Replace('isJniDebuggable = true', 'isJniDebuggable = false')
Set-Content -LiteralPath $appGradle -Value $gradleText -Encoding utf8
# AGP can retain large holes when incrementally replacing an unstripped .so.
# Missing output APKs are repackaged cleanly without rebuilding Rust.
Get-ChildItem -Path "$desktopPath/src-tauri/gen/android/app/build/outputs/apk" -Filter '*debug*.apk' -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName }
# Drop desktop helpers left by an earlier build using the desktop resources.
Get-ChildItem -Path "$desktopPath/src-tauri/gen/android/app/src/main/assets" -Include '*.exe', '*.dll' -File -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName }
if ($Release) {
    & pnpm --dir $desktopPath tauri android build --apk --target $Target --ci
} else {
    & pnpm --dir $desktopPath tauri android build --apk --target $Target --debug --ci
}
if ($LASTEXITCODE -ne 0) { throw 'Android APK build failed.' }

$pattern = if ($Release) { '*release-unsigned.apk' } else { '*debug*.apk' }
$apk = Get-ChildItem -Path "$desktopPath/src-tauri/gen/android/app/build/outputs/apk" -Filter $pattern -Recurse |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$apk) { throw 'The build finished without an APK.' }
$version = (Get-Content -LiteralPath "$desktopPath/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version
$androidConfig = Get-Content -LiteralPath "$desktopPath/src-tauri/tauri.android.conf.json" -Raw | ConvertFrom-Json
if ($androidConfig.version) { $version = $androidConfig.version }
$destination = Join-Path $projectRoot "artifacts/android/conxol-$version-android-$Target-preview.apk"
New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
if ($Release) {
    $destination = Join-Path $projectRoot "artifacts/android/Conxol-$version-$Target.apk"
    & "$PSScriptRoot/android/sign-apk.ps1" -InputApk $apk.FullName -OutputApk $destination
} else {
    Copy-Item -LiteralPath $apk.FullName -Destination $destination
}
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $(Split-Path -Leaf $destination)" -Encoding ascii
Write-Output "Android preview APK: $destination"
