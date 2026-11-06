# conxol-mtr

Native MTR library and standalone command-line tool, integrated into the
desktop through `conxol-network`. It does not execute `mtr`, `ping`,
`traceroute`, a shell, or a bundled helper. Workspace version is inherited;
this milestone does not produce a release or installer.

## First milestone

- Shared Rust sweep scheduler, typed per-probe progress and JSON reports.
- Per-hop loss, sent/received, last/average/best/worst latency; unanswered
  probes preserve router identity. Router changes reset that row's counters.
- Native Windows IPv4 ICMP through IP Helper, with owned handle cleanup.
- Native macOS IPv4 datagram ICMP sockets, checksummed requests, monotonic
  timing, bounded receive buffers and cancellation-aware polling.
- Echo matching checks source, identifier, sequence and payload nonce. Router
  errors match the quoted destination, protocol, identifier and sequence.
  Unrelated, truncated and invalid-checksum packets are ignored.
- Explicit unreachable replies terminate the sweep without claiming that the
  destination answered. Tool/permission failures are errors, never packet loss.

The library API takes a numeric unicast IPv4 destination and validated options:
1–32 hops, 1–10000 cycles, 1–2000 ms per-probe timeout and 100–10000 ms minimum
cycle interval. Only one probe is outstanding per run. Silent routes take up
to `max_hops * timeout` per sweep. Progress is emitted after each completed
probe and sweep; callers should coalesce UI events.

`run` (finite reports) and `run_live` (until cancelled) are synchronous: call it on a dedicated worker, pass an `AtomicBool` to
cancel, and join the worker before discarding its resources. macOS polling
checks cancellation every 20 ms. The initial synchronous Windows API checks
between sends: cancellation can take up to the configured timeout (2 s max).
Dropping a caller's future does not stop a worker automatically.

## Development

From the repository root:

```powershell
cargo xtask test-mtr
cargo clippy --locked -p conxol-mtr --all-targets -- -D warnings
cargo run --locked -p conxol-mtr -- --help
cargo run --locked -p conxol-mtr -- 127.0.0.1 2 4
```

The CLI emits one JSON object per completed sweep. Ctrl+C terminates the CLI;
library callers use the cancellation flag. No hostname resolution occurs.
Tests use synthetic packets/probes and a real local-loopback ICMP fixture;
they never contact an external destination or change OS/network settings.

Windows tests verify the native IPv4 loopback path. macOS needs the same test
command run natively to establish socket permissions, packet layout and reply
delivery on both Intel and Apple Silicon. Cross-checking compiles source only.

## Next milestones

1. Run the macOS native loopback suite and disposable routed-hop fixtures;
   validate TTL-expired, silence, unreachable replies and cancellation.
2. Add IPv6 with equivalent reply-matching tests for both platforms.
3. Add asynchronous Windows ICMP/event handling for prompt in-flight Stop.


Linux probing is outside this first milestone. The desktop adapter resolves
hostnames to IPv4; the standalone CLI accepts numeric IPv4 only. The desktop
coalesces progress into a bounded latest-value slot and joins the worker on Stop.
The former external MTR binaries, packaging resources and subprocess paths have
been removed.

## Native API references

- [Microsoft IcmpSendEcho](https://learn.microsoft.com/en-us/windows/win32/api/icmpapi/nf-icmpapi-icmpsendecho)
- [Apple XNU ICMP implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/netinet/ip_icmp.c)
  describes non-privileged ICMP datagram sockets and permitted IP_TTL options.

The shared native ICMP transport and packet parser live in `conxol-ping`; MTR
uses its `Session` with a per-hop TTL. No upstream MTR source is embedded.
