# Repository-local russh patch

Baseline: [russh 0.63.3](https://github.com/Eugeny/russh/releases/tag/v0.63.3),
crates.io archive SHA-256
`036204edbd199552a5b3832f63c60dcdf395dc44c7f06b4af1c0e8139cc11bce`.
Packaged source commit: `f33baf439be8c59c49cb6cb2ae5976c579495bdf`.
Apache-2.0; original source headers and README remain. The archive omits its
license file, so this copy includes the canonical Apache-2.0 text.

The keyboard-interactive handler previously awaited an application response
inside the packet reader. A user leaving the dialogue unanswered therefore
prevented peer disconnects from being processed. The local change returns to
the packet loop immediately and handles answers through `Session::handle_msg`.
One pending flag refuses overlapping challenges, new authentication during a
challenge and unsolicited answers; terminal authentication results clear it.
`client_send_auth_response` is visible to its parent module for that route.

Regression: `cargo test --locked -p conxol-ssh --test authentication`.
It includes a real loopback peer disconnect while a responder never completes,
requiring cancellation within one second and no response packet. Multi-round
and distinct password/OTP cases exercise normal answer delivery. No upstream
fix or upstream test-suite result is claimed. Remove this local copy when an
upstream release fixes the same behavior and these regressions pass unchanged.

The client packet loop also selects pending writes alongside reads. Awaiting
the entire flush previously stalled concurrent large PTY/SFTP streams over
two nested jump channels. Further application output stays in bounded queues
while a flush is pending; unsent replies exceeding twice the configured receive
window are refused. `src/sshbuffer.rs` retains a partial-write cursor across
select turns, so resuming a flush cannot duplicate its ciphertext prefix.
Sent-prefix compaction occurs after at least half the buffer has been written.
Final disconnect retains a final flush. Regression and limits:
[8 MiB concurrent IPv6/OpenSSH streams](../../docs/testing/routed-ipv6-streams.md),
run with `cargo xtask test-ssh` and `cargo xtask check`. Remove these changes only
when the concurrent stream and existing authentication regressions pass with
an upstream replacement.

The client handle additionally owns an `AbortHandle` for its packet task.
`abort_transport` wakes an existing `Abortable` wrapper and drops the owned
transport when that task is polled, without queuing a disconnect behind
ordinary protocol messages. Conxol uses this only when a remote-forward
approval or revocation is unconfirmed: dropping a polled request, exceeding
its deadline, malformed allocation or failed revocation retires that SSH
connection. Confirmed forwarding and explicit approval refusal preserve the
transport. Loopback regression: `cargo test --locked -p conxol-ssh --test forwarding`.
No upstream equivalent or upstream test-suite result is claimed.

The workspace excludes this dependency from its own test targets, and its
library test/doctest targets are disabled in the local manifest. Upstream
examples, benchmarks, external tests, development dependencies, library/client
test modules, key format fixtures, inline key fixtures and the key-bearing documentation
example are omitted; production code is otherwise unchanged except for the
client/packet-writer changes above. Conxol generates test credentials in memory. Remaining
inline upstream tests are not executed as workspace tests.

`src/keys/format/mod.rs` retains upstream PEM delimiter literals. Its exact
unmodified SHA-256 is
`7ca4a796a523df1063f0ea0bac1b6d869288dd100d041a6455f8bd7d73b15678`.
The pre-push audit permits markers only in those exact indexed bytes; edited
parser bytes or markers in any other indexed file are refused. No private-key
fixture is included. The root dependency retains `default-features = false`
and enables only `aws-lc-rs` and `flate2`; RSA remains disabled.

## Legacy SSH2 transport compatibility

`keys::key::verify_server_signature` uses AWS-LC public verification for
RSA SHA-1/SHA-256/SHA-512 server signatures with 512–8192-bit keys.
For 512–1023-bit public keys only, `keys::legacy_rsa` calls AWS-LC
`RSA_new_public_key` and `RSA_verify` through aws-lc-sys 0.44. This narrow path
keeps strict PKCS#1 v1.5 padding/DigestInfo verification and bounded public
modulus/exponent inputs. No private key or raw RSA operation is used. The
512-bit size cannot accommodate a SHA-512 signature; verification rejects it. Signature
algorithms must match negotiation. Short unsigned RSA signatures are left-padded
to modulus width; oversized signatures, invalid padding, and altered messages
remain rejected. RSA private-key parsing/signing and the advisory-gated `rsa`
feature remain disabled.

Conxol appends ssh-rsa and ssh-dss after modern host-key algorithms. It also
appends SHA-1 DH group14/group-exchange/group1, AES-CBC/3DES, and SHA-1 MACs
(including the 96-bit truncated variant) after modern transport preferences.
The existing `des` and `dsa` features enable those implementations.
`mac::crypto` supports an explicit truncated output length while retaining
full-length HMAC key material and constant-time verification. Client GEX accepts
an explicitly configured 1024-bit minimum; its default stays unchanged. Conxol
requests 1024/3072/8192-bit min/preferred/max GEX bounds.

Host-key approval, pinning, and changed-key rejection remain required. No clear
cipher, null MAC, or SSH1 support is enabled. This is legacy SSH2 compatibility,
not a claim of support for every historical SSH implementation.

Regressions: `cargo xtask test-ssh` includes 36 combinations of SHA-1 KEX,
CBC ciphers and SHA-1 MACs plus a DSA-only peer on disposable loopback sockets.
Public-only OpenSSL-generated RSA vectors cover 512-, 768-, 1024- and 2048-bit signatures,
short signatures, algorithm mismatches, oversized signatures, and tampering.
No fixture private key is retained; no upstream result is claimed.

## PKCS#5 feature-gated local variable

`src/keys/format/pkcs5.rs` names its decrypted key buffer `_sec` because its
consumer is compiled only with the disabled `rsa` feature. This suppresses the
unused-variable warning without changing decryption or key-support behavior.

Focused RSA verifier regressions: `cargo xtask test-ssh-signatures`. The direct
aws-lc-sys dependency must stay aligned with aws-lc-rs's backend version.
