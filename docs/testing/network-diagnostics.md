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

MTR publishes cumulative numeric hop reports until Stop is pressed. One probe
cycle is requested per update, at most once per second, with a 60-second per-cycle
backstop. Loss, sent counts and latency statistics accumulate per hop/router;
a changed router at the same TTL resets that row. Missing latency is shown as
unavailable rather than zero. Stop or leaving diagnostics cancels the subprocess.
No global run deadline terminates a healthy live session.
Windows x86_64 includes windows-mtr v1.2.9, sourced from
`tools/mtr/windows-x86_64` into the packaged `helpers/mtr` resource directory,
with its Apache-2.0 license, README, checksum and provenance. The preparation
hook verifies the pinned binary hash and required distribution files.
The release app invokes the resource path. Debug builds may use the repository
binary. Linux/macOS use system mtr JSON reports. Probe permissions and firewall
policy can affect results. Only report mode is used; no API server or TUI starts.

Run `cargo xtask test-network` for isolated loopback regressions, including UDP
reply/silence/cancellation and the Windows bundled-MTR report. No external
hosts or real credentials are used. TypeScript and lint validate renderer IPC.
No release build or installer is required for these checks.

## Live ping

Ping runs until Stop or diagnostics cancellation, with a configurable minimum
start-to-start interval of 200–60000 ms (default 1000) and ICMP payload size of
0–65500 bytes (default 32, excluding headers). Probes run serially, so a slow
probe can extend the interval. Each native ping process is bounded by the
selected timeout and can be cancelled during execution or between probes.
The CLI shows one native reply/timeout line per packet with sequence numbers,
and a single running summary with successful probe counts,
loss and elapsed run time. Native output supplies reply timing; process
runtime is not presented as round-trip latency. Repeated native process headers and per-packet summaries are removed.
Only the last 200 reply lines are
retained while counts accumulate. Controls are disabled during the run.
Isolated tests cover payload arguments, bounds, repeated loopback replies,
interval timing and cancellation while waiting for the next probe.
