use super::{MAX_DIAGNOSTIC_OUTPUT_BYTES, NetworkDiagnosticError};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::time::Duration;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum DnsRecordType {
    #[default]
    A,
    Aaaa,
    Cname,
    Mx,
    Ns,
    Txt,
    Soa,
    Ptr,
    Srv,
    Caa,
}

impl DnsRecordType {
    fn name(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::Aaaa => "AAAA",
            Self::Cname => "CNAME",
            Self::Mx => "MX",
            Self::Ns => "NS",
            Self::Txt => "TXT",
            Self::Soa => "SOA",
            Self::Ptr => "PTR",
            Self::Srv => "SRV",
            Self::Caa => "CAA",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsLookupResult {
    pub tool: String,
    pub output: String,
    pub elapsed_ms: u128,
}

fn query_name(host: &str, kind: DnsRecordType) -> Result<String, NetworkDiagnosticError> {
    // No shell is used; keep utility options and batch-file syntax out of the target.
    if host.is_empty()
        || host.len() > 253
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-_:".contains(&b))
        || host.starts_with('-')
    {
        return Err(NetworkDiagnosticError::InvalidTarget);
    }
    if matches!(kind, DnsRecordType::Ptr)
        && let Ok(ip) = host.parse::<IpAddr>()
    {
        return Ok(match ip {
            IpAddr::V4(ip) => {
                let o = ip.octets();
                format!("{}.{}.{}.{}.in-addr.arpa.", o[3], o[2], o[1], o[0])
            }
            IpAddr::V6(ip) => format!(
                "{}.ip6.arpa.",
                format!("{:032x}", u128::from(ip))
                    .chars()
                    .rev()
                    .map(|c| c.to_string())
                    .collect::<Vec<_>>()
                    .join(".")
            ),
        });
    }
    Ok(host.to_owned())
}

fn record_type(kind: DnsRecordType) -> hickory_proto::rr::RecordType {
    use hickory_proto::rr::RecordType;
    match kind {
        DnsRecordType::A => RecordType::A,
        DnsRecordType::Aaaa => RecordType::AAAA,
        DnsRecordType::Cname => RecordType::CNAME,
        DnsRecordType::Mx => RecordType::MX,
        DnsRecordType::Ns => RecordType::NS,
        DnsRecordType::Txt => RecordType::TXT,
        DnsRecordType::Soa => RecordType::SOA,
        DnsRecordType::Ptr => RecordType::PTR,
        DnsRecordType::Srv => RecordType::SRV,
        DnsRecordType::Caa => RecordType::CAA,
    }
}

fn system_servers() -> Result<Vec<std::net::SocketAddr>, NetworkDiagnosticError> {
    #[cfg(windows)]
    let addresses: Vec<IpAddr> = ipconfig::get_adapters()
        .map_err(|_| NetworkDiagnosticError::Resolution)?
        .into_iter()
        .filter(|adapter| adapter.oper_status() == ipconfig::OperStatus::IfOperStatusUp)
        .flat_map(|adapter| adapter.dns_servers().to_vec())
        .collect();
    #[cfg(not(windows))]
    let addresses: Vec<IpAddr> = std::fs::read_to_string("/etc/resolv.conf")
        .map_err(|_| NetworkDiagnosticError::Resolution)?
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            if fields.next()? != "nameserver" {
                return None;
            }
            fields.next()?.parse().ok()
        })
        .collect();
    let mut servers = Vec::new();
    for ip in addresses {
        let addr = std::net::SocketAddr::new(ip, 53);
        if !servers.contains(&addr) {
            servers.push(addr);
        }
        if servers.len() == 8 {
            break;
        }
    }
    if servers.is_empty() {
        return Err(NetworkDiagnosticError::Resolution);
    }
    Ok(servers)
}

fn matches_query(
    response: &hickory_proto::op::Message,
    query: &hickory_proto::op::Message,
) -> bool {
    response.metadata.id == query.metadata.id
        && response.metadata.message_type == hickory_proto::op::MessageType::Response
        && response.metadata.op_code == query.metadata.op_code
        && response.queries == query.queries
}

