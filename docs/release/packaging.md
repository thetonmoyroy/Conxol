# Desktop packaging boundary

## Downloadable previews

The v0.1.12 preview has Windows x64 NSIS, Linux x64 Debian/AppImage, and macOS
ARM64/x64 DMG packages. The newer [v0.1.26 preview](v0.1.26.md) updates only
the two Mac DMGs using local builds. The release workflow is disabled; new
builds and checks run locally. A release tag must match the Cargo, frontend,
and Tauri versions.

These unsigned previews are separate from the signed production distribution
gates below. They do not establish publisher authenticity, notarization, full
GUI clean-install behavior, or real-server interoperability.

## Build inputs

RDP/VNC runtime support and helper resources have been removed. The Tauri build
hook (`tools/prepare-desktop.mjs`) builds the frontend only; there is no helper
staging step or protocol helper workspace. Native package layouts require the
application executable and configured license/icon resources.

For ordinary changes, run focused checks or a development build. Build release
binaries, installers, or bump versions only when explicitly requested. For
packages produced in GitHub Actions, use the GitHub-hosted publishing workflow
and verify both source checksums and uploaded asset hashes; do not download
packages locally merely to re-upload them.

`tools/release-assets.mjs collect` accepts the bundle directory as its fourth
argument and an output directory as its fifth. Use an empty, version-specific
output directory for local releases. The collector refuses an output directory
containing installers from another version, preserving those files for review
instead of mixing them into a new upload.
It requires exactly one installer of each target format before writing any
output: EXE for Windows, DMG for macOS, and both DEB and AppImage for Linux.
Two DEBs or two AppImages cannot substitute for the Linux pair or overwrite
the same canonical output with duplicate checksum entries. These collection
checks do not establish the package's contents or runtime behavior.
The source installer names must also match the configured product and version
and the requested architecture before canonical release names are assigned.
For Conxol, the current Tauri filename patterns are:

| Target | Source installer names |
| --- | --- |
| Windows x64 | `Conxol_<version>_x64-setup.exe` |
| Linux x64 | `Conxol_<version>_amd64.deb` and `Conxol_<version>_amd64.AppImage` |
| macOS ARM64 | `Conxol_<version>_aarch64.dmg` |
| macOS x64 | `Conxol_<version>_x64.dmg` |

These match Tauri 2.12.1's [NSIS](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs),
[Debian](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-bundler/src/bundle/linux/debian.rs)
and [AppImage](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs)
output rules. Filename checks reject accidental stale or wrong-target inputs;
mounted package metadata and executable architecture checks remain separate.

`cargo xtask package-check` builds an unsigned current-platform debug app
bundle and verifies that the Tauri resource step completes. The bundle
configuration includes the versioned Conxol mark from
`apps/desktop/src-tauri/icons/icon.png`, so the application icon is generated
into the platform bundle rather than remaining a source-only asset. On macOS
it also checks that the app executable is a regular executable file inside
the bundle. It writes a `Conxol.sha256` manifest beside the generated
bundle and verifies it immediately; the manifest uses the portable two-space
SHA-256 format accepted by both `sha256sum` and macOS `shasum`, and covers every
regular file in the artifact scope. It is a packaging smoke test, not code-signing,
notarization, or interoperability evidence.

After the bundle layout is verified, `package-check` also runs the built
`conxol --version` path five times through the repository-bounded startup
probe. This confirms that the packaged executable can take its minimal CLI
path without opening a window, contacting a network, or initializing the
application data stores. It reports process-launch timing and binary size; it
does not replace full GUI startup, clean-install, or cross-platform evidence.

An already assembled artifact can be checked without rebuilding it:

```text
cargo xtask verify-checksum <artifact-dir> <manifest>
```

Both paths are explicit. The verifier requires a regular manifest file, rejects
symlinks and unsupported file types anywhere in the artifact, and recomputes
the complete deterministic manifest before reporting success. It proves local
artifact integrity only; it is not a signature verifier and does not establish
publisher authenticity.

On macOS, an already signed `.app` can be checked explicitly:

```text
cargo xtask verify-macos-signature <signed-app-bundle>
```

This invokes the fixed system path `/usr/bin/codesign` with deep, strict
verification for the selected regular `.app` directory. It does not sign,
search for a signing identity, access Keychain credentials, or contact a
remote service. The command verifies the embedded code signature only; it does
not prove notarization, Gatekeeper acceptance, or clean-install behavior.
Unsigned local smoke artifacts are expected to fail this release-gate check.
Signing and notarization therefore remain external release evidence, and no
certificate or private signing key belongs in this repository.

## Cross-platform package layout contract

`cargo xtask package-layout-check` validates the runtime shape expected by the
three desktop targets using repository-local fixtures. It checks that each
package has its native executable, the current-platform executable VNC helper,
and executable permissions on Unix,
and no RDP candidate that has not passed its dependency and interoperability
gates:

| Target | App root | Runtime | VNC helper |
| --- | --- | --- | --- |
| macOS | `Conxol.app/` | `Contents/MacOS/conxol` | `Contents/Resources/helpers/conxol-vnc-helper` |
| Windows | unpacked app directory | `conxol.exe` | `helpers/conxol-vnc-helper.exe` |
| Linux | unpacked app directory | `conxol` | `helpers/conxol-vnc-helper` |

