# Network diagnostics

The diagnostics workspace uses compact tool controls above one full-height
CLI output pane. Select Port scan, DNS, TCP, SSH key, Ping or MTR.
Reports use selectable monospace text with Copy output and optional following. Scans require explicit Start,
ports 1–65535 (up to 4096 per run), concurrency 1–128 and a 50–60000 ms per-port
timeout. Rust owns all probes and cancellation. Progress remains batched at
64 results or 100 ms, with a final tail on completion/cancellation/failure.
UDP sends one empty datagram using a connected socket: reply = open,
connection refusal/reset = closed, silence = open-or-filtered, other errors =
failed. Empty probes do not identify services and many UDP services ignore them.

MTR uses the in-process `conxol-mtr` Rust engine on Windows and macOS.
No third-party MTR executable, system traceroute, shell invocation or helper
payload is used. The current native backend supports IPv4 addresses and
hostnames with an IPv4 result. IPv6 and Linux return an explicit unsupported
message; there is no external-tool fallback.

Loss, sent counts and latency accumulate per hop/router until Stop. Router
changes reset that row; silent probes retain the previous identity. Missing
latency is unavailable rather than zero. One probe is outstanding at a time,
with a maximum two-second timeout and a minimum one-second full-sweep interval.
Silent routes can take up to 64 seconds per 32-hop sweep. No global run deadline
ends a healthy live session.

The async adapter resolves the target within the request deadline and publishes
at most one latest-value snapshot per 100 ms. Memory is bounded to 32 hop rows.
Stop signals the worker and joins it before publishing cancelled state. Dropping
the async task also signals cancellation. Windows currently finishes an in-flight
synchronous ICMP send (at most two seconds); macOS checks Stop every 20 ms.
Permission/OS errors are diagnostic failures, never packet loss.

Run `cargo xtask test-network` and `cargo xtask test-mtr` for isolated loopback
and synthetic packet/statistics/cancellation regressions. No external hosts or
real credentials are used. TypeScript and lint validate renderer IPC. No release
build or installer is required.

macOS acceptance: run both test commands on a Mac, then launch the development
app from Finder and verify live reports and Stop against an authorized target.
Native socket permissions and routed-hop interoperability still need native Mac
verification; cross-compilation establishes source compatibility only.

## Live ping

Ping uses the in-process `conxol-ping` engine, with no system ping command or
localized text parsing. It runs until Stop, with a configurable minimum
start-to-start interval of 200–60000 ms (default 1000) and ICMP payload size of
0–65500 bytes (default 32, excluding IP and ICMP headers). Probes are serial,
so a slow probe extends the interval. The native timeout is 1–60000 ms; the
existing desktop input bounds are 50–60000 ms.

The engine records actual native reply timing, sent/success counts, last/average/
best/worst latency and up to 200 recent transcript lines. A timeout is loss;
unreachable or TTL-expired messages are not successful destination echoes;
local socket/permission errors terminate with an error. The desktop bridge uses
a bounded latest-value channel and joins the native worker on Stop. Dropping
the task also signals cancellation. Windows uses synchronous ICMP calls, so an
in-flight Stop can wait up to the configured timeout (60 seconds maximum).
macOS polls cancellation every 20 ms; between probes both check every 20 ms.

This version supports IPv4 on Windows and macOS. The desktop resolves hostnames
to IPv4 with a deadline and cancellation. IPv6 and Linux are explicitly
unsupported; no external fallback is used. The CLI accepts numeric IPv4 only.
MTR reuses conxol-ping's native ICMP transport with per-hop TTL settings, avoiding
duplicate packet parsers and platform implementations.

Run `cargo xtask test-ping`, `cargo xtask test-mtr`, and `cargo xtask test-network`.
Fixtures cover packet validation, zero/maximum payloads, loss versus errors,
intervals, cancellation, statistics, MTR reuse and actual local-loopback probes.
No tests query external targets or change network settings. macOS native runtime
acceptance is still required; Apple Silicon cross-checks only compile source.
