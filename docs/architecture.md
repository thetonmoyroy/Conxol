# Architecture overview

```text
React / TypeScript / xterm.js (apps/desktop/src)
                  ↓ typed Tauri commands and events
Rust desktop managers (apps/desktop/src-tauri/src)
                  ↓ native transport and persistence APIs
Workspace crates / isolated protocol helpers
                  ↓
SSH / SFTP / SCP / PTY / tunnels / serial / Telnet / diagnostics
```

React owns interaction, layout, terminal rendering, and transient editor
content. Rust owns connections, filesystem changes, credential lookup, child
processes, cancellation, persistence, and lifecycle state. The browser preview
uses synthetic state; a working preview alone does not prove native behavior.

SSH terminal output is coalesced in the Rust desktop shell pump into at most
32 KiB raw byte chunks, with an 8 ms periodic flush for small interactive updates.
The same batcher remains active while writes/resizes drain remote output; its
pending tail flushes before shell teardown or reconnect. Native UTF-8 decoding
preserves characters across chunk boundaries. The renderer receives display text,
never SSH packets. Port-scan progress carries arrays of up to 64 results, published
after 100 ms of result progress or at the size limit; completion/cancellation/error
events carry the remaining results. SSH/SFTP, socket I/O, forwarding, DNS, ping and
traceroute processing remain Rust-owned. React merges scan batches for display.

## Where a contribution belongs

| Location | Responsibility |
| --- | --- |
| `crates/conxol-core` | Secret-free session/settings/snippet/macro/audit models; connection/transfer state transitions; terminal batching |
| `crates/conxol-ssh` | russh transport, per-hop trust/authentication, PTY channels, SFTP/SCP, forwarding, bounded remote editing/monitoring, X11 channels |
| `crates/conxol-store` | Versioned atomic persistence; OpenSSH and profile import/export; validation and corruption refusal |
| `crates/conxol-vault` | PIN-encrypted native credentials and legacy portable vault using Argon2id/AES-GCM; zeroizing secret material |
| `crates/conxol-network` | Bounded DNS/TCP/scan and async native Ping/MTR adapters |
| `crates/conxol-ping` | Shared native IPv4 ICMP transport, Ping statistics/scheduler and CLI |
| `crates/conxol-mtr` | Native MTR sweep scheduler and hop statistics, using conxol-ping transport |
| `crates/conxol-telnet` | Plaintext Telnet negotiation, transport, and lifecycle |
| `crates/conxol-serial` | Serial configuration, transport, and recoverable device loss |
| `crates/conxol-remote-desktop` | Versioned bounded helper frames, capability validation, credentials/control separation, process supervision |
| `apps/desktop/src-tauri/src/main.rs` | Tauri command registration, app stores/vaults, sanitized diagnostics, native pickers |
| `apps/desktop/src-tauri/src/{ssh,terminal,network,serial,telnet,remote_desktop}.rs` | Session/job managers, typed request validation, cancellation, event routing, cleanup |
| `apps/desktop/src/App.tsx` and focused `.ts` modules | Operator UI and interaction policies, including macro targets, paste confirmation, remote paths, and saved-session requests |
| `tools/vnc-helper` | Isolated experimental VNC engine and controlled local RFB fixtures; normally packaged |
| `tools/rdp-helper` | Isolated experimental IronRDP engine and opt-in local server fixtures; excluded from normal bundles under its advisory gate |
| `xtask` | Sanitized developer validation, helper staging, packaging/checksum/layout audits, benchmarks |
| `benchmarks`, `fuzz` | Synthetic in-memory probes and isolated fuzz targets |
| `site`, `tools/release-assets.mjs` | Static project presentation and installer/version/checksum validation |

The two helper tools have separate Cargo workspaces/lockfiles. Keeping the RDP
candidate outside the desktop workspace prevents its experimental crypto and
native dependencies from weakening the SSH or portable-vault boundaries.

## Follow an SSH workflow

A saved profile contains host metadata, trust configuration, and opaque vault
references. The renderer creates a typed request. The native SSH manager
validates it and retrieves credentials inside Rust, then calls
`SshConnection::connect` or `connect_with_jump_chain`. Every hop verifies its
own key before authentication. The resulting connection opens PTY/SFTP or
forwarding channels. Bounded events route output/progress to the matching
terminal/transfer in the renderer.

SSH, Telnet and serial attachment replay retained startup output through the
same event stream as live text, under the session lock before live publication
is enabled. The frontend registers its listener before requesting attachment;
it does not replay a separate IPC response. [Ordering checks and limits](testing/terminal-attachment.md).

Terminal keyboard, paste and macro input shares a bounded FIFO per native ID.
Local PTY writes reserve one writer before running on a blocking worker;
queued actions recheck lifecycle bindings before dispatch. [Input recovery and
validation scope](testing/terminal-input.md).

