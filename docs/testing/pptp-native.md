# Native PPTP feasibility (Windows)

The goal is per-session/per-group PPTP without host VPN profiles, route/DNS
changes, installed drivers, services, QEMU, or an external VPN client. This is
available through **Tools > PPTP manager** for saved profiles and private
connections. Assigning those tunnels to SSH sessions/groups remains separate
work. The shared native engine implements
PPTP control setup, GRE, PPP LCP, verified MS-CHAPv2 authentication,
stateless 128-bit MPPE, IPCP, and a private smoltcp IPv4/TCP/ICMP stack.

## First gate: GRE transport

`tools/pptp-native-probe.rs` is a standalone Rust program using only the standard
library and Windows' built-in ws2_32 DLL. It creates an IPv4 raw socket for GRE
(IP protocol 47), binds only to 127.0.0.1, sends one synthetic enhanced-GRE/PPP
datagram, and waits at most approximately two seconds for the matching packet.
It has no configurable remote target, reads no credentials, and never changes
routes, firewall rules, adapters, or VPN profiles. Socket handles close on exit.

From the repository root (Rust installed):

```powershell
rustc --edition=2024 tools/pptp-native-probe.rs -o target/pptp-native-probe.exe
.\target\pptp-native-probe.exe
rustc --edition=2024 --test tools/pptp-native-probe.rs -o target/pptp-native-probe-tests.exe
.\target\pptp-native-probe-tests.exe
```

These are development executables, not release packages. A receive timeout
does not by itself establish that remote GRE cannot work: local packet delivery
and firewall policy may differ. No firewall bypass is attempted.

## Observed result, 2026-11-09