async fn exchange(
    query: &hickory_proto::op::Message,
    server: std::net::SocketAddr,
) -> Result<(hickory_proto::op::Message, usize, &'static str), NetworkDiagnosticError> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let wire = query
        .to_vec()
        .map_err(|_| NetworkDiagnosticError::InvalidTarget)?;
    let socket = tokio::net::UdpSocket::bind(if server.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    })
    .await
    .map_err(|_| NetworkDiagnosticError::Resolution)?;
    socket
        .connect(server)
        .await
        .map_err(|_| NetworkDiagnosticError::Resolution)?;
    socket
        .send(&wire)
        .await
        .map_err(|_| NetworkDiagnosticError::Resolution)?;
    let mut bytes = vec![0u8; 65535];
    loop {
        let len = socket
            .recv(&mut bytes)
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        let response = hickory_proto::op::Message::from_vec(&bytes[..len])
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        if !matches_query(&response, query) {
            continue;
        }
        if !response.metadata.truncation {
            return Ok((response, len, "UDP"));
        }
        // A truncated UDP packet is retried over length-prefixed DNS/TCP.
        let mut tcp = tokio::net::TcpStream::connect(server)
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        tcp.write_u16(wire.len() as u16)
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        tcp.write_all(&wire)
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        let len = tcp
            .read_u16()
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)? as usize;
        if len < 12 {
            return Err(NetworkDiagnosticError::Resolution);
        }
        tcp.read_exact(&mut bytes[..len])
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        let response = hickory_proto::op::Message::from_vec(&bytes[..len])
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        if !matches_query(&response, query) || response.metadata.truncation {
            return Err(NetworkDiagnosticError::Resolution);
        }
        return Ok((response, len, "TCP"));
    }
}

fn make_query(
    host: &str,
    kind: DnsRecordType,
) -> Result<hickory_proto::op::Message, NetworkDiagnosticError> {
    use hickory_proto::{
        op::{Edns, Message, Query},
        rr::Name,
    };
    let name = query_name(host, kind)?;
    let mut name = Name::from_ascii(&name).map_err(|_| NetworkDiagnosticError::InvalidTarget)?;
    name.set_fqdn(true);
    let mut query = Message::query();
    query.metadata.id = rand::random();
    query.metadata.recursion_desired = true;
    query.add_query(Query::query(name, record_type(kind)));
    let mut edns = Edns::new();
    edns.set_version(0).set_max_payload(1232);
    query.set_edns(edns);
    Ok(query)
}

/// DNS/TCP over an explicitly supplied transport; never consult system resolvers.
pub async fn lookup_dns_stream<S>(
    host: &str,
    kind: DnsRecordType,
    server: &str,
    timeout: Duration,
    mut stream: S,
) -> Result<DnsLookupResult, NetworkDiagnosticError>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let query = make_query(host, kind)?;
    let started = std::time::Instant::now();
    let (response, len) = tokio::time::timeout(timeout, async {
        let wire = query
            .to_vec()
            .map_err(|_| NetworkDiagnosticError::InvalidTarget)?;
        stream
            .write_u16(wire.len() as u16)
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        stream
            .write_all(&wire)
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        let len = stream
            .read_u16()
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)? as usize;
        if len < 12 {
            return Err(NetworkDiagnosticError::Resolution);
        }
        let mut bytes = vec![0; len];
        stream
            .read_exact(&mut bytes)
            .await
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        let response = hickory_proto::op::Message::from_vec(&bytes)
            .map_err(|_| NetworkDiagnosticError::Resolution)?;
        if !matches_query(&response, &query) || response.metadata.truncation {
            return Err(NetworkDiagnosticError::Resolution);
        }
        Ok((response, len))
    })
    .await
    .map_err(|_| NetworkDiagnosticError::Timeout)??;
    format_report(
        kind,
        server,
        started.elapsed().as_millis(),
        response,
        len,
        "TCP / private PPTP",
    )
}

async fn lookup_at(
    host: &str,
    kind: DnsRecordType,
    server: std::net::SocketAddr,
    timeout: Duration,
) -> Result<DnsLookupResult, NetworkDiagnosticError> {
    let query = make_query(host, kind)?;
    let started = std::time::Instant::now();
    let (response, len, transport) = tokio::time::timeout(timeout, exchange(&query, server))
        .await
        .map_err(|_| NetworkDiagnosticError::Timeout)??;
    let elapsed_ms = started.elapsed().as_millis();
    format_report(
        kind,
        &server.to_string(),
        elapsed_ms,
        response,
        len,
        transport,
    )
}

