//! Bounded, administration-focused network diagnostics.
//!
//! This crate deliberately does not provide an unrestricted scanner. Every
//! scan has an explicit host or bounded CIDR, a bounded port range, a timeout, and a
//! cancellation receiver. Tests use loopback listeners only.

mod dns;
pub use dns::{DnsLookupResult, DnsRecordType, lookup_dns};

use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::process::{Output, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::net::{TcpStream, UdpSocket, lookup_host};
use tokio::process::Command;
use tokio::sync::watch;
use tokio::task::JoinSet;
use tokio::time::Instant;

const MAX_PORTS_PER_SCAN: u16 = 4096;
const MAX_SCAN_HOSTS: usize = 256;
const MAX_SCAN_CHECKS: usize = 65_536;
const MAX_CONCURRENCY: usize = 128;
const MAX_TRACE_HOPS: u8 = 32;
const MAX_TRACE_LINES: usize = 64;
const MAX_TRACE_LINE_BYTES: usize = 256;
const MAX_DIAGNOSTIC_OUTPUT_BYTES: usize = 64 * 1024;

#[derive(Debug, Error)]
pub enum NetworkDiagnosticError {
    #[error("network diagnostic target is invalid")]
    InvalidTarget,
    #[error("port range is invalid or exceeds the bounded diagnostic limit")]
    InvalidPortRange,
    #[error("CIDR scan must contain at most 256 hosts and 65536 host/port checks")]
    InvalidScanRange,
    #[error("network diagnostic timed out")]
    Timeout,
    #[error("DNS lookup failed")]
    Resolution,
    #[error("network diagnostic was cancelled")]
    Cancelled,
    #[error("network diagnostic worker failed")]
    Worker,
    #[error("network diagnostic process failed")]
    Process,
    #[error(
        "MTR could not run. Check that the bundled MTR helper is present and that packet probes are permitted."
    )]
    MtrUnavailable,
    #[error("network diagnostic output exceeded the safety limit")]
    OutputTooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TcpCheckOptions {
    pub host: String,
    pub port: u16,
    pub timeout: Duration,
}