This is an implementation contract and a safe local test of path policy. It
does not build Windows/Linux artifacts, validate their runtime behavior, sign
them, or replace the required cross-platform release matrix. The existing
`package-check` and `portable-check` commands remain the macOS artifact smoke
checks until dedicated target environments are available.

After a target-specific build exists, the same verifier can inspect one
explicit unpacked app root without scanning elsewhere:

```text
cargo xtask verify-platform-layout macos target/debug/bundle/macos/Conxol.app
cargo xtask verify-platform-layout windows <unpacked-windows-app>
cargo xtask verify-platform-layout linux <unpacked-linux-app>
```

The command is intentionally explicit about both the target and the artifact
root. It never discovers packages or follows a user-selected directory tree
automatically.

## Portable local smoke package

cargo xtask portable-check first runs the bundle smoke check, then copies the
verified macOS .app into an explicit generated package directory and creates
an unsigned .tar.gz archive. The copy routine refuses symlinks and
non-regular files, so a bundle entry cannot redirect packaging outside the
repository-owned artifact tree. The package contains:

* Conxol.app
* LICENSE, containing the complete Apache License 2.0 terms for redistribution
* NOTICE, containing the project attribution
* Conxol.app/Contents/MacOS/portable.flag, beside the macOS executable
* PORTABLE-UNSIGNED.txt
* Conxol.sha256, covering the extracted package contents

The archive is inspected with tar for required entries and path traversal,
extracted into a temporary generated directory, and checked again with the
package manifest before that directory is removed. It then receives a
separate archive SHA-256 manifest. All generated output stays under ignored
target/debug/portable/; no package is committed or uploaded.
This proves a local macOS packaging path only. It does not prove signing,
notarization, clean installation, Windows/Linux support, or protocol
interoperability.

On 2026-08-31 this smoke test passed on the local macOS ARM64 host. The bundle
was created at `target/debug/bundle/macos/Conxol.app`; its main executable
and the staged VNC helper resource (`conxol-vnc-helper`) were verified as
executable Mach-O arm64 files. The RDP candidate was intentionally not staged
because its separate lockfile currently fails the RSA timing-advisory audit.
This is repository-local assembly evidence only; it does not prove a clean
install, notarization, or remote-desktop interoperability.

The same run assembled and re-verified the unsigned portable archive
`Conxol-macos-arm64.tar.gz`, including its extracted package manifest and
separate archive SHA-256 manifest. The measured `conxol --version` probe
reported `Conxol 0.1.0` and completed without opening a window, network
connection, application store, vault, or clipboard. These are local artifact
receipts, not publisher authenticity or cross-platform release evidence.

A second local recheck on 2026-08-31 produced the following process-launch
receipts while rebuilding the same unsigned bundle and portable archive:

```text
package-check: app_startup version=Conxol 0.1.0 bytes=58757624 first_run_ms=1647.752 repeated_mean_ms=16.796 samples=5
portable-check: app_startup version=Conxol 0.1.0 bytes=58757624 first_run_ms=1354.983 repeated_mean_ms=18.839 samples=5
```

The differing first-run values reinforce that these measurements cover only
the bounded `--version` process path; they are not GUI cold-start, memory,
idle-CPU, or cross-platform performance results.

At runtime, the desktop parent also opens helper resources with
`symlink_metadata` and rejects symlinks, directories, and other non-regular
files before spawning a protocol process. This complements the bundle smoke
test; it is an integrity boundary against local resource substitution, not a
replacement for signed distribution or operating-system protection.

## Distribution matrix

| Target | Helper build | Package evidence | Signing evidence |
| --- | --- | --- | --- |
| Windows x64 | v0.1.12 native-runner build exists; current native build pending | v0.1.12 preview installer available; clean install pending | Owner certificate pending |
| Linux x64 | v0.1.12 native-runner build exists; current native build pending | v0.1.12 DEB/AppImage available; distro checks pending | Signing policy pending |
| macOS ARM64 | Local ARM helper passed; clean install pending | v0.1.29 DMG passed layout, integrity, CLI and public-download checks; native approved startup/reconnect-timeout retry-stop/normal local-PTY Quit passed in an isolated v0.1.29 release copy; earlier encoding receipts retain their artifact scope; broader GUI and clean install pending | Developer ID/notarization pending |
| Windows ARM64 | Cross-build/toolchain required | Pending | Pending |
| Linux ARM64 | Cross-build/toolchain required | Pending | Pending |
| macOS x64 | Local cross-built Intel VNC helper passed | v0.1.29 DMG passed layout, integrity, Rosetta CLI and public-download checks; Intel GUI pending | Developer ID/notarization pending |

Packaging is not a claim that RDP/VNC interoperability is complete. Real
server tests, platform-specific input/clipboard/display behavior, dependency
licenses, signed artifacts, checksums, and clean-install verification remain
release gates. No signing keys or certificates belong in this repository.

Portable vault writes also refuse a symlink or directory at the vault path
before reading or replacing it. This protects the marker-gated portable data
directory from redirecting credential storage to an unintended local target;
it does not protect against a fully compromised operating system.

The checksum manifest is integrity evidence for an assembled artifact, not an
authenticity guarantee. Release automation must sign the manifest (or an
equivalent release metadata file) with the project-approved signing system,
publish it next to the exact package, and verify it from a clean install
environment. No generated manifest or signature is committed by the local
`package-check` command.
