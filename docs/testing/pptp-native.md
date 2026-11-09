# Native PPTP feasibility (Windows)

The goal is per-session/per-group PPTP without host VPN profiles, route/DNS
changes, installed drivers, services, QEMU, or an external VPN client. This is
not implemented in the desktop yet. A standalone development probe now implements
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

1. Choose the app's privilege model for native GRE send/receive. The elevated
   standalone probe works; elevating the entire desktop is not assumed or enabled.
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

`tools/pptp-native/` is a separate Cargo workspace so its experimental legacy
authentication dependencies do not enter the desktop dependency graph. Crypto
crates compile into the executable; runtime networking uses Windows' built-in
Winsock API. No external VPN client, helper service, QEMU, or installed driver
is used. Elevated raw-socket access is still required.

The prototype has a bounded TCP control connection, validates PPTP framing and peer call
IDs, services control echoes, filters GRE by peer/local address and call ID,
acknowledges GRE sequence numbers, negotiates MS-CHAPv2 only, and checks the
server's RFC 2759 authenticator. PAP passwords are never sent. It rejects
changed authentication challenges rather than retrying credentials. The PPP
authentication phase has a 30-second deadline; TCP/control operations have separate deadlines.
An exit guard sends call-clear/stop-control messages and closes the TCP socket.
The GRE socket also closes on success or failure.

Build and synthetic tests (no sockets or real credentials used by these tests):

```powershell
cargo test --locked --manifest-path tools/pptp-native/Cargo.toml --target-dir target/pptp-native-build
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

Twelve synthetic tests pass: RFC 2759 authentication and RFC 3079 key/ciphertext
vectors; MPPE packet loss, duplicate/late rejection and rollover beyond 4096
packets; malformed framing; no-encryption/weak-mode refusal; IPCP address
assignment; bounded queues; encrypted ICMP echo; and a private TCP handshake
with an SSH-shaped synthetic banner transported over encrypted IP packets
between two in-memory stacks. No real socket is used by these tests. Clippy
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

**Limits:** this remains an isolated Windows development prototype, not a
desktop feature. Stateful/40-bit/56-bit MPPE, MPPC, IPv6, IP fragmentation, and
hostname resolution are not supported. Live TCP/SSH-over-VPN testing still
requires a user-selected target; TCP is verified with in-memory encrypted
fixtures. Desktop session/group settings, vault binding, async SSH byte streams,
and lifecycle integration remain separate work. Windows raw GRE still requires
administrator elevation.