fn format_report(
    kind: DnsRecordType,
    server: &str,
    elapsed_ms: u128,
    response: hickory_proto::op::Message,
    len: usize,
    transport: &str,
) -> Result<DnsLookupResult, NetworkDiagnosticError> {
    let header = &response.metadata;
    let mut output = format!(
        ";; Conxol DNS · {} query\n;; Got answer:\n;; ->>HEADER<<- opcode: {}, status: {}, id: {}\n;; flags: {}; QUERY: {}, ANSWER: {}, AUTHORITY: {}, ADDITIONAL: {}\n",
        kind.name(),
        header.op_code,
        format!("{:?}", header.response_code).to_uppercase(),
        header.id,
        header.flags().to_string().to_lowercase(),
        response.queries.len(),
        response.answers.len(),
        response.authorities.len(),
        response.additionals.len() + usize::from(response.edns.is_some())
    );
    if let Some(edns) = response.edns.as_ref() {
        output.push_str(&format!("\n;; OPT PSEUDOSECTION:\n; {edns}\n"));
    }
    output.push_str("\n;; QUESTION SECTION:\n");
    for question in &response.queries {
        output.push_str(&format!(
            ";{}\t{}\t{}\n",
            question.name, question.query_class, question.query_type
        ));
    }
    for (title, records) in [
        ("ANSWER", &response.answers),
        ("AUTHORITY", &response.authorities),
        ("ADDITIONAL", &response.additionals),
    ] {
        if !records.is_empty() {
            output.push_str(&format!("\n;; {title} SECTION:\n"));
        }
        for record in records {
            output.push_str(&format!("{record}\n"));
            if output.len() > MAX_DIAGNOSTIC_OUTPUT_BYTES {
                return Err(NetworkDiagnosticError::OutputTooLarge);
            }
        }
    }
    output.push_str(&format!("\n;; Query time: {elapsed_ms} msec\n;; SERVER: {server}\n;; TRANSPORT: {transport}\n;; MSG SIZE rcvd: {len}\n"));
    if output.len() > MAX_DIAGNOSTIC_OUTPUT_BYTES {
        return Err(NetworkDiagnosticError::OutputTooLarge);
    }
    Ok(DnsLookupResult {
        tool: "Conxol DNS".into(),
        output,
        elapsed_ms,
    })
}

