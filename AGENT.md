# Project findings and working guide

## Project

Conxol 0.1.31 is a Rust/Tauri 2 desktop application with a React 19,
TypeScript, Vite 7, and xterm.js frontend. It provides local terminals, SSH,
SFTP/SCP, tunnels, saved sessions, and experimental protocol integrations.

Read `CONTRIBUTING.md`, `docs/architecture.md`, and
`docs/security/safe-testing.md` before changing protocol or security behavior.

## Build and run on Windows

Prerequisites documented by the project: Rust stable 1.90+, Node.js 22,
pnpm 10, and native Tauri prerequisites (MSVC build tools and WebView2).
Run these commands from the project root in PowerShell:

```powershell
# Needed in this environment: Rust is installed but absent from PATH.
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
pnpm install --dir apps/desktop --frozen-lockfile
pnpm --dir apps/desktop tauri build --debug --no-bundle
Start-Process -FilePath "$PWD\target\debug\conxol.exe"
```

The build creates `target/debug/conxol.exe` with bundled frontend assets;
no Vite server is required to run this executable. `--no-bundle` skips
installer generation. For normal release packaging use `pnpm --dir
apps/desktop tauri build`.

For native development, run `pnpm --dir apps/desktop tauri dev`. This starts
Vite on port 1420 and the Tauri app. `pnpm --dir apps/desktop dev` alone is a
browser preview with synthetic state; it does not exercise native protocols.

The Tauri build hook runs `tools/prepare-desktop.mjs`: frontend build followed
by `cargo run --locked --manifest-path xtask/Cargo.toml -- stage-helpers`.
This compiles and stages the VNC helper under
`apps/desktop/src-tauri/helpers/`. RDP is excluded from normal bundles.
Prefer the Tauri build command over a bare Cargo build for a complete app.

## Code map and boundaries

The desktop follows the supplied MobaXterm layout while retaining Conxol's
color variables and typography: thin dropdown menu bar, 28px activity strip,
164px session sidebar, shared Home/session/tool tab row, and full-height terminal.
Home is the initial view; no local shell starts until requested. Closing the
last terminal returns to Home. Recent/recovery lists use real saved history.
SSH selection exposes a compact file browser in the sidebar alongside the
terminal, reusing `RemoteFilesView` and its existing native safety callbacks.
Session rows keep a fixed height and reserve action-button space while hidden,
so hover/focus must not resize or shift host labels. Sidebar folders always precede unfiled sessions. Folders and sessions use
alphabetical name ordering, including the sidebar Recent filter. Drag and drop
changes only the parent folder, never display order. Home recent/recovery lists
retain last-used ordering.
Right-click a saved row, press F2, or use its pencil to edit its custom name and
folder. The folder input suggests existing groups and accepts a new group name;
metadata persists through session_save. SSH tabs retain the saved custom name
instead of overwriting it with remote terminal-title sequences. Folder open state
persists in conxol.sessionFolders; the local/remote roots and individual groups
support toggling, Expand all, and Collapse all. Saving a folder assignment opens
the destination group so the moved session is visible.
The full file workspace remains available through View. X11 needs an external
X server; the menu does not start an embedded server.

If the first SFTP listing fails, the sidebar returns to sessions and remembers
SFTP as unavailable for that live connection. Switching back to its terminal
must not automatically reopen the failed file panel. After a successful SFTP
listing, ordinary directory errors remain visible instead of hiding the panel.
Explicit full Files view can retry; reconnecting creates a fresh capability check.

Layout and menus are in `App.tsx`; the desktop geometry rules are at the end
of `styles.css`. Dashboard headings, cards, brief, and secondary view-tab row
are hidden. Preserve alerts, broadcast controls, and native connection approvals.
Do not restore the former auto-replacement shell on final-tab close.

- `apps/desktop/src`: renderer UI, terminal rendering, and interaction policies.
- `apps/desktop/src-tauri/src`: native IPC commands and connection/job managers;
  `main.rs` registers commands and initializes persistence and vaults.
- `crates/conxol-core`: shared models and state transitions.
- `crates/conxol-ssh`: SSH, SFTP/SCP, forwarding, and remote editing.
- `crates/conxol-store` / `conxol-vault`: persistence and credentials.
- Other `crates/conxol-*`: network, Telnet, serial, and helper supervision.
- `tools/vnc-helper` and `tools/rdp-helper`: isolated Cargo workspaces.
- `xtask`: validation, helper staging, and packaging utilities.

Rust owns credentials, connections, filesystem changes, child processes, and
lifecycle state. Preserve host-key verification, typed IPC, bounded I/O,
cancellation, and explicit execution approvals. Use disposable local fixtures
for tests; do not use production hosts or real credentials.

Keep SSH/network processing native. output_batch::ShellOutputBatch coalesces SSH
stdout/stderr into 32 KiB raw chunks with an 8 ms fixed flush cadence, including
during blocked shell writes/resizes. Drop flushes the pending tail before decoder
finish and lifecycle events. Preserve incremental UTF-8 decoding and attachment
replay ordering. Network scan IPC uses results arrays, not one result/event:
64 results or 100 ms of result progress, with the final partial batch delivered
on completion, cancellation, or failure. ProgressBatch and output batching have
native tests; SSH backpressure/attachment/cleanup tests must continue passing.

