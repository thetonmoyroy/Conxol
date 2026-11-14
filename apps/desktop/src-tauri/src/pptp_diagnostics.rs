//! Diagnostics over a selected process-private tunnel. No host network fallback.
use conxol_network::{
    LivePingOptions, LivePingResult, NetworkDiagnosticError as Error, PortProbe, ScanProtocol,
    TcpCheckOptions, TcpCheckResult, TcpConnectReport, TcpPortStatus, TracerouteOptions,
    TracerouteResult,
};
use conxol_pptp::transport::Connector;
use std::{
    io,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::watch;
pub fn ipv4(host: &str) -> Result<(), String> {
    host.parse::<std::net::Ipv4Addr>().map(|_| ()).map_err(|_| "PPTP diagnostics require an IPv4 target; use DNS with an explicit IPv4 resolver for name lookups.".into())
}
fn failure(e: io::Error) -> Error {
    Error::PrivateTransport(e.to_string())
}
async fn stopped(cancel: &mut watch::Receiver<bool>) {
    let _ = cancel.wait_for(|stop| *stop).await;
}
fn port_status(error: io::Error, protocol: ScanProtocol) -> Result<TcpPortStatus, Error> {
    Ok(match error.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => {
            if matches!(protocol, ScanProtocol::Udp) {
                TcpPortStatus::OpenOrFiltered
            } else {
                TcpPortStatus::TimedOut
            }
        }
        io::ErrorKind::ConnectionRefused => TcpPortStatus::Closed,
        _ => return Err(failure(error)),
    })
}
pub async fn check(
    connector: Connector,
    options: TcpCheckOptions,
    protocol: ScanProtocol,
) -> Result<TcpCheckResult, Error> {
    options.validate()?;
    ipv4(&options.host).map_err(Error::PrivateTransport)?;
    let result = tokio::time::timeout(options.timeout, async {
        match protocol {
            ScanProtocol::Tcp => connector
                .connect(&options.host, options.port)
                .await
                .map(drop),
            ScanProtocol::Udp => connector
                .diagnostics
                .udp(&options.host, options.port, options.timeout)
                .await
                .map(|_| ()),
        }
    })
    .await;
    let status = match result {
        Ok(Ok(())) => TcpPortStatus::Open,
        Ok(Err(e)) => port_status(e, protocol)?,
        Err(_) => {
            if matches!(protocol, ScanProtocol::Udp) {
                TcpPortStatus::OpenOrFiltered
            } else {
                TcpPortStatus::TimedOut
            }
        }
    };
    Ok(TcpCheckResult {
        host: options.host,
        port: options.port,
        status,
    })
}
pub fn scan_probe(connector: Connector) -> PortProbe {
    Arc::new(move |options, protocol| {
        let connector = connector.clone();
        Box::pin(check(connector, options, protocol))
    })
}
pub async fn tcp_report(
    connector: Connector,
    options: TcpCheckOptions,
) -> Result<TcpConnectReport, String> {
    let start = Instant::now();
    let timeout = options.timeout;
    let host = options.host.clone();
    let port = options.port;
    let result = check(connector, options, ScanProtocol::Tcp)
        .await
        .map_err(|e| e.to_string())?;
    let elapsed_ms = start.elapsed().as_millis() as u64;
    Ok(TcpConnectReport {
        host: host.clone(),
        port,
        status: result.status,
        elapsed_ms,
        output: format!(
            "TCP CONNECT DIAGNOSTIC\nRoute: private PPTP / encrypted IPv4\nTarget: {host}:{port}\nResolution: IPv4 literal; no system DNS\nTimeout: {} ms\nResult: {:?}\nElapsed: {elapsed_ms} ms\n\nTCP handshake only; no application data sent.\nHost socket options do not apply to this private TCP stack.",
            timeout.as_millis(),
            result.status
        ),
    })
}
pub async fn ping_live(
    connector: Connector,
    options: LivePingOptions,
    cancel: &mut watch::Receiver<bool>,
    mut progress: impl FnMut(LivePingResult),
) -> Result<LivePingResult, Error> {
    options.validate()?;
    ipv4(&options.host).map_err(Error::PrivateTransport)?;
    if usize::from(options.packet_size) > conxol_pptp::MAX_PING_PAYLOAD {
        return Err(Error::PrivateTransport(
            "PPTP Ping payload must fit the tunnel MTU (at most 1422 bytes).".into(),
        ));
    }
    let start = Instant::now();
    let mut report = LivePingResult {
        host: options.host.clone(),
        sent: 0,
        received: 0,
        elapsed_ms: 0,
        interval_ms: options.interval.as_millis() as u64,
        packet_size: options.packet_size,
        lines: vec!["Route: private PPTP / encrypted IPv4".into()],
    };
    loop {
        if *cancel.borrow() {
            return Err(Error::Cancelled);
        }
        let probe_start = tokio::time::Instant::now();
        report.sent += 1;
        let reply = tokio::select! { _=stopped(cancel)=>return Err(Error::Cancelled), r=connector.diagnostics.echo(&options.host,options.packet_size as usize,64,options.timeout)=>r };
        let line = match reply {
            Ok(reply) if !reply.reached => format!("TTL exceeded at {}", reply.from),
            Ok(reply) => {
                report.received += 1;
                format!(
                    "Reply from {}: bytes={} time={:.2} ms",
                    reply.from,
                    options.packet_size,
                    reply.elapsed.as_secs_f64() * 1000.0
                )
            }
            Err(e) if e.kind() == io::ErrorKind::TimedOut => "Request timed out.".into(),
            Err(e) => return Err(failure(e)),
        };
        if report.lines.len() >= 512 {
            report.lines.remove(1);
        }
        report.lines.push(line);
        report.elapsed_ms = start.elapsed().as_millis() as u64;
        progress(report.clone());
        tokio::select! { _=stopped(cancel)=>return Err(Error::Cancelled), _=tokio::time::sleep_until(probe_start+options.interval)=>{} }
    }
}
#[derive(Default)]
struct Hop {
    sent: u64,
    replies: u64,
    last: Option<std::net::Ipv4Addr>,
    sum: f64,
    best: f64,
    worst: f64,
    current: f64,
}
pub async fn mtr_live(
    connector: Connector,
    options: TracerouteOptions,
    cancel: &mut watch::Receiver<bool>,
    mut progress: impl FnMut(TracerouteResult),
) -> Result<TracerouteResult, Error> {
    options.validate()?;
    ipv4(&options.host).map_err(Error::PrivateTransport)?;
    let start = Instant::now();
    let mut hops: Vec<Hop> = (0..options.max_hops).map(|_| Hop::default()).collect();
    let mut report = TracerouteResult {
        host: options.host.clone(),
        reached: false,
        hops: vec![],
        elapsed_ms: 0,
    };
    loop {
        for ttl in 1..=options.max_hops {
            if *cancel.borrow() {
                return Err(Error::Cancelled);
            }
            let hop = &mut hops[usize::from(ttl - 1)];
            hop.sent += 1;
            let reply = tokio::select! {_=stopped(cancel)=>return Err(Error::Cancelled),r=connector.diagnostics.echo(&options.host,32,ttl,options.timeout.min(Duration::from_secs(1)))=>r};
            let mut reached = false;
            match reply {
                Ok(reply) => {
                    let ms = reply.elapsed.as_secs_f64() * 1000.0;
                    hop.replies += 1;
                    hop.last = Some(reply.from);
                    hop.sum += ms;
                    hop.current = ms;
                    if hop.replies == 1 || ms < hop.best {
                        hop.best = ms;
                    }
                    hop.worst = hop.worst.max(ms);
                    reached = reply.reached;
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::TimedOut | io::ErrorKind::ConnectionRefused
                    ) => {}
                Err(e) => return Err(failure(e)),
            }
            report.reached |= reached;
            report.elapsed_ms = start.elapsed().as_millis() as u64;
            report.hops = vec![
                "Route: private PPTP / inner IPv4 hops".into(),
                "HOP  HOST               LOSS%  SENT   LAST ms    AVG ms   BEST ms  WORST ms"
                    .into(),
            ];
            for (i, h) in hops.iter().enumerate().filter(|(_, h)| h.sent > 0) {
                report.hops.push(format!(
                    "{:>3}  {:<18} {:>5.1} {:>5} {:>9.2} {:>9.2} {:>9.2} {:>9.2}",
                    i + 1,
                    h.last.map(|ip| ip.to_string()).unwrap_or("*".into()),
                    (h.sent - h.replies) as f64 / h.sent as f64 * 100.0,
                    h.sent,
                    h.current,
                    if h.replies > 0 {
                        h.sum / h.replies as f64
                    } else {
                        0.0
                    },
                    h.best,
                    h.worst
                ));
            }
            progress(report.clone());
            if reached {
                break;
            }
        }
        tokio::select! {_=stopped(cancel)=>return Err(Error::Cancelled),_=tokio::time::sleep(Duration::from_secs(1))=>{}}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn private_diagnostics_fail_closed_on_tunnel_loss_and_honor_cancel() {
        let (connector, router) = conxol_pptp::transport::TcpRouter::new();
        drop(router);
        assert!(ipv4("fixture.invalid").is_err());
        assert!(ipv4("::1").is_err());
        let options = TcpCheckOptions {
            host: "192.0.2.2".into(),
            port: 22,
            timeout: Duration::from_millis(50),
        };
        assert!(matches!(
            check(connector.clone(), options, ScanProtocol::Tcp).await,
            Err(Error::PrivateTransport(_))
        ));
        let (_sender, mut cancel) = watch::channel(true);
        let options = LivePingOptions {
            host: "192.0.2.2".into(),
            timeout: Duration::from_millis(50),
            interval: Duration::from_millis(200),
            packet_size: 32,
        };
        assert!(matches!(
            ping_live(connector.clone(), options, &mut cancel, |_| {}).await,
            Err(Error::Cancelled)
        ));
        let options = TracerouteOptions {
            host: "192.0.2.2".into(),
            timeout: Duration::from_millis(50),
            max_hops: 2,
        };
        assert!(matches!(
            mtr_live(connector, options, &mut cancel, |_| {}).await,
            Err(Error::Cancelled)
        ));
    }
}
