# Android preview

Conxol uses Tauri Android with the existing React interface and native Rust
SSH/SFTP, Telnet, networking, session storage, and workspace PIN commands.
The desktop binary calls the same library entry point as the Android shell.
The version remains 0.1.60; this is an initial preview, not a Play Store release.

## Build on Windows

Install Android Studio, a working JDK, the Android SDK platform/build tools,
NDK, Node/pnpm, and Rust. Set `ANDROID_HOME`, `NDK_HOME`, and `JAVA_HOME` when
using custom locations. From the repository root:

```powershell
./tools/build-android.ps1
```

The script initializes the ignored/generated Android Studio project, installs
Rust Android targets using Tauri, builds a debug-signed ARM64 APK, and copies it
and its SHA-256 checksum into `artifacts/android/`. Use `-Target x86_64` for an
x86 Android emulator. Android builds use `target/android` to avoid locking the
desktop development build. They skip desktop helper packaging and resources.
The APK requires Android 7/API 24 or newer. It is intended for local testing;
production signing and Play Store publication are separate steps.

## Current limits

- Native IPv4 Ping and MTR use Android ICMP datagram sockets and the Linux
  `IP_RECVERR` error queue for intermediate-hop replies. They do not launch
  system commands or request root/raw-socket access. IPv6 probing is not implemented.
- The phone layout removes desktop minimum dimensions and adds touch targets.
- Passwords entered for SSH authentication are used for that connection and
  are not saved by the desktop post-login credential-store dialog. Android
  secure credential-store integration is still required.
- SFTP browsing and remote operations use the existing native implementation.
  Upload/download pickers and workspace backup import/export are unavailable:
  Android content URIs need a Storage Access Framework transfer bridge. These
  commands return explicit errors rather than treating a URI as a file path.
- RDP/VNC desktop helper executables and desktop serial adapters have not
  been ported to Android. RDP/VNC connection options and saved profiles are
  hidden in the Android interface; stored profiles are preserved. Desktop
  helper binaries are excluded from the APK.
- Local shell access, where Android permits it, runs `/system/bin/sh` inside
  the application sandbox. It is not a root shell or a full Linux environment.
- Connections currently follow the application lifecycle. There is no Android
  foreground service guaranteeing connections while the app is backgrounded.

Only claim device functionality after testing it on an emulator or phone;
cross-compilation alone does not verify network or lifecycle behavior.

## Verified on 2026-11-09

The ARM64 preview APK installed and launched on the Android phone emulator
using its ARM64 translation support. Smoke checks passed for workspace lock
status, native session storage, clipboard read/write, native TCP to a disposable
loopback listener through ADB reverse, sandbox shell spawn/close, SSH host-key
inspection against a disposable ECDSA server, and config-generator output.
The 411 px viewport had no document-wide horizontal overflow, and screenshots
confirmed status/navigation bar insets. Authenticated SSH sessions, SFTP server
interoperability, background behavior, and physical phones remain unverified.

APK signature verification, ZIP 16 KiB alignment, and ELF 16 KiB load alignment
passed. The package contains only an ARM64 native library and no Windows
helper executables. Frontend unit tests/build/lint and a Windows native library
compile check also passed. The APK is approximately 46 MB.

Native Ping and MTR each received loopback replies through the Android app's
IPC commands; cancellation completed in under 300 ms. All nine ICMP packet
and Android backend tests passed when run on the emulator, including a real
kernel error-queue test using a closed, OS-assigned loopback UDP port. Host
packet/scheduler/adapter tests also passed (50 tests). Physical-device routed
hop behavior remains unverified.