Session closure uses a separate cancellation signal, observes in-flight
setup/reconnect work, and cleans up owned transfers/tunnels. EOF on a shell
does not discard a later exit status; normal shell exits and transport loss
follow different manager paths. Setup deadlines do not expire a healthy quiet
connection.

Remote files, terminal output, and helper messages remain untrusted. Editing
uses bounded reads and revision checks before complete-file promotion with
rollback attempts. See the [threat model](security/threat-model.md),
[SSH lab](testing/ssh-lab.md), and individual [decision records](adr/).

RDP/VNC interoperability, hardware serial behavior, signing, and full platform
runtime coverage are tracked separately in the [roadmap](../ROADMAP.md) and
[evidence matrix](testing/hardware-interoperability.md).

SSH interactive login asks once per host, port, and username whether to save a
password after the complete connection succeeds. Yes stores it in the native OS
credential store; No remembers the decline. Single `Password:` and `Enter password:`
challenges qualify.
The reference is derived from host, port, and username. Subsequent connections
reuse it once per authentication attempt; repeated challenges prompt again. OTPs
and multi-prompt challenges are never saved. Credential-store failures leave login
usable but cannot provide automatic login. Secrets are never stored in profiles.


## One-line command shortcuts

Shortcuts is separate from the existing macro editor, recording, and approved
multi-step execution. The Shortcuts menu or two plain Shift taps opens a search
for the current device and shared commands. Clicking a result or pressing Enter
pastes one line into the current text terminal without appending Enter. Shift
combinations, text-form input, other dialogs, and locked workspaces do not open it.
Broadcast, recording, and macro execution must be stopped before shortcut paste.

`command-shortcuts.ts` validates command text and filters device scopes.
`ShortcutCenter.tsx` provides search and the name/command/device editor. Records
reuse the native snippet store with a `conxol:shortcut` discriminator and an
optional `conxol:shortcut-device:` tag; ordinary Snippets excludes these records.
Saved profiles use their stable profile ID, while unsaved connections use a
protocol/endpoint identity. A newly saved connection adopts its saved profile ID.
Pasting reuses terminal lifecycle binding and queued native writes, rechecks the
device, and rejects line breaks and control characters before sending any text.

Terminal right-click offers **Save as shortcut** for a single selected command.
It opens an unsaved shortcut draft with the selected text and source pane's
device scope. Empty, multiline, oversized, or control-character selections are
rejected. The operator names and saves the draft explicitly; selection capture
never writes to a terminal or executes the command.


## Sanitized diagnostic export

Help → About exports diagnostics through the native `diagnostic_export_save` command,
which opens an OS Save dialog and writes the generated JSON to the chosen file.
Cancellation returns without a write; file errors are reported without exposing
the destination path. Renderer-supplied report contents and paths are not accepted.
Report schema 2 includes runtime metadata, the actual client SSH algorithm
preferences, and the latest 64 failure records kept in memory since app launch.
`conxol-ssh::diagnostics` captures errors before the normal short UI mapping:
raw library variants, OS error codes/standard OS messages, sanitized negotiation
algorithm lists from both peers, stage, timestamp, opaque attempt ID, timeout, and
jump count. Task-local scopes correlate host-key inspection, connection, and
reconnection records without storing a target address. Authentication and shell
setup errors are also captured. Credential lookup records retain the keyring error
variant while omitting its payload. User-cancelled authentication is not logged.

The recorder deliberately excludes requests, host/user identities, credential
references/values, private-key bytes, prompts/responses, commands, terminal output,
local paths, general logs, and arbitrary server/context strings. Untrusted
algorithm tokens, source-chain length, text size, and ring length are bounded.
Reproduce the SSH failure and export before restarting; history is not written to
an automatic log file or recovered from an earlier app session. Run
`cargo xtask test-diagnostics` and `cargo xtask test-ssh` for export, retention,
redaction, correlation, and synthetic handshake/authentication regressions.

SSH setup classifies EOF, reset, abort, broken pipe, and transport disconnects as
closure during handshake before authentication, separately from refusal, trust
rejection, incompatible algorithms, and authentication rejection. This is a failure
classification, not a device-specific compatibility fallback. The host-key
inspection loopback regression sends no credentials and accepts no host key.


## Full encrypted workspace backups

Settings → Backup owns the create/restore workflow. Help → About owns sanitized
support diagnostics; the Vault tab contains credential-vault controls only.
`backup.rs` captures saved sessions, settings, shortcuts/snippets, macros, notes,
audit history, SSH trust, the workspace PIN policy, referenced SSH key/known-hosts
files, and an allowlist of renderer layout preferences. PIN-encrypted native
credentials, indexed credentials, session/jump/gateway password references, and
unlocked portable-vault credentials are collected natively. Locked or missing
required credentials cause export to fail rather than silently omit passwords.
Neither credential values nor private key files are sent to React. Newly stored
native credentials are indexed to support complete future exports.

