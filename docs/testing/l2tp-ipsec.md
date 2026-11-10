# Private L2TP/IPsec

Tools > PPTP / L2TP manager offers PPTP, plain L2TP, and L2TP/IPsec (PSK).
IPsec credentials consist of a PPP username/password and a separate PSK.
When saved, the password and PSK share one encrypted native-vault record;
profiles expose only its credential reference. Existing backup reference
collection and rebinding therefore includes both secrets. Replacing saved
IPsec credentials requires both secrets; removing credentials removes both.
Temporary connection credentials are not saved.

`crates/conxol-pptp/src/ipsec.rs` implements an IPv4 IKEv1 initiator using
Main Mode PSK authentication, MODP group 14, AES-128-CBC, and HMAC-SHA1.
Quick Mode selects AES-128-CBC/HMAC-SHA1-96 ESP with UDP transport-mode
selectors for L2TP port 1701. RFC 3947 NAT traversal is required; UDP
encapsulation is forced, with IKE starting at server port 500 and floating
to 4500. The original ephemeral local UDP socket remains private to the
worker. `l2tp::Tunnel::connect_ipsec` negotiates L2TP over this encrypted
datagram facade before the existing MS-CHAPv2 PPP/IPCP path starts.

The implementation does not create host interfaces, VPN profiles, routes,
DNS settings, firewall rules, or kernel IPsec policies. There is no fallback
to plain L2TP. SSH, Telnet, Web and diagnostics use the same explicitly
assigned profile and private userspace IP stack as PPTP.

The peer's Main Mode authenticator and Quick Mode hashes are verified before
ESP keys are installed. ESP authentication precedes CBC decryption and replay
window updates. The receive window covers 64 sequence numbers; sequence zero,
replay, bad SPI, bad authentication tags, bad padding and non-UDP trailers are
rejected. IKE exchanges have bounded retries/deadlines and cancellation.
Authenticated Quick Mode retransmissions receive the cached final response;
NAT keepalives run on the worker's receive path. Normal teardown sends
encrypted L2TP closure and authenticated ESP/IKE Delete payloads.

This initial backend has a deliberately narrow negotiation profile. It does
not implement Aggressive Mode, XAuth, IKEv2, certificate authentication,
raw ESP, alternative algorithms, Quick Mode PFS, or rekeying. SAs expire
locally after 25 minutes, before the advertised 30-minute ESP lifetime;
reconnect is required. Servers selecting shorter lifetimes are rejected.
Server-initiated rekeys and DPD extensions are not negotiated. A server must
permit the stated suite and selectors. Real appliance interoperability has
not been established by the automated tests.

Run `cargo xtask test-pptp` for isolated native checks. The IPsec tests include
RFC 2202 HMAC and NIST CBC vectors, bounded proposal/payload parsing, ESP
authentication/replay/reordering/sequence exhaustion/expiry checks, cancelled
handshakes, and a disposable loopback responder covering Main Mode, peer
authentication failure, Quick Mode and bidirectional ESP-protected UDP.
The manager tests cover PIN-vault round trips, replacement, removal and
protocol changes. No test uses production hosts, credentials or system VPN
configuration. Frontend checks are `pnpm --dir apps/desktop test:unit`,
`pnpm --dir apps/desktop check`, and `pnpm --dir apps/desktop lint`.

Protocol references: [IKEv1](https://www.rfc-editor.org/rfc/rfc2409),
[IPsec DOI](https://www.rfc-editor.org/rfc/rfc2407),
[NAT traversal](https://www.rfc-editor.org/rfc/rfc3947),
[UDP ESP encapsulation](https://www.rfc-editor.org/rfc/rfc3948), and
[ESP](https://www.rfc-editor.org/rfc/rfc4303).