The workspace uses patched local copies of `russh` and `russh-sftp` in
`vendor/`; consult their `CONXOL_PATCH.md` files before replacing them.
The application adds ECDH NIST P-256/P-384/P-521 after hybrid/Curve25519 and
before DH group exchange in its client preference list. Appliances with ECDH
but no Curve25519 otherwise choose slower DH group exchange. Keep modern DH
fallbacks and strict-KEX extensions; do not enable SHA-1 to improve latency.
The disposable `ecdh_handshake` integration test covers all three ECDH curves.
RSA private-key operations remain disabled in the workspace's russh dependency.
RSA-SHA2 server host signatures use the local AWS-LC public-verification patch;
SHA-1 remains excluded.

## Validation commands

```powershell
pnpm --dir apps/desktop test:unit
pnpm --dir apps/desktop check
pnpm --dir apps/desktop lint
pnpm --dir apps/desktop build
cargo xtask check-rust
cargo xtask check
```

The full xtask check includes helpers, packaging fixtures, and fuzz compilation;
it can require additional local prerequisites and uncached network downloads.
Use the isolated xtask workflow for backend tests. GitHub CI is disabled by
maintainer request; do not assume automated checks ran.

## Verified locally on 2026-11-04

- Environment: Windows x64 MSVC toolchain, Rust 1.91.1, Node.js 24.19.0,
  pnpm 10.33.0. Node 24 worked here; the documented setup specifies Node 22.
- Frozen dependency installation, frontend production build, frontend unit
  tests, VNC helper release build/staging, and native debug build passed.
- Launched `target/debug/conxol.exe`; the new process exposed a responsive
  native window titled `Conxol — operations deck`.
- Native build emitted an unused `sec` variable warning in
  `vendor/russh/src/keys/format/pkcs5.rs`; this did not block the build.
- pnpm reported ignored esbuild install scripts; the frontend build still passed.
- This directory has no `.git` metadata, so Git status/diff checks are unavailable.
- Full Rust tests, full xtask checks, installer generation, and live remote
  connection workflows were not verified in this session.
- After the layout change, frontend build, lint, unit tests, and the native
  debug build passed. A native window screenshot confirmed the compact toolbar,
  session sidebar, and full-height terminal with a working local cmd prompt.

- The reference-layout pass also passed frontend build, lint, and unit tests,
  and the native debug build. Home and local-terminal layouts were inspected
  in the native app. SSH sidebar live-server acceptance remains unverified.

## SSH trust and resizable sidebar

Unknown direct SSH hosts use an unauthenticated native fingerprint inspection,
then a Cancel / Accept and save dialog. Approved SHA-256 pins are persisted in
`ssh-trust.json` beside the app's other data (portable data when enabled).
The actual authenticated connection is pinned to that exact fingerprint.
Explicit known_hosts paths and profile pins take precedence; changed keys are
rejected, never silently replaced. No personal known_hosts file is discovered.
The trust store uses bounded JSON, atomic replacement, and a cross-process
approval lock. Unknown indirect jump targets still require explicit profile
pins or preexisting app trust; do not inspect them over an unintended direct route.

`ssh-host-trust.ts` owns the renderer approval sequence. `ssh_trust.rs` owns
native persistence, with temporary-directory tests. Inspection IPC receives
only host, port, and timeout, never authentication fields. See
`test/ssh-host-trust.test.mjs` for cancellation, endpoint-binding, and bounds checks.

The sidebar divider supports pointer dragging, Left/Right (Shift for larger
steps), and double-click or Home to reset. Width persists in localStorage;
`sidebar-layout.ts` clamps it to leave usable terminal space. Wide file panels
show additional file details. Terminal sizing continues through ResizeObserver.

Validation: frontend build/lint/unit tests and two native trust-store tests
passed. Strict Clippy is blocked by a preexisting collapsible_if warning in
`apps/desktop/src-tauri/src/terminal.rs:682`. No real server key was accepted
or real credentials used during verification.

Quick connect uses a compact basic SSH form. Connection-link input and advanced SSH settings are collapsed disclosures; invalid fields reopen their containing disclosure so validation can focus them. Authentication and protocol handlers are unchanged. Frontend build, lint, and unit tests passed after this UI simplification.

Quick connect defaults to "Ask for password" (interactive authentication),
including after applying a connection link. Keep it first in the authentication
list and omit OTP from its visible label/hint. Agent mode is an explicit choice.
New session uses supported protocol tiles (SSH, Telnet, RDP, VNC, Serial,
Shell, and Windows WSL), a compact SSH host/username/port row, and Advanced SSH,
Terminal, Network, and Bookmark tabs. Validation reveals the tab containing an
invalid field. Bookmark name/folder are passed through to native session saving;
password entry remains inside the terminal. Do not add nonfunctional protocols
or move SSH/network processing into the renderer for this layout.

