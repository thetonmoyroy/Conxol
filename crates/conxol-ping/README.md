# conxol-ping

Native Rust IPv4 Ping library and standalone CLI, integrated into the desktop
through `conxol-network`. No external `ping`, shell, or helper executable is
required. Windows uses the OS ICMP API; macOS uses non-privileged ICMP datagram
sockets. MTR consumes the same `Session` with per-hop TTL values.

The library provides finite and live schedulers, typed progress, sent/received
counts, last/average/best/worst latency and a bounded 200-line transcript. Timeouts
and router errors are distinct from successful destination echo replies. Local
permission/API failures return errors rather than being counted as packet loss.

Options support 0–65500 payload bytes, 1–60000 ms timeout, 200–60000 ms minimum
probe-start interval, and 1–10000 probes for finite runs. Probes never overlap.
IPv6 and Linux are currently unsupported; the desktop reports this explicitly.

## Development

```powershell
cargo xtask test-ping
cargo xtask test-mtr
cargo xtask test-network
cargo run --locked -p conxol-ping -- --help
cargo run --locked -p conxol-ping -- 127.0.0.1 2 32
```

The CLI emits one JSON object per probe; Ctrl+C exits. It accepts a numeric IPv4
target. The desktop adapter resolves hostnames to IPv4 with bounded cancellation-
aware DNS lookup. Use only explicitly authorized targets. Test fixtures use
synthetic packets/probes and local loopback, including zero and maximum payloads.

`run` and `run_live` block: use a dedicated worker and share an `AtomicBool` for
cancellation. macOS socket polling and interval waits check Stop every 20 ms.
The initial Windows backend uses synchronous ICMP: Stop during a send waits for
that send to finish, up to the configured timeout (60 s maximum). The desktop
joins the worker before publishing cancelled state; task drop also sets its flag.
Asynchronous Windows cancellation and IPv6 are follow-up work.

Windows native loopback tests and Apple Silicon cross-compilation are available
from this workspace. Cross-compilation does not establish macOS socket runtime
behavior; run all three test commands on a Mac before declaring native acceptance.

The platform transport and packet parser were moved from `conxol-mtr`, then
extended for configurable payloads. Both tools now use one implementation.
No release binary, installer, or version change is needed for development.