impl TcpCheckOptions {
    pub fn validate(&self) -> Result<(), NetworkDiagnosticError> {
        validate_host(&self.host)?;
        if self.port == 0 || self.timeout.is_zero() {
            return Err(NetworkDiagnosticError::InvalidTarget);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TcpPortStatus {
    Open,
    Closed,
    TimedOut,
    OpenOrFiltered,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpCheckResult {
    pub host: String,
    pub port: u16,
    pub status: TcpPortStatus,
}

pub async fn check_tcp(options: TcpCheckOptions) -> Result<TcpCheckResult, NetworkDiagnosticError> {
    options.validate()?;
    let host = options.host.clone();
    let status = match tokio::time::timeout(
        options.timeout,
        TcpStream::connect((options.host.as_str(), options.port)),
    )
    .await
    {
        Ok(Ok(stream)) => {
            drop(stream);
            TcpPortStatus::Open
        }
        Ok(Err(error)) => tcp_error_status(error.kind()),
        Err(_) => TcpPortStatus::TimedOut,
    };
    Ok(TcpCheckResult {
        host,
        port: options.port,
        status,
    })
}

fn tcp_error_status(kind: io::ErrorKind) -> TcpPortStatus {
    match kind {
        io::ErrorKind::ConnectionRefused => TcpPortStatus::Closed,
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => TcpPortStatus::TimedOut,
        _ => TcpPortStatus::Failed,
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanProtocol {
    #[default]
    Tcp,
    Udp,
}

/// A UDP reply establishes open; silence is inconclusive. The timeout covers
/// DNS, bind, connect, send and receive. No raw sockets or elevated privileges.
pub async fn check_udp(options: TcpCheckOptions) -> Result<TcpCheckResult, NetworkDiagnosticError> {
    options.validate()?;
    let probe = async {
        let address = lookup_host((options.host.as_str(), options.port))
            .await?
            .next()
            .ok_or_else(|| io::Error::from(io::ErrorKind::AddrNotAvailable))?;
        let socket = UdpSocket::bind(if address.is_ipv4() {
            "0.0.0.0:0"
        } else {
            "[::]:0"
        })
        .await?;
        socket.connect(address).await?;
        socket.send(&[]).await?;
        let mut reply = [0u8; 2048];
        socket.recv(&mut reply).await?;
        Ok::<_, io::Error>(())
    };
    let status = match tokio::time::timeout(options.timeout, probe).await {
        Ok(Ok(())) => TcpPortStatus::Open,
        Ok(Err(error)) => match error.kind() {
            io::ErrorKind::ConnectionRefused | io::ErrorKind::ConnectionReset => {
                TcpPortStatus::Closed
            }
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => TcpPortStatus::OpenOrFiltered,
            _ => TcpPortStatus::Failed,
        },
        Err(_) => TcpPortStatus::OpenOrFiltered,
    };
    Ok(TcpCheckResult {
        host: options.host,
        port: options.port,
        status,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortScanOptions {
    pub host: String,
    pub start_port: u16,
    pub end_port: u16,
    pub concurrency: usize,
    pub timeout: Duration,
}

impl PortScanOptions {
    pub fn validate(&self) -> Result<(), NetworkDiagnosticError> {
        let hosts = scan_targets(&self.host)?;
        if self.start_port == 0
            || self.end_port < self.start_port
            || self
                .end_port
                .saturating_sub(self.start_port)
                .saturating_add(1)
                > MAX_PORTS_PER_SCAN
            || self.concurrency == 0
            || self.concurrency > MAX_CONCURRENCY
            || self.timeout.is_zero()
        {
            return Err(NetworkDiagnosticError::InvalidPortRange);
        }
        if hosts.len() * (usize::from(self.end_port - self.start_port) + 1) > MAX_SCAN_CHECKS {
            return Err(NetworkDiagnosticError::InvalidScanRange);
        }
        Ok(())
    }
    pub fn total_checks(&self) -> Result<usize, NetworkDiagnosticError> {
        self.validate()?;
        Ok(scan_targets(&self.host)?.len() * (usize::from(self.end_port - self.start_port) + 1))
    }
}

/// Expand a small explicit network without DNS or allocating an unbounded range.
fn scan_targets(target: &str) -> Result<Vec<String>, NetworkDiagnosticError> {
    let Some((address, prefix)) = target.split_once('/') else {
        validate_host(target)?;
        return Ok(vec![target.to_owned()]);
    };
    let ip: IpAddr = address
        .parse()
        .map_err(|_| NetworkDiagnosticError::InvalidTarget)?;
    let prefix: u32 = prefix
        .parse()
        .map_err(|_| NetworkDiagnosticError::InvalidTarget)?;
    let bits = if ip.is_ipv4() { 32 } else { 128 };
    if prefix > bits {
        return Err(NetworkDiagnosticError::InvalidTarget);
    }
    let host_bits = bits - prefix;
    // Even before shifting, reject ranges larger than the bounded target list.
    if host_bits > 8 {
        return Err(NetworkDiagnosticError::InvalidScanRange);
    }
    let count = 1usize << host_bits;
    if count > MAX_SCAN_HOSTS {
        return Err(NetworkDiagnosticError::InvalidScanRange);
    }
    let value = match ip {
        IpAddr::V4(ip) => u128::from(u32::from(ip)),
        IpAddr::V6(ip) => u128::from(ip),
    };
    let base = value & !((count as u128) - 1);
    let skip_edges = ip.is_ipv4() && prefix <= 30;
    let start = usize::from(skip_edges);
    let end = count - usize::from(skip_edges);
    Ok((start..end)
        .map(|offset| {
            let value = base + offset as u128;
            if ip.is_ipv4() {
                Ipv4Addr::from(value as u32).to_string()
            } else {
                Ipv6Addr::from(value).to_string()
            }
        })
        .collect())
}

/// Scans one explicit bounded TCP range. The caller owns cancellation and may
/// flip the watch value to `true`; all outstanding tasks are then aborted and
/// joined before returning.
pub async fn scan_tcp(
    options: PortScanOptions,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<Vec<TcpCheckResult>, NetworkDiagnosticError> {
    scan_tcp_with_progress(options, cancellation, |_, _, _| {}).await
}

/// Scans one explicit bounded TCP range and calls `on_progress` after each
/// completed port. The callback is synchronous and must remain lightweight;
/// it is intended for a native event bridge rather than arbitrary work.
pub async fn scan_tcp_with_progress<F>(
    options: PortScanOptions,
    cancellation: &mut watch::Receiver<bool>,
    on_progress: F,
) -> Result<Vec<TcpCheckResult>, NetworkDiagnosticError>
where
    F: FnMut(&TcpCheckResult, usize, usize),
{
    scan_ports_with_progress(options, ScanProtocol::Tcp, cancellation, on_progress).await
}

/// Shared bounded scheduling and cancellation for TCP and UDP range checks.
pub async fn scan_ports_with_progress<F>(
    options: PortScanOptions,
    protocol: ScanProtocol,
    cancellation: &mut watch::Receiver<bool>,
    mut on_progress: F,
) -> Result<Vec<TcpCheckResult>, NetworkDiagnosticError>
where
    F: FnMut(&TcpCheckResult, usize, usize),
{
    options.validate()?;
    if *cancellation.borrow() {
        return Err(NetworkDiagnosticError::Cancelled);
    }

    let mut tasks = JoinSet::new();
    let mut next_check = 0;
    let targets = scan_targets(&options.host)?;
    let mut results = Vec::new();
    let mut cancellation_closed = false;
    let total = options.total_checks()?;

    schedule_ports(&mut tasks, &options, &targets, protocol, &mut next_check);
    while !tasks.is_empty() {
        if cancellation_closed {
            if let Some(result) = tasks.join_next().await {
                let result = result.map_err(|_| NetworkDiagnosticError::Worker)??;
                on_progress(&result, results.len() + 1, total);
                results.push(result);
                schedule_ports(&mut tasks, &options, &targets, protocol, &mut next_check);
            }
            continue;
        }

        tokio::select! {
            changed = cancellation.changed() => {
                match changed {
                    Ok(()) if *cancellation.borrow() => {
                        tasks.abort_all();
                        while tasks.join_next().await.is_some() {}
                        return Err(NetworkDiagnosticError::Cancelled);
                    }
                    Ok(()) => {}
                    Err(_) => cancellation_closed = true,
                }
            }
            result = tasks.join_next() => {
                if let Some(result) = result {
                    let result = result.map_err(|_| NetworkDiagnosticError::Worker)??;
                    on_progress(&result, results.len() + 1, total);
                    results.push(result);
                    schedule_ports(&mut tasks, &options, &targets, protocol, &mut next_check);
                }
            }
        }
    }
    results.sort_by(|a, b| a.host.cmp(&b.host).then(a.port.cmp(&b.port)));
    Ok(results)
}

fn schedule_ports(
    tasks: &mut JoinSet<Result<TcpCheckResult, NetworkDiagnosticError>>,
    options: &PortScanOptions,
    targets: &[String],
    protocol: ScanProtocol,
    next_check: &mut usize,
) {
    let ports = usize::from(options.end_port - options.start_port) + 1;
    while tasks.len() < options.concurrency && *next_check < targets.len() * ports {
        let check = TcpCheckOptions {
            host: targets[*next_check / ports].clone(),
            port: options.start_port + (*next_check % ports) as u16,
            timeout: options.timeout,
        };
        *next_check += 1;
        tasks.spawn(async move {
            match protocol {
                ScanProtocol::Tcp => check_tcp(check).await,
                ScanProtocol::Udp => check_udp(check).await,
            }
        });
    }
}

pub async fn resolve_host(
    host: impl Into<String>,
    timeout: Duration,
) -> Result<Vec<IpAddr>, NetworkDiagnosticError> {
    let host = host.into();
    validate_host(&host)?;
    if timeout.is_zero() {
        return Err(NetworkDiagnosticError::InvalidTarget);
    }
    let addresses = tokio::time::timeout(timeout, lookup_host((host.as_str(), 0)))
        .await
        .map_err(|_| NetworkDiagnosticError::Timeout)?
        .map_err(|_| NetworkDiagnosticError::Resolution)?
        .map(|address| address.ip())
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(NetworkDiagnosticError::Resolution);
    }
    Ok(addresses)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PingOptions {
    pub host: String,
    pub timeout: Duration,
}

impl PingOptions {
    pub fn validate(&self) -> Result<(), NetworkDiagnosticError> {
        validate_host(&self.host)?;
        if self.timeout.is_zero() {
            return Err(NetworkDiagnosticError::InvalidTarget);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub host: String,
    pub reachable: bool,
    pub elapsed_ms: u64,
}

/// Runs one platform-native ping with one explicit echo request. The command
/// receives an argument array, never a shell string, and is killed when the
/// operation times out or is cancelled.
pub async fn ping(
    options: PingOptions,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<PingResult, NetworkDiagnosticError> {
    options.validate()?;
    if *cancellation.borrow() {
        return Err(NetworkDiagnosticError::Cancelled);
    }
    let host = options.host.clone();
    let started = Instant::now();
    let output = run_diagnostic_command(
        ping_program(),
        ping_arguments(&options.host),
        options.timeout,
        cancellation,
    )
    .await?;
    Ok(PingResult {
        host,
        reachable: output.status.success(),
        elapsed_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    })
}

#[derive(Debug, Clone)]
pub struct LivePingOptions {
    pub host: String,
    pub timeout: Duration,
    pub interval: Duration,
    /// ICMP payload bytes, excluding IP and ICMP headers.
    pub packet_size: u16,
}
impl LivePingOptions {
    pub fn validate(&self) -> Result<(), NetworkDiagnosticError> {
        PingOptions {
            host: self.host.clone(),
            timeout: self.timeout,
        }
        .validate()?;
        if !(Duration::from_millis(200)..=Duration::from_secs(60)).contains(&self.interval)
            || self.packet_size > 65500
        {
            return Err(NetworkDiagnosticError::InvalidTarget);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePingResult {
    pub host: String,
    pub sent: u64,
    pub received: u64,
    pub elapsed_ms: u64,
    pub interval_ms: u64,
    pub packet_size: u16,
    pub lines: Vec<String>,
}

fn live_ping_arguments(options: &LivePingOptions) -> Vec<String> {
    let mut arguments = ping_arguments(&options.host);
    // Both platform argument builders put the host last.
    arguments.pop();
    #[cfg(windows)]
    arguments.extend([
        "-l".into(),
        options.packet_size.to_string(),
        "-w".into(),
        options.timeout.as_millis().to_string(),
    ]);
    #[cfg(unix)]
    arguments.extend(["-s".into(), options.packet_size.to_string()]);
    arguments.push(options.host.clone());
    arguments
}

// Native single-packet ping output contains a heading, one response, then a
// blank line and statistics. Keep only the response, without interpreting
// localized reply text or treating process runtime as packet latency.
fn ping_reply_line(bytes: &[u8]) -> String {
    let lines = bounded_trace_lines(bytes);
    let mut content = lines.iter().skip_while(|line| line.trim().is_empty());
    let Some(heading) = content.next() else {
        return "No reply output.".into();
    };
    content
        .next()
        .filter(|line| !line.trim().is_empty())
        .unwrap_or(heading)
        .trim()
        .to_owned()
}

/// Continuous single-probe ping with bounded transcript and serial scheduling.
/// The interval is a minimum between probe starts; probes never overlap.
pub async fn ping_live<F>(
    options: LivePingOptions,
    cancellation: &mut watch::Receiver<bool>,
    mut progress: F,
) -> Result<LivePingResult, NetworkDiagnosticError>
where
    F: FnMut(LivePingResult),
{
    options.validate()?;
    let started = Instant::now();
    let mut result = LivePingResult {
        host: options.host.clone(),
        sent: 0,
        received: 0,
        elapsed_ms: 0,
        interval_ms: options.interval.as_millis() as u64,
        packet_size: options.packet_size,
        lines: Vec::new(),
    };
    let mut transcript = std::collections::VecDeque::new();
    loop {
        if *cancellation.borrow() {
            return Err(NetworkDiagnosticError::Cancelled);
        }
        let cycle = Instant::now();
        let probe = run_diagnostic_command(
            ping_program(),
            live_ping_arguments(&options),
            options.timeout,
            cancellation,
        )
        .await;
        result.sent = result.sent.saturating_add(1);
        match probe {
            Ok(output) => {
                if output.status.success() {
                    result.received = result.received.saturating_add(1);
                }
                transcript.push_back(format!(
                    "seq={}  {}",
                    result.sent,
                    ping_reply_line(&output.stdout)
                ));
            }
            Err(NetworkDiagnosticError::Timeout) => {
                transcript.push_back(format!("seq={}  Request timed out.", result.sent))
            }
            Err(error) => return Err(error),
        }
        while transcript.len() > 200 {
            transcript.pop_front();
        }
        result.lines = transcript.iter().cloned().collect();
        result.elapsed_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        progress(result.clone());
        tokio::select! {
            _ = tokio::time::sleep_until(cycle + options.interval) => {},
            _ = cancellation.changed() => { if *cancellation.borrow() || cancellation.has_changed().is_err() { return Err(NetworkDiagnosticError::Cancelled); } }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TracerouteOptions {
    pub host: String,
    pub timeout: Duration,
    pub max_hops: u8,
}

impl TracerouteOptions {
    pub fn validate(&self) -> Result<(), NetworkDiagnosticError> {
        validate_host(&self.host)?;
        if self.timeout.is_zero() || !(1..=MAX_TRACE_HOPS).contains(&self.max_hops) {
            return Err(NetworkDiagnosticError::InvalidTarget);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteResult {
    pub host: String,
    pub reached: bool,
    pub hops: Vec<String>,
    pub elapsed_ms: u64,
}

/// Runs one bounded platform-native traceroute. Hop text is treated as
/// untrusted diagnostic output and is truncated before crossing the IPC
/// boundary.
pub async fn traceroute(
    options: TracerouteOptions,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<TracerouteResult, NetworkDiagnosticError> {
    options.validate()?;
    if *cancellation.borrow() {
        return Err(NetworkDiagnosticError::Cancelled);
    }
    let started = Instant::now();
    let output = run_diagnostic_command(
        traceroute_program(),
        traceroute_arguments(&options.host, options.timeout, options.max_hops),
        options.timeout,
        cancellation,
    )
    .await?;
    let hops = bounded_trace_lines(&output.stdout);
    Ok(TracerouteResult {
        host: options.host,
        reached: output.status.success(),
        hops,
        elapsed_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    })
}

/// Five-cycle MTR report, using the same cancellation and output bounds as traceroute.
pub async fn mtr_report(
    program: &std::path::Path,
    options: TracerouteOptions,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<TracerouteResult, NetworkDiagnosticError> {
    options.validate()?;
    if *cancellation.borrow() {
        return Err(NetworkDiagnosticError::Cancelled);
    }
    let started = Instant::now();
    let output = run_diagnostic_command(
        program,
        mtr_arguments(&options),
        options.timeout,
        cancellation,
    )
    .await
    .map_err(|error| match error {
        NetworkDiagnosticError::Process => NetworkDiagnosticError::MtrUnavailable,
        other => other,
    })?;
    if !output.status.success() {
        return Err(NetworkDiagnosticError::MtrUnavailable);
    }
    Ok(TracerouteResult {
        host: options.host,
        reached: true,
        hops: bounded_trace_lines(&output.stdout),
        elapsed_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    })
}

fn mtr_arguments(options: &TracerouteOptions) -> Vec<String> {
    vec![
        "-r".into(),
        "-w".into(),
        "-n".into(),
        "-c".into(),
        "5".into(),
        "-m".into(),
        options.max_hops.to_string(),
        "--".into(),
        options.host.clone(),
    ]
}

#[derive(Default)]
struct MtrHopStats {
    host: String,
    sent: u64,
    received: u64,
    last: f64,
    sum: f64,
    best: f64,
    worst: f64,
}

#[derive(Default)]
struct MtrStats(std::collections::BTreeMap<u8, MtrHopStats>);
impl MtrStats {
    fn update(&mut self, bytes: &[u8], max_hops: u8) -> Result<(), NetworkDiagnosticError> {
        let json: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| NetworkDiagnosticError::Process)?;
        let report = &json["report"];
        let hops = report["hops"]
            .as_array()
            .or_else(|| report["hubs"].as_array())
            .ok_or(NetworkDiagnosticError::Process)?;
        if hops.len() > usize::from(max_hops) {
            return Err(NetworkDiagnosticError::OutputTooLarge);
        }
        for hop in hops {
            let ttl = hop["ttl"]
                .as_u64()
                .or_else(|| hop["count"].as_u64())
                .filter(|ttl| *ttl > 0 && *ttl <= u64::from(max_hops))
                .ok_or(NetworkDiagnosticError::Process)? as u8;
            // An unresponsive Windows ICMP hop has a null host and null
            // latency fields. It is valid loss data, not a failed process.
            let host = match &hop["host"] {
                serde_json::Value::Null => "???".to_owned(),
                serde_json::Value::String(host)
                    if host.len() <= 253 && !host.chars().any(char::is_control) =>
                {
                    host.clone()
                }
                _ => return Err(NetworkDiagnosticError::Process),
            };
            let number = |a: &str, b: &str| {
                hop[a]
                    .as_f64()
                    .or_else(|| hop[b].as_f64())
                    .filter(|value| value.is_finite() && *value >= 0.0)
            };
            let sent = hop["sent"]
                .as_u64()
                .or_else(|| hop["Snt"].as_u64())
                .filter(|sent| *sent <= 1)
                .ok_or(NetworkDiagnosticError::Process)?;
            let loss = number("loss_pct", "Loss%")
                .filter(|loss| *loss <= 100.0)
                .ok_or(NetworkDiagnosticError::Process)?;
            let received = hop["recv"]
                .as_u64()
                .unwrap_or_else(|| (sent as f64 * (1.0 - loss / 100.0)).round() as u64)
                .min(sent);
            let stats = self.0.entry(ttl).or_default();
            // A new router at the same hop starts its own statistics.
            if stats.host.is_empty() || (host != "???" && stats.host != host && stats.host != "???")
            {
                *stats = MtrHopStats {
                    host: host.clone(),
                    ..Default::default()
                };
            }
            if host != "???" {
                stats.host = host;
            }
            stats.sent = stats.sent.saturating_add(sent);
            if received > 0 {
                let last = number("last", "Last").ok_or(NetworkDiagnosticError::Process)?;
                let avg = number("avg", "Avg").ok_or(NetworkDiagnosticError::Process)?;
                let best = number("best", "Best").ok_or(NetworkDiagnosticError::Process)?;
                let worst = number("worst", "Wrst").ok_or(NetworkDiagnosticError::Process)?;
                stats.last = last;
                stats.best = if stats.received == 0 {
                    best
                } else {
                    stats.best.min(best)
                };
                stats.worst = stats.worst.max(worst);
                stats.sum += avg * received as f64;
                stats.received = stats.received.saturating_add(received);
            }
        }
        Ok(())
    }
    fn lines(&self) -> Vec<String> {
        let mut lines = vec![format!(
            "{:<4} {:<40} {:>6} {:>8} {:>8} {:>8} {:>8} {:>8}",
            "Hop", "Host", "Loss%", "Sent", "Last", "Avg", "Best", "Worst"
        )];
        for (ttl, hop) in &self.0 {
            let loss = if hop.sent == 0 {
                0.0
            } else {
                100.0 * (hop.sent - hop.received) as f64 / hop.sent as f64
            };
            let metrics = if hop.received == 0 {
                format!("{:>8} {:>8} {:>8} {:>8}", "—", "—", "—", "—")
            } else {
                format!(
                    "{:>8.2} {:>8.2} {:>8.2} {:>8.2}",
                    hop.last,
                    hop.sum / hop.received as f64,
                    hop.best,
                    hop.worst
                )
            };
            lines.push(format!(
                "{ttl:<4} {:<40} {loss:>6.1} {:>8} {metrics}",
                hop.host, hop.sent
            ));
        }
        lines
    }
}

/// Publish cumulative MTR snapshots until explicitly stopped. Each subprocess
/// is a single bounded probe cycle; memory and update cadence stay bounded.
pub async fn mtr_live<F>(
    program: &std::path::Path,
    options: TracerouteOptions,
    cancellation: &mut watch::Receiver<bool>,
    mut progress: F,
) -> Result<TracerouteResult, NetworkDiagnosticError>
where
    F: FnMut(TracerouteResult),
{
    options.validate()?;
    let started = Instant::now();
    let mut stats = MtrStats::default();
    loop {
        if *cancellation.borrow() {
            return Err(NetworkDiagnosticError::Cancelled);
        }
        let cycle = Instant::now();
        let arguments = vec![
            "--json".into(),
            "-n".into(),
            "-c".into(),
            "1".into(),
            "-m".into(),
            options.max_hops.to_string(),
            "--".into(),
            options.host.clone(),
        ];
        let output = run_diagnostic_command(program, arguments, options.timeout, cancellation)
            .await
            .map_err(|error| match error {
                NetworkDiagnosticError::Process => NetworkDiagnosticError::MtrUnavailable,
                other => other,
            })?;
        if !output.status.success() {
            return Err(NetworkDiagnosticError::MtrUnavailable);
        }
        stats.update(&output.stdout, options.max_hops)?;
        progress(TracerouteResult {
            host: options.host.clone(),
            reached: false,
            hops: stats.lines(),
            elapsed_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        });
        tokio::select! {
            _ = tokio::time::sleep_until(cycle + Duration::from_secs(1)) => {},
            _ = cancellation.changed() => { if *cancellation.borrow() || cancellation.has_changed().is_err() { return Err(NetworkDiagnosticError::Cancelled); } }
        }
    }
}

async fn run_diagnostic_command(
    program: impl AsRef<std::ffi::OsStr>,
    arguments: Vec<String>,
    timeout: Duration,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<Output, NetworkDiagnosticError> {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let child = command
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| NetworkDiagnosticError::Process)?;
    let mut output = Box::pin(read_bounded_command_output(child));
    let mut deadline = Box::pin(tokio::time::sleep(timeout));
    let mut cancellation_closed = false;

    loop {
        tokio::select! {
            result = &mut output => {
                return result;
            }
            changed = cancellation.changed(), if !cancellation_closed => {
                match changed {
                    Ok(()) if *cancellation.borrow() => return Err(NetworkDiagnosticError::Cancelled),
                    Ok(()) => {},
                    Err(_) => cancellation_closed = true,
                }
            }
            _ = &mut deadline => return Err(NetworkDiagnosticError::Timeout),
        }
    }
}

/// Read command output through a bounded pipe. Truncating after
/// `wait_with_output` is too late: a broken or unexpectedly verbose system
/// utility could already have forced an unbounded allocation in the native
/// process. Reading one byte beyond the limit lets this function distinguish a
/// complete result from an overflow, then kills and reaps the child.
async fn read_bounded_command_output(
    mut child: tokio::process::Child,
) -> Result<Output, NetworkDiagnosticError> {
    let stdout = child.stdout.take().ok_or(NetworkDiagnosticError::Process)?;
    let mut bytes = Vec::with_capacity(MAX_DIAGNOSTIC_OUTPUT_BYTES.min(8192));
    let limit = u64::try_from(MAX_DIAGNOSTIC_OUTPUT_BYTES)
        .expect("diagnostic output limit fits in u64")
        .saturating_add(1);
    let mut limited_stdout = stdout.take(limit);
    let read_result = limited_stdout.read_to_end(&mut bytes).await;

    // Some platform pipes report a read error when a producer is terminated
    // while the bounded reader is at its limit. The byte count is the
    // authoritative signal in that case; do not turn a controlled overflow
    // into an opaque process error.
    if bytes.len() > MAX_DIAGNOSTIC_OUTPUT_BYTES {
        let _ = child.kill().await;
        return Err(NetworkDiagnosticError::OutputTooLarge);
    }
    read_result.map_err(|_| NetworkDiagnosticError::Process)?;

    let status = child
        .wait()
        .await
        .map_err(|_| NetworkDiagnosticError::Process)?;
    Ok(Output {
        status,
        stdout: bytes,
        stderr: Vec::new(),
    })
}

#[cfg(unix)]
fn ping_program() -> &'static str {
    "ping"
}

#[cfg(windows)]
fn ping_program() -> &'static str {
    "ping.exe"
}

#[cfg(unix)]
fn ping_arguments(host: &str) -> Vec<String> {
    vec!["-n".into(), "-c".into(), "1".into(), host.into()]
}

#[cfg(windows)]
fn ping_arguments(host: &str) -> Vec<String> {
    vec!["-n".into(), "1".into(), host.into()]
}

#[cfg(unix)]
fn traceroute_program() -> &'static str {
    "traceroute"
}

#[cfg(windows)]
fn traceroute_program() -> &'static str {
    "tracert.exe"
}

#[cfg(unix)]
fn traceroute_arguments(host: &str, timeout: Duration, max_hops: u8) -> Vec<String> {
    let per_hop_seconds = timeout.as_secs().clamp(1, 60);
    vec![
        "-n".into(),
        "-m".into(),
        max_hops.to_string(),
        "-w".into(),
        per_hop_seconds.to_string(),
        host.into(),
    ]
}

#[cfg(windows)]
fn traceroute_arguments(host: &str, timeout: Duration, max_hops: u8) -> Vec<String> {
    vec![
        "-d".into(),
        "-h".into(),
        max_hops.to_string(),
        "-w".into(),
        timeout.as_millis().clamp(1, 60_000).to_string(),
        host.into(),
    ]
}

fn bounded_trace_lines(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .take(MAX_TRACE_LINES)
        .map(|line| {
            line.char_indices()
                .take_while(|(index, character)| {
                    index + character.len_utf8() <= MAX_TRACE_LINE_BYTES
                })
                .map(|(_, character)| character)
                .collect()
        })
        .collect()
}

fn validate_host(host: &str) -> Result<(), NetworkDiagnosticError> {
    if host.trim().is_empty()
        || host.trim() != host
        || host.starts_with('-')
        || host.len() > 253
        || host.contains('\0')
        || host.chars().any(char::is_control)
    {
        return Err(NetworkDiagnosticError::InvalidTarget);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn diagnostic_host_validation_rejects_process_options_and_edge_whitespace() {
        for host in ["-f", " localhost", "localhost "] {
            assert!(
                matches!(
                    validate_host(host),
                    Err(NetworkDiagnosticError::InvalidTarget)
                ),
                "accepted invalid diagnostic host {host:?}"
            );
        }
    }

    #[test]
    fn cidr_expansion_and_aggregate_work_are_bounded() {
        assert_eq!(scan_targets("192.0.2.19").unwrap(), vec!["192.0.2.19"]);
        assert_eq!(
            scan_targets("192.0.2.3/30").unwrap(),
            vec!["192.0.2.1", "192.0.2.2"]
        );
        assert_eq!(
            scan_targets("192.0.2.0/31").unwrap(),
            vec!["192.0.2.0", "192.0.2.1"]
        );
        assert_eq!(scan_targets("192.0.2.42/32").unwrap(), vec!["192.0.2.42"]);
        assert_eq!(scan_targets("::1/128").unwrap(), vec!["::1"]);
        assert_eq!(scan_targets("2001:db8::2/126").unwrap().len(), 4);
        for target in [
            "0.0.0.0/0",
            "192.0.2.0/23",
            "::/0",
            "2001:db8::/64",
            "192.0.2.1/33",
            "::1/129",
            "hostname/24",
            "192.0.2.1/no",
        ] {
            assert!(scan_targets(target).is_err(), "{target}");
        }
        let mut options = PortScanOptions {
            host: "192.0.2.0/24".into(),
            start_port: 1,
            end_port: 256,
            concurrency: 16,
            timeout: Duration::from_millis(50),
        };
        assert_eq!(options.total_checks().unwrap(), 254 * 256);
        options.end_port = 1024;
        assert!(matches!(
            options.validate(),
            Err(NetworkDiagnosticError::InvalidScanRange)
        ));
    }

    #[tokio::test]
    async fn cidr_scan_reports_each_loopback_host_on_the_same_port() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let listener2 = TcpListener::bind(("127.0.0.2", port)).await.unwrap();
        let options = PortScanOptions {
            host: "127.0.0.0/30".into(),
            start_port: port,
            end_port: port,
            concurrency: 2,
            timeout: Duration::from_secs(1),
        };
        let (_cancel, mut cancellation) = watch::channel(false);
        let mut progress = Vec::new();
        let results = scan_ports_with_progress(
            options.clone(),
            ScanProtocol::Tcp,
            &mut cancellation,
            |result, scanned, total| {
                progress.push((result.host.clone(), scanned, total));
            },
        )
        .await
        .unwrap();
        assert_eq!(results.len(), 2);
        assert!(
            results
                .iter()
                .all(|result| result.status == TcpPortStatus::Open && result.port == port)
        );
        assert_eq!(results[0].host, "127.0.0.1");
        assert_eq!(results[1].host, "127.0.0.2");
        assert_eq!(
            progress
                .iter()
                .map(|(_, scanned, total)| (*scanned, *total))
                .collect::<Vec<_>>(),
            vec![(1, 2), (2, 2)]
        );
        let (_cancel, mut cancellation) = watch::channel(true);
        assert!(matches!(
            scan_tcp(options, &mut cancellation).await,
            Err(NetworkDiagnosticError::Cancelled)
        ));
        drop((listener, listener2));
    }

    #[test]
    fn options_require_explicit_bounded_targets() {
        let options = PortScanOptions {
            host: "127.0.0.1".into(),
            start_port: 1,
            end_port: MAX_PORTS_PER_SCAN,
            concurrency: MAX_CONCURRENCY,
            timeout: Duration::from_millis(25),
        };
        assert!(options.validate().is_ok());

        let mut invalid = options.clone();
        invalid.end_port = MAX_PORTS_PER_SCAN + 1;
        assert!(matches!(
            invalid.validate(),
            Err(NetworkDiagnosticError::InvalidPortRange)
        ));
        invalid.end_port = MAX_PORTS_PER_SCAN;
        invalid.host = "".into();
        assert!(matches!(
            invalid.validate(),
            Err(NetworkDiagnosticError::InvalidTarget)
        ));
    }

    #[test]
    fn tcp_checks_keep_immediate_failures_distinct_from_timeouts() {
        assert_eq!(
            tcp_error_status(io::ErrorKind::ConnectionRefused),
            TcpPortStatus::Closed
        );
        assert_eq!(
            tcp_error_status(io::ErrorKind::TimedOut),
            TcpPortStatus::TimedOut
        );
        assert_eq!(
            tcp_error_status(io::ErrorKind::PermissionDenied),
            TcpPortStatus::Failed
        );
    }

    #[test]
    fn diagnostic_errors_are_actionable_without_raw_system_details() {
        let errors = [
            NetworkDiagnosticError::Resolution,
            NetworkDiagnosticError::Worker,
            NetworkDiagnosticError::Process,
            NetworkDiagnosticError::OutputTooLarge,
        ];
        let messages = errors.iter().map(ToString::to_string).collect::<Vec<_>>();
        assert_eq!(messages[0], "DNS lookup failed");
        assert_eq!(messages[1], "network diagnostic worker failed");
        assert_eq!(messages[2], "network diagnostic process failed");
        assert_eq!(
            messages[3],
            "network diagnostic output exceeded the safety limit"
        );
        assert!(messages.iter().all(|message| {
            !message.contains("/Users/") && !message.contains("private-host-detail")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn diagnostic_process_output_is_bounded_before_buffering() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let (_sender, mut cancellation) = watch::channel(false);
            let result = run_diagnostic_command(
                "/bin/sh",
                vec!["-c".into(), "while :; do printf x; done".into()],
                Duration::from_secs(5),
                &mut cancellation,
            )
            .await;
            assert!(
                matches!(result, Err(NetworkDiagnosticError::OutputTooLarge)),
                "unexpected diagnostic result: {result:?}"
            );
        });
    }

    #[test]
    fn cancellation_is_observed_before_any_socket_is_opened() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let options = PortScanOptions {
                host: "127.0.0.1".into(),
                start_port: 1,
                end_port: 32,
                concurrency: 4,
                timeout: Duration::from_millis(25),
            };
            let (_sender, mut cancellation) = watch::channel(true);
            assert!(matches!(
                scan_tcp(options, &mut cancellation).await,
                Err(NetworkDiagnosticError::Cancelled)
            ));
        });
    }

    #[test]
    fn loopback_scan_reports_an_explicit_open_port() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let options = PortScanOptions {
                host: "127.0.0.1".into(),
                start_port: port,
                end_port: port,
                concurrency: 1,
                timeout: Duration::from_millis(250),
            };
            let (_sender, mut cancellation) = watch::channel(false);
            let results = scan_tcp(options, &mut cancellation).await.unwrap();
            assert_eq!(results.len(), 1);
            assert_eq!(results[0].port, port);
            assert_eq!(results[0].status, TcpPortStatus::Open);
        });
    }

    #[test]
    fn progress_reports_each_completed_port_with_a_bounded_total() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let options = PortScanOptions {
                host: "127.0.0.1".into(),
                start_port: 31_000,
                end_port: 31_002,
                concurrency: 2,
                timeout: Duration::from_millis(25),
            };
            let (_sender, mut cancellation) = watch::channel(false);
            let mut progress = Vec::new();
            let results =
                scan_tcp_with_progress(options, &mut cancellation, |result, scanned, total| {
                    progress.push((result.port, scanned, total));
                })
                .await
                .unwrap();
            assert_eq!(results.len(), 3);
            assert_eq!(progress.len(), 3);
            assert!(progress.iter().all(|(_, _, total)| *total == 3));
            assert_eq!(progress.last().map(|(_, scanned, _)| *scanned), Some(3));
        });
    }

    #[test]
    fn highest_port_is_scanned_once_without_wraparound() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let options = PortScanOptions {
                host: "127.0.0.1".into(),
                start_port: u16::MAX,
                end_port: u16::MAX,
                concurrency: 4,
                timeout: Duration::from_millis(25),
            };
            let (_sender, mut cancellation) = watch::channel(false);
            let results = scan_tcp(options, &mut cancellation).await.unwrap();
            assert_eq!(results.len(), 1);
            assert_eq!(results[0].port, u16::MAX);
        });
    }

    #[test]
    fn ping_uses_one_explicit_loopback_probe() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let options = PingOptions {
                host: "127.0.0.1".into(),
                timeout: Duration::from_secs(5),
            };
            let (_sender, mut cancellation) = watch::channel(false);
            let result = ping(options, &mut cancellation).await.unwrap();
            assert_eq!(result.host, "127.0.0.1");
            assert!(result.reachable);
        });
    }

    #[test]
    fn diagnostics_cancel_before_process_start() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let (_sender, mut cancellation) = watch::channel(true);
            let ping_result = ping(
                PingOptions {
                    host: "127.0.0.1".into(),
                    timeout: Duration::from_secs(5),
                },
                &mut cancellation,
            )
            .await;
            assert!(matches!(
                ping_result,
                Err(NetworkDiagnosticError::Cancelled)
            ));

            let trace_result = traceroute(
                TracerouteOptions {
                    host: "127.0.0.1".into(),
                    timeout: Duration::from_secs(5),
                    max_hops: 4,
                },
                &mut cancellation,
            )
            .await;
            assert!(matches!(
                trace_result,
                Err(NetworkDiagnosticError::Cancelled)
            ));
        });
    }

    #[test]
    fn traceroute_output_is_bounded_before_ipc() {
        let input = vec![b'x'; MAX_TRACE_LINE_BYTES + 20];
        let output = bounded_trace_lines(&[input, b"\nsecond".to_vec()].concat());
        assert_eq!(output.len(), 2);
        assert_eq!(output[0].len(), MAX_TRACE_LINE_BYTES);
        assert_eq!(output[1], "second");

        let unicode = "é".repeat(MAX_TRACE_LINE_BYTES);
        let output = bounded_trace_lines(unicode.as_bytes());
        assert_eq!(output[0].len(), MAX_TRACE_LINE_BYTES);
        assert_eq!(output[0].chars().count(), MAX_TRACE_LINE_BYTES / 2);

        let boundary = format!("{}é", "x".repeat(MAX_TRACE_LINE_BYTES - 1));
        let output = bounded_trace_lines(boundary.as_bytes());
        assert_eq!(output[0].len(), MAX_TRACE_LINE_BYTES - 1);
    }
    #[test]
    fn udp_reply_silence_and_cancellation_are_distinct() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let echo = UdpSocket::bind("127.0.0.1:0").await.unwrap();
            let port = echo.local_addr().unwrap().port();
            let responder = tokio::spawn(async move {
                let mut bytes = [0u8; 16];
                let (_, peer) = echo.recv_from(&mut bytes).await.unwrap();
                echo.send_to(b"reply", peer).await.unwrap();
            });
            let options = PortScanOptions {
                host: "127.0.0.1".into(),
                start_port: port,
                end_port: port,
                concurrency: 1,
                timeout: Duration::from_secs(2),
            };
            let (sender, mut cancellation) = watch::channel(false);
            let mut progress = Vec::new();
            let results = scan_ports_with_progress(
                options,
                ScanProtocol::Udp,
                &mut cancellation,
                |result, done, total| progress.push((result.port, done, total)),
            )
            .await
            .unwrap();
            responder.await.unwrap();
            assert_eq!(results[0].status, TcpPortStatus::Open);
            assert_eq!(progress, vec![(port, 1, 1)]);
            // A bound but silent UDP service is not classified as closed/open.
            let silent = UdpSocket::bind("127.0.0.1:0").await.unwrap();
            let port = silent.local_addr().unwrap().port();
            let result = check_udp(TcpCheckOptions {
                host: "127.0.0.1".into(),
                port,
                timeout: Duration::from_millis(30),
            })
            .await
            .unwrap();
            assert_eq!(result.status, TcpPortStatus::OpenOrFiltered);
            let options = PortScanOptions {
                host: "127.0.0.1".into(),
                start_port: port,
                end_port: port,
                concurrency: 1,
                timeout: Duration::from_secs(30),
            };
            let stop = tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(20)).await;
                sender.send(true).unwrap();
            });
            let result = tokio::time::timeout(
                Duration::from_secs(2),
                scan_ports_with_progress(
                    options,
                    ScanProtocol::Udp,
                    &mut cancellation,
                    |_, _, _| {},
                ),
            )
            .await
            .unwrap();
            assert!(matches!(result, Err(NetworkDiagnosticError::Cancelled)));
            stop.await.unwrap();
        });
    }

    #[test]
    fn mtr_arguments_are_bounded_and_target_is_a_single_argument() {
        let options = TracerouteOptions {
            host: "127.0.0.1".into(),
            timeout: Duration::from_secs(60),
            max_hops: 8,
        };
        assert_eq!(
            mtr_arguments(&options),
            ["-r", "-w", "-n", "-c", "5", "-m", "8", "--", "127.0.0.1"]
        );
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (_sender, mut cancellation) = watch::channel(true);
            assert!(matches!(
                mtr_report(
                    std::path::Path::new("does-not-exist"),
                    options,
                    &mut cancellation
                )
                .await,
                Err(NetworkDiagnosticError::Cancelled)
            ));
        });
    }

    #[cfg(windows)]
    #[test]
    fn bundled_mtr_reports_only_loopback() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let program = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tools/mtr/windows-x86_64/mtr.exe");
            let options = TracerouteOptions {
                host: "127.0.0.1".into(),
                timeout: Duration::from_secs(30),
                max_hops: 1,
            };
            let (_sender, mut cancellation) = watch::channel(false);
            let report = mtr_report(&program, options, &mut cancellation)
                .await
                .unwrap();
            assert!(!report.hops.is_empty());
            assert!(report.hops.iter().any(|line| line.contains("127.0.0.1")));
        });
    }
    #[test]
    fn mtr_cumulative_loss_latency_and_route_changes() {
        let mut stats = MtrStats::default();
        stats.update(br#"{"report":{"hops":[{"ttl":1,"host":"127.0.0.1","sent":1,"recv":1,"loss_pct":0,"last":12,"avg":12,"best":12,"worst":12}]}}"#, 8).unwrap();
        stats.update(br#"{"report":{"hops":[{"ttl":1,"host":"127.0.0.1","sent":1,"recv":0,"loss_pct":100}]}}"#, 8).unwrap();
        assert_eq!(stats.0[&1].sent, 2);
        assert_eq!(stats.0[&1].received, 1);
        assert!(stats.lines()[1].contains("50.0"));
        stats.update(br#"{"report":{"hops":[{"ttl":1,"host":"127.0.0.2","sent":1,"recv":0,"loss_pct":100}]}}"#, 8).unwrap();
        assert_eq!(stats.0[&1].sent, 1);
        assert!(stats.lines()[1].contains("—"));
        assert!(stats.update(b"not-json", 8).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn live_mtr_updates_repeatedly_until_stopped() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let program = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tools/mtr/windows-x86_64/mtr.exe");
            let (sender, mut cancel) = watch::channel(false);
            let mut updates = 0;
            let result = tokio::time::timeout(
                Duration::from_secs(10),
                mtr_live(
                    &program,
                    TracerouteOptions {
                        host: "127.0.0.1".into(),
                        timeout: Duration::from_secs(5),
                        max_hops: 1,
                    },
                    &mut cancel,
                    |snapshot| {
                        updates += 1;
                        assert!(snapshot.hops[1].contains("127.0.0.1"));
                        if updates == 2 {
                            sender.send(true).unwrap();
                        }
                    },
                ),
            )
            .await
            .unwrap();
            assert!(matches!(result, Err(NetworkDiagnosticError::Cancelled)));
            assert_eq!(updates, 2);
        });
    }
    #[test]
    fn live_mtr_retains_null_unresponsive_hops_and_keeps_previous_router() {
        let mut stats = MtrStats::default();
        let silence = br#"{"report":{"hops":[{"ttl":1,"host":null,"sent":1,"recv":0,"loss_pct":100,"last":null,"avg":null,"best":null,"worst":null}]}}"#;
        stats.update(silence, 8).unwrap();
        assert_eq!(stats.0[&1].host, "???");
        assert_eq!(stats.0[&1].sent, 1);
        assert!(stats.lines()[1].contains("100.0"));
        stats.update(br#"{"report":{"hops":[{"ttl":1,"host":"127.0.0.1","sent":1,"recv":1,"loss_pct":0,"last":12,"avg":12,"best":12,"worst":12}]}}"#, 8).unwrap();
        stats.update(silence, 8).unwrap();
        assert_eq!(stats.0[&1].host, "127.0.0.1");
        assert_eq!(stats.0[&1].sent, 3);
        assert_eq!(stats.0[&1].received, 1);
        assert_eq!(stats.0[&1].last, 12.0);
    }
    #[test]
    fn live_ping_validates_interval_size_and_platform_arguments() {
        let mut options = LivePingOptions {
            host: "127.0.0.1".into(),
            timeout: Duration::from_secs(2),
            interval: Duration::from_millis(200),
            packet_size: 48,
        };
        options.validate().unwrap();
        let args = live_ping_arguments(&options);
        assert_eq!(args.last().unwrap(), "127.0.0.1");
        #[cfg(windows)]
        assert!(args.windows(2).any(|pair| pair == ["-l", "48"]));
        #[cfg(unix)]
        assert!(args.windows(2).any(|pair| pair == ["-s", "48"]));
        options.interval = Duration::from_millis(199);
        assert!(options.validate().is_err());
        options.interval = Duration::from_secs(61);
        assert!(options.validate().is_err());
        options.interval = Duration::from_secs(1);
        options.packet_size = 65501;
        assert!(options.validate().is_err());
        options.packet_size = 0;
        options.validate().unwrap();
        options.host = "-bad-option".into();
        assert!(options.validate().is_err());
    }

    #[test]
    fn live_ping_respects_interval_and_stops_after_repeated_loopback_replies() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (sender, mut cancel) = watch::channel(false);
            let options = LivePingOptions {
                host: "127.0.0.1".into(),
                timeout: Duration::from_secs(2),
                interval: Duration::from_millis(200),
                packet_size: 48,
            };
            let started = Instant::now();
            let mut snapshots = Vec::new();
            let result = tokio::time::timeout(
                Duration::from_secs(10),
                ping_live(options, &mut cancel, |snapshot| {
                    assert_eq!(snapshot.received, snapshot.sent);
                    assert_eq!(snapshot.packet_size, 48);
                    assert_eq!(snapshot.interval_ms, 200);
                    assert!(snapshot.lines.len() <= 200);
                    assert!(snapshot.lines.iter().any(|line| line.contains("127.0.0.1")));
                    snapshots.push(snapshot.sent);
                    if snapshot.sent == 3 {
                        sender.send(true).unwrap();
                    }
                }),
            )
            .await
            .unwrap();
            assert_eq!(snapshots, vec![1, 2, 3]);
            assert!(started.elapsed() >= Duration::from_millis(400));
            assert!(matches!(result, Err(NetworkDiagnosticError::Cancelled)));
        });
    }

    #[test]
    fn live_ping_can_stop_while_waiting_for_next_probe() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (sender, mut cancel) = watch::channel(false);
            let mut updates = 0;
            let options = LivePingOptions {
                host: "127.0.0.1".into(),
                timeout: Duration::from_secs(2),
                interval: Duration::from_secs(60),
                packet_size: 32,
            };
            let result = tokio::time::timeout(
                Duration::from_secs(5),
                ping_live(options, &mut cancel, |_| {
                    updates += 1;
                    sender.send(true).unwrap();
                }),
            )
            .await
            .unwrap();
            assert_eq!(updates, 1);
            assert!(matches!(result, Err(NetworkDiagnosticError::Cancelled)));
        });
    }
    #[test]
    fn ping_transcript_keeps_one_reply_without_repeated_headers_or_summaries() {
        let windows = b"\r\nPinging 127.0.0.1 with 32 bytes of data:\r\nReply from 127.0.0.1: bytes=32 time<1ms TTL=128\r\n\r\nPing statistics for 127.0.0.1:\r\n    Packets: Sent = 1, Received = 1, Lost = 0\r\n";
        assert_eq!(
            ping_reply_line(windows),
            "Reply from 127.0.0.1: bytes=32 time<1ms TTL=128"
        );
        let unix = b"PING localhost (127.0.0.1) 32(60) bytes of data.\n40 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.012 ms\n\n--- localhost ping statistics ---\n1 packets transmitted, 1 received\n";
        assert_eq!(
            ping_reply_line(unix),
            "40 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.012 ms"
        );
        assert_eq!(ping_reply_line(b"\nPinging example with 32 bytes of data:\nRequest timed out.\n\nPing statistics:\n"), "Request timed out.");
        assert_eq!(ping_reply_line(b"Unknown host."), "Unknown host.");
        assert_eq!(ping_reply_line(b""), "No reply output.");
    }
}