SSH authentication opens a pending SSH tab before native connect and uses the
tab's TerminalSshLogin surface for secret entry. createSshAuthHandler receives
that tab's TerminalAuthentication.ask callback; reconnects use the same owner.
Do not start a local PTY for pending SSH tabs, or replace/unmount an established
TerminalViewport to display a reconnect prompt (its cleanup closes the transport).
Secret input uses an uncontrolled password field, clears on submission/abort,
and never enters xterm output, macro recording, broadcast, or session persistence.
Closing the tab cancels its prompt and rejects later challenges; if native connect
finishes after closure, immediately close that orphaned native connection.
An explicitly cancelled SSH authentication returns quietly without a workspace
error card or connectionFailed audit event; keep genuine connection errors visible.

Saved remote sessions show an immediate Connecting indicator on the row and
workspace. Once an SSH login tab opens, hide the redundant workspace banner;
the terminal shows Password required while awaiting secret input. All
saved-session entry points share a synchronous connection gate
to prevent duplicate attempts before React renders. The gate and visible busy
state clear on success, failure, validation return, or cancellation; retry remains
available. Local terminal launches do not wait for a remote connection attempt.

SSH-only RSA server compatibility: the vendor client KEX verifier now uses
AWS-LC to verify rsa-sha2-256/rsa-sha2-512 server signatures with 2048–8192-bit
keys. Do not enable the advisory-gated `russh/rsa` feature for this capability.
Synthetic vectors live under `crates/conxol-ssh/tests/fixtures/rsa-host`.
Handshake errors distinguish negotiation, server-signature, and protocol-version
failures without displaying raw server messages. Private-key RSA auth remains
unsupported; use a supported key, agent, or password/OTP authentication.

Handshake troubleshooting also distinguishes invalid key exchange, strict-KEX
sequence violations, host-key/signature decoding, and packet validation errors.
`cargo run --locked -p conxol-ssh --example inspect_transport -- HOST PORT`
uses the application's bounded host-key inspection path with an explicit target.
It sends no credentials, consults no agent or personal SSH files, and does not
approve/save the observed key. Use only an operator-authorized endpoint; tests
continue to use disposable loopback fixtures. A successful inspection proves
transport setup only, not authentication or terminal/SFTP behavior. The 44 SSH
library tests and RSA signature-vector test passed after the diagnostic update;
the native desktop was rebuilt and launched.

Windows agent authentication tries the standard OpenSSH agent pipe
`\\.\pipe\openssh-ssh-agent` first, then Pageant if the pipe cannot be opened.
Previously it tried only Pageant. Unavailable agents, empty identity lists,
and agent key operations have separate actionable messages. Agent mode requires
loaded keys; password/OTP users choose the interactive authentication option.
The Windows regression uses a unique disposable named pipe with a synthetic
agent response, never the workstation's real agent. That regression and all
13 loopback SSH authentication tests passed.

After rebuilding, exit the existing desktop instance before starting the new
executable. Single-instance handling sends a second launch to the existing
process; launching successfully does not prove the rebuilt code is running.
Confirm that the original PID exited and the new PID remains alive. Renaming
a running executable to unblock a build does not update that running process.

RSA host verification validation: 44 SSH library tests, 13 synthetic loopback authentication tests, four forwarding tests, and the RSA signature-vector test passed (62 total). Native desktop build succeeded. An unauthenticated OpenSSH diagnostic established that the reported server offered RSA-SHA2 host algorithms; no credentials or trust acceptance were sent. A completed login with the new app remains user acceptance.

## Conxol rename

Visible branding, native product/title, executable, package/crate names, helper
names, tooling, documentation, and local site assets use Conxol/conxol/CONXOL.
The executable is `target/debug/conxol.exe`; Rust packages live in `crates/conxol-*`.
Native app identifier: `com.othmane.conxol`. The SVG T mark generates desktop
PNG/ICO assets through `pnpm --dir apps/desktop tauri icon src-tauri/icons/icon.svg`.

Intentional legacy identifiers remain for compatibility and attribution:
- Existing profile/trust data is reused from the legacy app-data directory
  until the new directory has its own sessions.json; an empty WebView cache
  directory must not hide existing sessions.
- The original OS credential service and portable-vault magic remain stable.
- Frontend theme/sidebar caches read old keys as migration fallbacks.
- Signed RSA test-vector message bytes remain immutable.
- Real upstream URLs, existing release links, and copyright remain accurate.

The workspace directory itself remains `D:\MobaRust-main`; do not rename an
active workspace implicitly. IDE module/source references use Conxol names.
Validation after rename: frontend build/lint/unit tests; seven release-asset
tests; 44 SSH library tests and RSA signature test; app-data migration,
SSH trust-store, and credential namespace regressions; locked Cargo metadata
for the main and both helper workspaces; native desktop build. Existing
vendor unused-variable and previously recorded Clippy limitations remain.