The `.cxb` envelope uses AES-256-GCM authenticated encryption, Argon2id with fixed
64 MiB / three iterations, fresh salt and nonce, a versioned domain header, and a
64 MiB ciphertext payload limit. Decrypted archive/credential buffers are zeroized;
file names and counts are bounded and validated. Only the fixed workspace file
allowlist can be staged. Backup files must be saved outside the workspace folder.

Restore first chooses a native file and returns an opaque selection token and
filename. Password verification returns only a preview and a second opaque restore
token. After explicit confirmation, a private sibling workspace is staged and
validated; referenced keys are embedded, credentials get fresh native-vault IDs,
and all session references are rebound. Credential/activation failure removes new
secrets. A single atomic `active-workspace.json` pointer switches the workspace;
original data remains in place. Further mutations are blocked until restart, when
native stores load the selected workspace and allowlisted layout preferences are
applied. When restoring saved passwords, the current unlocked workspace PIN encrypts
them in the staged workspace policy; after restart, use that current PIN.
A restore without credentials keeps the archived PIN policy. Existing file-backed
portable credentials in an explicitly restored backup also use the native vault.

Run `cargo xtask test-backup` for synthetic round-trip, wrong-password, tamper,
path, invalid-data, missing-secret, token, and rollback regressions. The tests use a
fake vault and disposable files; they never enumerate or read the user's keyring.


## Automatic SSH authentication

New SSH connections default to **Auto**. Manual agent, private-key, and saved
credential overrides remain inside the Advanced SSH authentication disclosure.
For compatibility with saved profiles and backups, Auto retains the existing
`keyboardInteractivePrompt` request and session encoding.

After host-key verification, Auto sends an SSH `none` method probe to discover
the server's offered authentication methods without sending a secret. It chooses
keyboard-interactive for challenge/MFA servers, password prompting for
password-only servers, or the SSH agent for public-key-only servers. It never
searches for private-key files; a file key can be supplied through Advanced.
A misleading keyboard-interactive advertisement can fall back to password only
if the server rejects it before any challenge, no partial authentication has
succeeded, and password is advertised. Rejected secrets are not retried through
another method; partial MFA and cancellation preserve their existing boundaries.
The interactive timeout, secret ownership, host-key policy, and per-hop prompt
ownership are retained. Newly entered jump hosts use Auto too; saved explicit
jump authentication settings remain intact.

Diagnostics retain the attempted method, server remaining-method list, and
partial-success flag on an authentication rejection. The generic connect-stage
summary is suppressed when that attempt already has a more specific failure.
Disposable loopback tests cover password-only and misleading advertisements,
rejected responses, partial MFA, and cancellation without password transmission.

## SSH terminal branches

The text-terminal context menu offers Branch session for connected SSH terminals.
It opens an independent PTY on the authenticated transport and places it in a
right-hand split. Branch setup never replays the profile startup command or
startup directory. Closing the branch closes its channel, not the transport;
closing or losing the parent transport also ends its branches. Shared branches
do not reconnect automatically or clone the parent's CLI/configuration mode.
If opening another shell fails, a saved SSH profile can open a separate login
after an explicit fallback prompt, using normal trust/authentication and omitting
startup input. Unsaved connections need a saved profile for that fallback.

Split layout operations live in `apps/desktop/src/terminal-layout.ts`. Placement
is idempotent across login setup/completion. Terminal tab clicks and keyboard
cycling preserve an existing split or restore its remembered group and ratios;
closed or regrouped panes are removed when a saved layout is restored. Layout
memory lasts for the current application run.

`cargo xtask test-ssh-branch` runs sanitized native queue/admission regressions
and real SSH loopback tests for channel isolation, skipped startup input,
shared authentication, branch close and shell rejection. Frontend split regression
coverage is included in `pnpm --dir apps/desktop test:unit`. Real Cisco, Juniper,
and Huawei behavior still needs device acceptance testing.

## CIDR scans and native DNS reports

Port scan targets accept a single IP, hostname, or IPv4/IPv6 CIDR. A run is
bounded to 256 expanded addresses, 4096 ports, 65536 aggregate host/port checks,
and 128 workers shared across the whole range. IPv4 ranges up to /30 omit
network/broadcast addresses; /31 and /32 include all addresses. IPv6 includes
all addresses in the accepted bounded prefix. CIDR host bits are normalized.
Progress includes the aggregate total and preserves each host/port result;
frontend merging keys on both host and port. Cancellation aborts/joins all
in-flight checks through the existing scheduler.