Compilation succeeded on Windows. Under the current process token, raw GRE
socket creation failed with Winsock **10013 / WSAEACCES**. No GRE packet was
sent. Administrator elevation was not attempted. This agrees with Microsoft's
[raw-socket access requirements](https://learn.microsoft.com/en-us/windows/win32/winsock/tcp-ip-raw-sockets-2).

This blocks the tested Winsock approach for ordinary unelevated execution.

At the user's explicit request, the same compiled probe was subsequently run
with administrator elevation through Windows RunAs. It exited with code 0:
raw GRE socket creation, synthetic loopback send, and matching loopback receive
all passed. Output is captured locally in `target/pptp-native-elevated.log`.
No installed helper or driver, host VPN profile, route change, or firewall
change was needed. This establishes local native GRE feasibility with elevation,
not remote PPTP interoperability, authentication, or a complete VPN connection.

## Remaining gates before app integration

1. Add native GRE transports and platform-specific permission handling for
   Linux/macOS. Windows uses the app-session UAC socket broker described below.
2. Harden sustained-session transport handling, cancellation, backpressure,
   lifecycle ownership, and resource limits beyond the bounded probe.
3. Add tunnel-scoped DNS if hostname targets are required. The private TCP/IP
   stack is implemented; this probe intentionally accepts IPv4 literals only.
4. Pass that private byte stream to russh's existing `client::connect_stream`
   connection path in `crates/conxol-ssh/src/lib.rs`. Keep host-key verification
   and authentication intact. Never fall back to a direct connection on failure.
5. Add tunnel ownership, cancellation, sharing within a group, session overrides,
   vault references, bounded resource use, and isolated protocol fixtures before
   exposing supported PPTP controls in the UI.

Protocol reference: [RFC 2637](https://datatracker.ietf.org/doc/html/rfc2637).
The initial loopback probe used no real VPN, remote SSH server, or credentials.

## Native encrypted tunnel prototype

The shared engine now lives in `crates/conxol-pptp` and is compiled into the
Tauri backend. `tools/pptp-native/` remains a separate CLI workspace using that
same library for bounded manual diagnostics. Crypto
crates compile into the executable; runtime networking uses Windows' built-in
Winsock API. No external VPN client, helper service, QEMU, or installed driver
is used. Windows raw-socket creation uses an app-session elevated broker when needed;
the Tauri window and the VPN/SSH networking state remain in the normal process.

The prototype has a bounded TCP control connection, validates PPTP framing and peer call
IDs, services control echoes, filters GRE by peer/local address and call ID,
acknowledges GRE sequence numbers, negotiates MS-CHAPv2 only, and checks the
server's RFC 2759 authenticator. PAP passwords are never sent. It rejects
changed authentication challenges rather than retrying credentials. The PPP
authentication phase has a 30-second deadline; TCP/control operations have separate deadlines.
An exit guard sends call-clear/stop-control messages and closes the TCP socket.
The GRE socket also closes on success or failure.

Build the CLI and run isolated engine/profile tests (synthetic credentials,
temporary stores, in-memory IP fixtures and loopback-only cancellation tests):

```powershell
cargo xtask test-pptp
cargo build --locked --manifest-path tools/pptp-native/Cargo.toml --target-dir target/pptp-native-build
```

Explicit live use, from PowerShell 7 on Windows:

```powershell
.\tools\pptp-native\run-live.ps1 -Server <explicit-server-IPv4>
# Optional: test one explicitly selected TCP endpoint through the tunnel.
.\tools\pptp-native\run-live.ps1 -Server <explicit-server-IPv4> -TcpTarget <target-IPv4:port>
```

The launcher prompts locally for credentials and requests elevation. It passes
credentials over a unique named pipe with an explicit DACL granting access only
to the invoking Windows user, then disconnects the pipe. Passwords are not
passed on the elevated command line, written to files, or logged. Sensitive
buffers are cleared after use. The probe retains plaintext credentials only in
zeroizing process memory until authentication completes, then clears them before
network negotiation and encrypted IP traffic. Sanitized stage output is captured
in a unique `target/pptp-native-live-*.log` file. Treat this as a development
probe; do not expose this launcher or legacy authentication as a supported UI.

### Implementation details and checks

- `src/mppe.rs`: RFC 3079 asymmetric client send/receive keys, RFC 3078
  stateless RC4 rekeying, 12-bit coherency count rollover, duplicate/late packet
  rejection, and forward key advancement after dropped packets. Keys and
  sensitive buffers zeroize on drop; RustCrypto's RC4 uses its zeroize feature.
- `src/link.rs`: separate CCP/IPCP state machines, exact Configure-Ack matching,
  bounded Configure-Nak/Reject handling and retries, required stateless 128-bit
  MPPE in both directions, and negotiated local/peer IPv4 addresses. No weak-key,
  stateful, MPPC, or plaintext downgrade. Network negotiation has a 25-second
  deadline. A configuration restart closes the active test connection.
- `src/stack.rs`: IP-only in-memory smoltcp device, /32 tunnel interface and
  private default route. These routes exist exclusively inside this Rust
  object; no host interface or route API is called. Packet queues are limited
  to 32 packets; one TCP test uses fixed 64 KiB send/receive buffers. The
  outgoing MTU respects the peer's MRU and caps at 1360 bytes. No OS DNS resolver
  is called and no unencrypted fallback socket is created for tunnel traffic.
- Default live mode sends at most three encrypted ICMP requests to the
  negotiated VPN peer, with a random identifier/payload and a ten-second traffic
  deadline. A reply must match the peer, identifier, sequence, and random payload.
- Optional `-TcpTarget` uses the private TCP stack, verifies a TCP handshake,
  reads at most 1024 banner bytes, and disconnects. It reports whether an SSH
  banner was recognized without logging its contents. No SSH login, trust
  acceptance, commands, or credentials are sent to that target.

The engine's synthetic tests cover RFC 2759 authentication and RFC 3079 key/ciphertext
vectors; MPPE packet loss, duplicate/late rejection and rollover beyond 4096
packets; malformed framing; no-encryption/weak-mode refusal; IPCP address
assignment; bounded queues; encrypted ICMP echo; and a private TCP handshake
with an SSH-shaped synthetic banner transported over encrypted IP packets
between two in-memory stacks, plus cancellation before a loopback socket read. Clippy
passes for all targets with `-D warnings`.

Protocol references: [MPPE framing/key changes (RFC 3078)](https://www.rfc-editor.org/rfc/rfc3078.html),
[MPPE key derivation (RFC 3079)](https://www.rfc-editor.org/rfc/rfc3079.html),
and the [smoltcp stack](https://docs.rs/smoltcp/0.12.0/smoltcp/).

### User-authorized live results, 2026-11-09

The initial authentication-only attempt to the supplied server succeeded:

- TCP 1723 and PPTP start-control setup passed.
- The server accepted the outgoing PPTP call.
- Bidirectional GRE and PPP LCP negotiation passed.
- The server accepted MS-CHAPv2 credentials.
- The client independently verified the server's MS-CHAPv2 authenticator.
- The test call was closed immediately afterward; no SSH connection was made.

After implementing encryption and IP negotiation, a first live traffic test
negotiated MPPE/IPCP successfully but received no reply to its single ping.
After adding bounded ping retries and aligning the receive MRU/data-path limits,
the next elevated live attempt passed all stages, including **an encrypted IPv4
ICMP request and verified reply through the private stack**. That call exited
successfully and closed its sockets. The first timeout's cause was not established.

No endpoint identity or credential values are retained in this document or the
source. No host VPN profile, route, firewall, or DNS changes were made, and no
driver, external VPN client, or runtime service was installed. Only development
executables were built; desktop versions and release packages were not changed.

**Limits:** Stateful/40-bit/56-bit MPPE, MPPC, IPv6, IP fragmentation, and
hostname resolution are not supported. Live TCP/SSH-over-VPN testing still
requires a user-selected target; TCP is verified with in-memory encrypted
fixtures. Desktop SSH session/group assignment and async SSH byte streams
remain separate work. Windows raw GRE still requires
administrator permission for socket creation, requested via UAC when needed.

## Desktop manager

Tools > PPTP manager opens a resizable React dialog inside the existing Tauri
application. It supports up to 2000 profiles, folder organization, search over
profile metadata, status filtering, and 50-row pagination. Add/edit/duplicate/
delete are backed by bounded, validated, atomically replaced `pptp.json` in
the active workspace. Duplication copies metadata only. Connected or connecting
profiles must disconnect before they can be changed/deleted.

Passwords are optional. Saved passwords use opaque `pptp-<UUID>` references in
the PIN-encrypted native vault; no passwords are stored in the profile JSON or
returned through list IPC. Saving passwords requires the existing 4–12-digit
workspace PIN. Leaving a password blank on edit keeps the saved value; replacing
or removing it cleans up its vault reference. Profiles without saved passwords
prompt transiently on Connect. Profile changes participate in the backup
operation guard; encrypted workspace backups include PPTP profiles and rebind
their password references during restore.

Up to 16 independent native tunnels can run concurrently. A connected status
means authentication, bidirectional MPPE, and IPCP negotiation completed. A
single private stack per tunnel services encrypted peer keepalives and reports
packet counts. Closing the manager leaves its tunnels running; Disconnect
cancels the worker. App exit cancels and joins all owned workers. Native socket
access denied requests elevation through Windows UAC once per app session. No
Windows VPN profile, route, adapter, firewall, or DNS change is performed.
SSH sessions are not implicitly routed into a manager connection.

Validation includes the engine tests, profile persistence/corruption and failed
write tests, encrypted-vault save/replace/clear/delete and rollback tests,
worker cancellation/join tests, and PPTP password rebinding through encrypted
workspace backup/restore. Frontend type checking, lint, unit tests and build,
plus a native Tauri debug build, were also checked. GUI automation reached the
isolated Tauri app, but interaction was blocked by active input detection; the
complete manager visual workflow was not verified in that session.

## Automatic Windows permission request

On Connect, native GRE creation is attempted normally. If Windows returns
WSAEACCES (10013), the worker reports that it is waiting for Windows permission
and uses ShellExecuteExW's `runas` verb to start the same Conxol executable in
`--conxol-gre-broker` mode. Already-elevated apps skip this step. Declining UAC
leaves the app running and reports that permission was declined; Connect can
be retried. The Windows UAC dialog itself waits for the user's decision.

The elevated process stays available for the app session and handles subsequent
GRE socket requests over the same authenticated pipe. Disconnect/reconnect,
switching profiles, or disconnecting every PPTP tunnel does not request UAC
again. Concurrent requests serialize through one shared broker, so simultaneous
Connect actions cannot launch multiple prompts. No permission is requested at
ordinary app startup; the helper starts on the first PPTP connection that needs
it. Existing SSH and other connections stay running.

The helper does not initialize Tauri, open a workspace/vault, receive VPN
passwords, execute a shell, install a service, or change host networking. The
normal app receives the duplicated socket through Winsock's documented
WSADuplicateSocketW/WSASocketW mechanism, then runs PPTP/PPP/MPPE in its existing
worker. The UI does not restart or acquire administrator privileges.

`crates/conxol-pptp/src/elevation.rs` uses a unique local-only named pipe, an
explicit owner/Administrators/SYSTEM DACL, first-instance protection, peer PID
and executable checks, identification-only client security QoS, versioned fixed
frames, and a 30-second deadline for each handshake/request after UAC completes.
Idle time between requests has no expiry. Socket information is
process-specific; handoff is acknowledged before the helper closes its copy.
The protocol carries only socket parameters and the opaque socket capability.
Cancel is checked before prompting and while waiting for the shared broker. Once
UAC is approved, helper authentication and an in-progress capability handoff
complete even if that connection is cancelled, preserving permission for later
connections. The cancelled connection closes its donated socket immediately.
Ordinary socket/bind failures preserve the authenticated channel. If the helper
crashes or its protocol breaks, the app reports an error rather than silently
requesting UAC again; restarting Conxol starts a new permission session.

App exit cancels and joins connection workers, closes the shared pipe, and waits
for the helper to exit. The helper also watches the parent's process handle and
pipe EOF, so a crashed/killed parent cannot leave it running indefinitely. It
holds no donated GRE socket after the corresponding handoff is acknowledged.

The engine and UI keep privilege handling platform-specific with Windows-only
APIs under `cfg(windows)`. Linux and macOS retain profile management and an
explicit unsupported-connection status; no Windows elevation command is used
there. Native PPTP connections on those platforms are not implemented yet.

Manual local validation (not part of routine tests, may show Windows UAC):

```powershell
cargo build --locked --manifest-path tools/pptp-native/Cargo.toml --target-dir target/pptp-native-build
.\target\pptp-native-build\debug\conxol-pptp-native-probe.exe --test-elevation
```

On 2026-11-09 the extended loopback check passed: the normal process sent and
received a synthetic packet through an elevated GRE socket, closed that socket,
waited 31 seconds disconnected, and received a second working socket from the
**same helper PID**, without another elevation launch. Explicit session shutdown
then verified that the helper process exited. No real VPN or credentials were
used. Routine tests validate broker argument framing, cancellation before UAC,
and two failed socket requests over the same usable named-pipe channel; they do
not display elevation prompts. UAC rejection and complete desktop Connect
interaction remain manual acceptance cases.


## SSH and Telnet attachments

New/edit SSH session > Network > PPTP attachment selects a manager profile.
Telnet exposes the same selector under its Network disclosure. Direct connection
remains the default. Opening an attached session automatically connects its
assigned profile using the saved PIN-vault password, then waits for encrypted
IP readiness before opening TCP. Concurrent sessions share a single connection
attempt; an already connected profile is reused without requesting its password.
Profiles without saved passwords can be manually connected with a transient
password, or saved in PPTP manager for automatic connection. Windows requests
permission through the existing app-session helper when needed. The assignment is saved as `pptp_profile_id` (UUID) in the
secret-free session record and survives editing, duplicate/export and workspace
backup. Older records without the field remain direct connections.

The first destination must be an explicit IPv4 address. With an SSH jump chain,
this means the first jump host; later destinations travel through SSH channels.
No system DNS lookup is used for the PPTP destination. SSH host-key inspection
uses the same selected tunnel before approval, and authentication still verifies
the approved pin. SFTP, shell branches and SSH forwarding share that authenticated
transport. Telnet keeps its existing negotiation and optional login behavior;
MPPE covers the PPTP leg but does not add end-to-end encryption to Telnet beyond
the PPTP server.

`conxol-pptp::transport` provides bounded Tokio duplex streams without a loopback
proxy listener. The owning tunnel worker polls up to 64 private TCP sockets,
with 64 KiB buffers and bounded admission, 15-second connect deadlines, explicit
backpressure, cancellation and EOF cleanup. Each tunnel owns its own connector;
an absent, removed or failed assignment returns an error rather than silently
using host networking. Automatic setup waits up to 120 seconds, reports the
worker failure, and respects an explicit Disconnect without restarting that
in-flight attempt. A later session/reconnect may start a fresh attempt. Tunnel disconnect closes attached transports.
SSH and Telnet reconnects automatically prepare the same assigned profile.
Closing or cancelling a waiting session leaves the independently managed tunnel
available to other sessions; explicit PPTP Disconnect and app exit stop it. Closing a terminal leaves the
shared PPTP tunnel running for other attached sessions.

`cargo xtask test-pptp-attachments` uses only synthetic peers: encrypted in-memory
IPv4/TCP streams with bidirectional data exceeding buffer capacity, cancellation
and tunnel loss, SSH fingerprint inspection/changed-key rejection and terminal
traffic through a supplied first-hop stream, and Telnet negotiation, data and
route-preserving reconnect failure. These tests do not invoke UAC, access real
credentials, create host routes or contact a VPN server. Real-device attachment
and Linux/macOS native PPTP support remain outside this verification.

Auto-connect regressions in `cargo xtask test-pptp` use an injected synthetic
worker: saved-password retrieval, sharing one pending/connected worker, explicit
cancellation, shutdown, missing-password refusal and negotiation failure. No UAC
or real networking is used for these regressions.
