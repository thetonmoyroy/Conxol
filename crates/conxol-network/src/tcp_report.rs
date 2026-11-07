use crate::{NetworkDiagnosticError, TcpCheckOptions, TcpPortStatus, tcp_error_status};
use serde::Serialize;
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::{TcpStream, lookup_host};
use tokio::time::{Instant, timeout_at};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpConnectReport {
    pub host: String,
    pub port: u16,
    pub status: TcpPortStatus,
    pub elapsed_ms: u64,
    pub output: String,
}

/// One bounded diagnostic; the deadline covers resolution and all attempts.
/// No application data is transmitted and no service identity is assumed.
pub async fn check_tcp_report(
    options: TcpCheckOptions,
) -> Result<TcpConnectReport, NetworkDiagnosticError> {
    options.validate()?;
    let started = Instant::now();
    let started_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let deadline = started + options.timeout;
    let mut lines = vec![
        "TCP CONNECT DIAGNOSTIC".to_owned(),
        format!("Target: {}", options.host),
        format!("Started: {started_unix_ms} ms since Unix epoch (UTC)"),
        format!(
            "Client platform: {} / {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
        "Mode: sequential TCP connect; stop at the first successful endpoint".into(),
        format!("Port: {} / TCP", options.port),
        format!(
            "Timeout: {} ms (resolution and all connection attempts)",
            options.timeout.as_millis()
        ),
        String::new(),
    ];
    let mut addresses = Vec::new();
    let mut status = TcpPortStatus::Failed;
    if let Ok(ip) = options.host.parse::<IpAddr>() {
        lines.push(format!(
            "Resolution: IP literal {ip}; DNS lookup not needed"
        ));
        addresses.push(SocketAddr::new(ip, options.port));
    } else {
        lines.push("Resolution: looking up addresses using the system resolver".into());
        match timeout_at(deadline, lookup_host((options.host.as_str(), options.port))).await {
            Ok(Ok(resolved)) => {
                for address in resolved {
                    if !addresses.contains(&address) {
                        addresses.push(address);
                    }
                    if addresses.len() == 16 {
                        lines.push("Address limit: checking at most 16 distinct endpoints".into());
                        break;
                    }
                }
                lines.push(format!(
                    "Resolution completed in {} ms; {} address(es)",
                    started.elapsed().as_millis(),
                    addresses.len()
                ));
                if addresses.is_empty() {
                    lines.push("Resolution failed: no usable addresses returned".into());
                }
            }
            Ok(Err(error)) => lines.push(format!(
                "Resolution failed: {}",
                error.to_string().chars().take(160).collect::<String>()
            )),
            Err(_) => {
                status = TcpPortStatus::TimedOut;
                lines.push("Resolution timed out".into());
            }
        }
    }
    let resolution_elapsed = started.elapsed();
    let resolved_count = addresses.len();
    let ipv4_count = addresses.iter().filter(|address| address.is_ipv4()).count();
    lines.push(format!(
        "Resolution phase: {} ms",
        duration_ms(resolution_elapsed)
    ));
    lines.push(format!(
        "Address candidates: {resolved_count} (IPv4: {ipv4_count}, IPv6: {})",
        resolved_count - ipv4_count
    ));
    for address in &addresses {
        lines.push(format!(
            "Resolved: {address} ({})",
            if address.is_ipv4() { "IPv4" } else { "IPv6" }
        ));
    }
    let mut attempts = 0;
    let mut connect_elapsed = Duration::ZERO;
    for address in addresses {
        if Instant::now() >= deadline {
            status = TcpPortStatus::TimedOut;
            lines.push("Overall timeout reached; no further connections attempted".into());
            break;
        }
        attempts += 1;
        let attempt = Instant::now();
        lines.push(format!(
            "\nAttempt {attempts}/{resolved_count}: connecting to {address}"
        ));
        lines.push(format!(
            "Attempt started: +{} ms from start",
            duration_ms(started.elapsed())
        ));
        lines.push(format!(
            "Remaining timeout: {} ms",
            duration_ms(deadline.saturating_duration_since(Instant::now()))
        ));
        lines.push(format!(
            "Socket: {} / SOCK_STREAM / TCP",
            if address.is_ipv4() {
                "AF_INET"
            } else {
                "AF_INET6"
            }
        ));
        match timeout_at(deadline, TcpStream::connect(address)).await {
            Ok(Ok(stream)) => {
                status = TcpPortStatus::Open;
                let latency = attempt.elapsed();
                connect_elapsed += latency;
                lines.push(format!("Connected in {} ms", duration_ms(latency)));
                lines.push(
                    "Handshake result: operating system completed TCP connect successfully".into(),
                );
                lines.push(
                    "Connection latency includes OS scheduling; it is not a packet-capture RTT"
                        .into(),
                );
                if let Ok(local) = stream.local_addr() {
                    lines.push(format!("Local endpoint: {local}"));
                }
                if let Ok(peer) = stream.peer_addr() {
                    lines.push(format!("Remote endpoint: {peer}"));
                }
                let socket = socket2::SockRef::from(&stream);
                if let Ok(bytes) = socket.send_buffer_size() {
                    lines.push(format!("Socket send buffer: {bytes} bytes"));
                }
                if let Ok(bytes) = socket.recv_buffer_size() {
                    lines.push(format!("Socket receive buffer: {bytes} bytes"));
                }
                if let Ok(enabled) = socket.keepalive() {
                    lines.push(format!(
                        "TCP keepalive: {}",
                        if enabled { "enabled" } else { "disabled" }
                    ));
                }
                if let Ok(enabled) = stream.nodelay() {
                    lines.push(format!(
                        "TCP_NODELAY: {} (Nagle algorithm {})",
                        if enabled { "enabled" } else { "disabled" },
                        if enabled { "disabled" } else { "enabled" }
                    ));
                }
                let hops = if address.is_ipv4() {
                    socket.ttl_v4()
                } else {
                    socket.unicast_hops_v6()
                };
                if let Ok(hops) = hops {
                    lines.push(format!(
                        "Local outgoing {}: {hops} (not the remote host's TTL)",
                        if address.is_ipv4() {
                            "TTL"
                        } else {
                            "hop limit"
                        }
                    ));
                }
                if let Ok(linger) = socket.linger() {
                    lines.push(format!(
                        "SO_LINGER: {}",
                        linger
                            .map(|duration| format!("{} ms", duration.as_millis()))
                            .unwrap_or_else(|| "disabled".into())
                    ));
                }
                lines.push(
                    "Buffer sizes are local socket settings, not the negotiated TCP window".into(),
                );
                drop(stream);
                lines.push("Connection closed after successful TCP handshake".into());
                break;
            }
            Ok(Err(error)) => {
                connect_elapsed += attempt.elapsed();
                status = tcp_error_status(error.kind());
                lines.push(format!("Error category: {:?}", error.kind()));
                lines.push(format!(
                    "Failed after {} ms: {}",
                    attempt.elapsed().as_millis(),
                    error.to_string().chars().take(160).collect::<String>()
                ));
                if let Some(code) = error.raw_os_error() {
                    lines.push(format!("OS error code: {code}"));
                }
            }
            Err(_) => {
                connect_elapsed += attempt.elapsed();
                status = TcpPortStatus::TimedOut;
                lines.push(format!(
                    "Timed out after {} ms",
                    attempt.elapsed().as_millis()
                ));
                break;
            }
        }
    }
    let summary = match status {
        TcpPortStatus::Open => {
            "OPEN: TCP handshake succeeded. Application health and TLS were not tested."
        }
        TcpPortStatus::Closed => "CLOSED: the endpoint refused the TCP connection.",
        TcpPortStatus::TimedOut => {
            "TIMED OUT: no connection completed within the deadline. Filtering or packet loss is possible."
        }
        _ => "FAILED: connection could not be established; see the details above.",
    };
    let elapsed_ms = started.elapsed().as_millis() as u64;
    lines.extend([
        String::new(),
        format!("Result: {summary}"),
        format!("Attempts: {attempts}"),
        format!("Untried endpoints: {}", resolved_count - attempts),
        format!("Resolution elapsed: {} ms", duration_ms(resolution_elapsed)),
        format!("Connection attempts elapsed: {} ms", duration_ms(connect_elapsed)),
        format!("Total elapsed: {elapsed_ms} ms"),
        "Application bytes sent: 0".into(),
        "Application receive: not read; no HTTP request, TLS handshake or banner probe performed".into(),
        "Packet-level TCP flags, MSS, congestion window, retransmissions and remote TTL: not measured by this connect check".into(),
    ]);
    Ok(TcpConnectReport {
        host: options.host,
        port: options.port,
        status,
        elapsed_ms,
        output: lines.join("\n"),
    })
}

fn duration_ms(duration: Duration) -> String {
    format!("{:.3}", duration.as_secs_f64() * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn verbose_tcp_reports_loopback_handshake_without_application_data() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let report = check_tcp_report(TcpCheckOptions {
            host: "127.0.0.1".into(),
            port,
            timeout: Duration::from_secs(2),
        })
        .await
        .unwrap();
        assert_eq!(report.status, TcpPortStatus::Open);
        for detail in [
            "DNS lookup not needed",
            "IPv4",
            "Attempt 1/1:",
            "Remaining timeout:",
            "Socket send buffer:",
            "Socket receive buffer:",
            "TCP_NODELAY:",
            "TCP keepalive:",
            "Resolution elapsed:",
            "Connection attempts elapsed:",
            "Local endpoint:",
            "Remote endpoint:",
            "Total elapsed:",
            "Application bytes sent: 0",
        ] {
            assert!(report.output.contains(detail), "missing {detail}");
        }
        let (mut socket, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        use tokio::io::AsyncReadExt;
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), socket.read(&mut [0u8; 1]))
                .await
                .unwrap()
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn verbose_tcp_reports_exhausted_deadline_without_connecting() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let report = check_tcp_report(TcpCheckOptions {
            host: "127.0.0.1".into(),
            port,
            timeout: Duration::from_nanos(1),
        })
        .await
        .unwrap();
        assert_eq!(report.status, TcpPortStatus::TimedOut);
        assert!(report.output.contains("Attempts: 0"));
        assert!(report.output.contains("Overall timeout reached"));
    }

    #[tokio::test]
    async fn verbose_tcp_reports_refusal_and_rejects_invalid_requests() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let mut options = TcpCheckOptions {
            host: "127.0.0.1".into(),
            port,
            timeout: Duration::from_secs(5),
        };
        let report = check_tcp_report(options.clone()).await.unwrap();
        assert_eq!(report.status, TcpPortStatus::Closed);
        assert!(report.output.contains("refused"));
        assert!(report.output.contains("OS error code:"));
        options.port = 0;
        assert!(check_tcp_report(options).await.is_err());
    }
}