`crates/conxol-network/src/dns.rs` implements native DNS diagnostics using Hickory
for wire encoding/decoding and record formatting. The report includes response
flags/code, question/answer/authority/additional sections, TTLs, EDNS when
returned, selected server, transport, query duration, and received size. Query
types include A, AAAA, CNAME, MX, NS, TXT, SOA, PTR, SRV, and CAA. PTR converts
literal IPs into reverse names. An explicit resolver IP overrides system DNS;
Windows uses active adapters via ipconfig and Unix reads /etc/resolv.conf.
There is no public-resolver fallback or external dig dependency. UDP replies
must match the query ID, opcode, question, and response bit; truncated replies
retry on TCP under the same deadline. Wire packets and formatted output are
bounded, with a 64 KiB report limit.

`cargo xtask test-network` uses disposable loopback peers for DNS records,
negative replies, wrong transaction IDs, UDP-to-TCP retry, timeouts and CIDR
scans. It never queries a real DNS server or scans an external subnet.

Port scan CLI rows display confirmed open ports only (UDP silence remains
inconclusive and is excluded). Progress counts every completed host/port check,
with an indeterminate bar during setup and a count/percentage once the native
total arrives. Terminal/cancelled/failed scans retain their current progress.
All diagnostic tool consoles provide Export text, saving an exact UTF-8 snapshot
of the currently displayed report through a native Save dialog. Export works
while a live test runs without stopping it. The native export accepts only known
tool names and bounds content at 16 MiB; it is distinct from the sanitized
support-diagnostics JSON export. Browser previews use a text download.


## Telnet form login

New Telnet sessions accept optional username/password fields and an explicit
Save password checkbox. The password field is uncontrolled and cleared on submit;
secrets are sent only to the native manager, outside terminal input recording and
broadcast. Saved profiles contain username and an opaque system credential-store
reference, never password text. Blank fields preserve manual terminal login.
The native manager recognizes conventional initial username/login/password prompts,
including fragmented ANSI-colored prompts, and sends each field once per connection.
Rejected credentials fall back to manual login; reconnect resets the prompt tracker.
Automatic login expires after 60 seconds and stops at a conventional shell prompt.
Telnet remains unencrypted. Nonstandard device prompts need manual login.
Run `cargo xtask test-telnet` for isolated synthetic prompt/attachment regressions.


## Verbose TCP connection diagnostic

Diagnostics > TCP check defaults to port 80; SSH host-key inspection retains its
independent port 22 field. `network_check_tcp` returns `TcpConnectReport` from
`crates/conxol-network/src/tcp_report.rs`. Its text includes resolution details,
up to 16 distinct IPv4/IPv6 endpoints, sequential connection attempts and timing,
local/remote socket endpoints, OS failure details, and a final summary. It also
reports separate millisecond timings, remaining deadline, address-family counts,
local socket buffer sizes, keepalive, TCP_NODELAY, SO_LINGER, and outgoing TTL/hop
limit where the OS exposes them. Socket buffer sizes are not negotiated TCP
windows, and connect latency is not a packet-capture RTT. One shared
deadline bounds DNS and all attempts. The connection closes after the handshake;
no application data is sent and open TCP is not treated as proof of HTTP/TLS health.
Port scans retain their compact result format. Copy/export use the displayed
report. `cargo xtask test-network` covers disposable loopback success/refusal,
expired deadlines, and invalid requests without querying external targets.

## PIN-encrypted native credential store

The desktop uses `workspace_lock::NativeVault` for SSH auto-login, explicit saved
credentials, Telnet, and backup restore. It does not access OS credential stores
or migrate old Keychain/Credential Manager records. Configure the existing 4–12
numeric-digit screen-lock PIN before saving passwords. Connections without saved
passwords remain available without a PIN.

`workspace-lock.json` contains the PIN verifier and an encrypted credential blob.
The credential encryption key is derived separately with an independent random
salt using Argon2id (64 MiB, three iterations); the stored verifier cannot decrypt
it. AES-256-GCM uses a fresh nonce on each save. The existing portable file format
and bounded decoder are reused through `EncryptedCredentials`. The PIN itself
is never persisted. Longer PINs better resist offline guessing of a copied file;
the unlock retry delay only limits attempts through the app.

Unlock verifies the PIN and authenticates the blob before enabling access. Manual
and idle locks drop decrypted credentials and their zeroizing key. Credential
changes and PIN changes serialize through the same native operation lock. A PIN
change atomically saves its new verifier and re-encrypted blob in one private
file; failed writes preserve the previous in-memory state. Disabling protection
requires deleting saved credentials first. Legacy portable-vault controls remain
available explicitly, with no OS fallback.