pub async fn lookup_dns(
    host: &str,
    kind: DnsRecordType,
    server: Option<&str>,
    timeout: Duration,
) -> Result<DnsLookupResult, NetworkDiagnosticError> {
    if timeout.is_zero() {
        return Err(NetworkDiagnosticError::InvalidTarget);
    }
    query_name(host, kind)?;
    let servers = if let Some(server) = server.filter(|s| !s.is_empty()) {
        vec![std::net::SocketAddr::new(
            server
                .parse()
                .map_err(|_| NetworkDiagnosticError::InvalidTarget)?,
            53,
        )]
    } else {
        tokio::task::spawn_blocking(system_servers)
            .await
            .map_err(|_| NetworkDiagnosticError::Worker)??
    };
    let deadline = tokio::time::Instant::now() + timeout;
    let mut error = NetworkDiagnosticError::Resolution;
    let count = servers.len();
    for server in servers {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(NetworkDiagnosticError::Timeout);
        }
        let attempt_timeout = if count > 1 {
            remaining.min(Duration::from_millis(1500))
        } else {
            remaining
        };
        match lookup_at(host, kind, server, attempt_timeout).await {
            Ok(report) => return Ok(report),
            Err(cause) => error = cause,
        }
    }
    Err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn pptp_dns_supplied_stream_validates_response_and_uses_no_system_resolver() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for invalid in [false, true] {
            let (client, mut server) = tokio::io::duplex(4096);
            let worker = tokio::spawn(async move {
                let length = server.read_u16().await.unwrap() as usize;
                let mut wire = vec![0; length];
                server.read_exact(&mut wire).await.unwrap();
                let mut response = hickory_proto::op::Message::from_vec(&wire).unwrap();
                response.metadata.message_type = hickory_proto::op::MessageType::Response;
                if invalid {
                    response.metadata.id ^= 1;
                }
                let wire = response.to_vec().unwrap();
                server.write_u16(wire.len() as u16).await.unwrap();
                server.write_all(&wire).await.unwrap();
            });
            let report = lookup_dns_stream(
                "fixture.invalid",
                DnsRecordType::A,
                "192.0.2.53",
                Duration::from_secs(1),
                client,
            )
            .await;
            if invalid {
                assert!(matches!(report, Err(NetworkDiagnosticError::Resolution)));
            } else {
                let report = report.unwrap();
                assert!(report.output.contains("TCP / private PPTP"));
                assert!(report.output.contains("fixture.invalid"));
            }
            worker.await.unwrap();
        }
    }
    #[test]
    fn dns_targets_and_reverse_queries_are_validated() {
        for host in [
            "-debug",
            "+short",
            "@1.1.1.1",
            "two names",
            "file/name",
            "a\nb",
        ] {
            assert!(query_name(host, DnsRecordType::A).is_err());
        }
        assert_eq!(
            query_name("192.0.2.1", DnsRecordType::Ptr).unwrap(),
            "1.2.0.192.in-addr.arpa."
        );
        assert!(
            query_name("::1", DnsRecordType::Ptr)
                .unwrap()
                .ends_with(".ip6.arpa.")
        );
        assert!(query_name("_sip._tcp.example.test", DnsRecordType::Srv).is_ok());
    }
    #[tokio::test]
    async fn truncated_dns_retries_tcp_and_ignores_wrong_udp_transaction() {
        use hickory_proto::op::Message;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let tcp = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let server = tcp.local_addr().unwrap();
        let udp = tokio::net::UdpSocket::bind(server).await.unwrap();
        let task = tokio::spawn(async move {
            let mut bytes = vec![0u8; 2048];
            let (len, peer) = udp.recv_from(&mut bytes).await.unwrap();
            let query = Message::from_vec(&bytes[..len]).unwrap();
            let mut response =
                Message::response(query.metadata.id.wrapping_add(1), query.metadata.op_code);
            response.queries = query.queries.clone();
            udp.send_to(&response.to_vec().unwrap(), peer)
                .await
                .unwrap();
            response.metadata.id = query.metadata.id;
            response.metadata.truncation = true;
            udp.send_to(&response.to_vec().unwrap(), peer)
                .await
                .unwrap();
            let (mut stream, _) = tcp.accept().await.unwrap();
            let len = stream.read_u16().await.unwrap() as usize;
            stream.read_exact(&mut bytes[..len]).await.unwrap();
            let tcp_query = Message::from_vec(&bytes[..len]).unwrap();
            assert_eq!(query.queries, tcp_query.queries);
            response.metadata.truncation = false;
            let wire = response.to_vec().unwrap();
            stream.write_u16(wire.len() as u16).await.unwrap();
            stream.write_all(&wire).await.unwrap();
        });
        let report = lookup_at(
            "example.test",
            DnsRecordType::Aaaa,
            server,
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        assert!(report.output.contains("TRANSPORT: TCP"));
        assert!(report.output.contains("AAAA"));
        task.await.unwrap();
    }

    #[tokio::test]
    async fn silent_dns_server_times_out_and_bad_resolver_is_rejected() {
        let socket = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        assert!(matches!(
            lookup_at(
                "example.test",
                DnsRecordType::Txt,
                socket.local_addr().unwrap(),
                Duration::from_millis(30)
            )
            .await,
            Err(NetworkDiagnosticError::Timeout)
        ));
        assert!(matches!(
            lookup_dns(
                "example.test",
                DnsRecordType::A,
                Some("not-an-ip"),
                Duration::from_secs(1)
            )
            .await,
            Err(NetworkDiagnosticError::InvalidTarget)
        ));
    }

    #[tokio::test]
    async fn native_dns_report_preserves_records_ttls_and_negative_answers() {
        use hickory_proto::{
            op::{Message, MessageType, ResponseCode},
            rr::{RData, Record, rdata::A},
        };
        for negative in [false, true] {
            let socket = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
            let server = socket.local_addr().unwrap();
            let task = tokio::spawn(async move {
                let mut bytes = [0u8; 2048];
                let (len, peer) = socket.recv_from(&mut bytes).await.unwrap();
                let query = Message::from_vec(&bytes[..len]).unwrap();
                let mut response = Message::response(query.metadata.id, query.metadata.op_code);
                response.metadata.message_type = MessageType::Response;
                response.metadata.recursion_available = true;
                response.metadata.recursion_desired = true;
                response.queries = query.queries.clone();
                if negative {
                    response.metadata.response_code = ResponseCode::NXDomain;
                } else {
                    response.add_answer(Record::from_rdata(
                        query.queries[0].name.clone(),
                        300,
                        RData::A(A("192.0.2.42".parse().unwrap())),
                    ));
                }
                socket
                    .send_to(&response.to_vec().unwrap(), peer)
                    .await
                    .unwrap();
            });
            let report = lookup_at(
                "example.test",
                DnsRecordType::A,
                server,
                Duration::from_secs(2),
            )
            .await
            .unwrap();
            assert!(report.output.contains("QUESTION SECTION"));
            assert!(report.output.contains("TRANSPORT: UDP"));
            if negative {
                assert!(report.output.contains("NXDOMAIN"));
            } else {
                assert!(report.output.contains("ANSWER SECTION"));
                assert!(report.output.contains("300"));
                assert!(report.output.contains("192.0.2.42"));
            }
            task.await.unwrap();
        }
    }
}
