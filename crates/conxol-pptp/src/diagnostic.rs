//! Private IPv4 ICMP/UDP probes. All I/O belongs to the encrypted tunnel worker.
use crate::stack::Stack;
use smoltcp::{
    iface::SocketHandle,
    socket::raw,
    wire::{IpProtocol, IpVersion},
};
use std::{
    io,
    net::Ipv4Addr,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, oneshot};
const LIMIT: usize = 128;
#[derive(Clone, Debug)]
pub struct ProbeReply {
    pub from: Ipv4Addr,
    pub reached: bool,
    pub elapsed: Duration,
}
enum Kind {
    Echo { size: usize, ttl: u8 },
    Udp { port: u16 },
}
struct Request {
    target: Ipv4Addr,
    kind: Kind,
    timeout: Duration,
    reply: oneshot::Sender<io::Result<ProbeReply>>,
}
struct Pending {
    request: Request,
    started: Instant,
    token: [u8; 4],
    payload: Vec<u8>,
}
#[derive(Clone)]
pub struct DiagnosticConnector(mpsc::Sender<Request>);
pub struct DiagnosticRouter {
    requests: mpsc::Receiver<Request>,
    pending: Vec<Pending>,
    sockets: Option<(SocketHandle, SocketHandle)>,
}
fn error(kind: io::ErrorKind, message: &str) -> io::Error {
    io::Error::new(kind, message)
}
impl DiagnosticConnector {
    async fn probe(&self, host: &str, kind: Kind, timeout: Duration) -> io::Result<ProbeReply> {
        let target: Ipv4Addr = host.parse().map_err(|_| {
            error(
                io::ErrorKind::InvalidInput,
                "PPTP diagnostics require an IPv4 target.",
            )
        })?;
        if target.is_unspecified()
            || target.is_multicast()
            || target.is_broadcast()
            || timeout.is_zero()
            || timeout > Duration::from_secs(60)
        {
            return Err(error(
                io::ErrorKind::InvalidInput,
                "Invalid private diagnostic probe.",
            ));
        }
        let (reply, response) = oneshot::channel();
        self.0
            .try_send(Request {
                target,
                kind,
                timeout,
                reply,
            })
            .map_err(|_| {
                error(
                    io::ErrorKind::NotConnected,
                    "PPTP diagnostic queue unavailable or busy.",
                )
            })?;
        tokio::time::timeout(timeout + Duration::from_millis(100), response)
            .await
            .map_err(|_| error(io::ErrorKind::TimedOut, "PPTP probe timed out."))?
            .map_err(|_| {
                error(
                    io::ErrorKind::ConnectionAborted,
                    "PPTP tunnel disconnected.",
                )
            })?
    }
    pub async fn echo(
        &self,
        host: &str,
        size: usize,
        ttl: u8,
        timeout: Duration,
    ) -> io::Result<ProbeReply> {
        if ttl == 0 || size > 1332 {
            return Err(error(
                io::ErrorKind::InvalidInput,
                "PPTP Ping payload must fit the tunnel MTU (at most 1332 bytes).",
            ));
        }
        self.probe(host, Kind::Echo { size, ttl }, timeout).await
    }
    pub async fn udp(&self, host: &str, port: u16, timeout: Duration) -> io::Result<ProbeReply> {
        if port == 0 {
            return Err(error(io::ErrorKind::InvalidInput, "Invalid UDP port."));
        }
        self.probe(host, Kind::Udp { port }, timeout).await
    }
}
pub(crate) fn checksum(bytes: &[u8]) -> u16 {
    let mut sum = 0u32;
    for chunk in bytes.chunks(2) {
        sum += u16::from_be_bytes([chunk[0], *chunk.get(1).unwrap_or(&0)]) as u32;
    }
    while sum > 65535 {
        sum = (sum & 65535) + (sum >> 16);
    }
    !(sum as u16)
}
fn packet(local: Ipv4Addr, pending: &Pending) -> Vec<u8> {
    let size = match pending.request.kind {
        Kind::Echo { size, .. } => size,
        Kind::Udp { .. } => 0,
    };
    let mut bytes = vec![0u8; 28 + size];
    bytes[0] = 0x45;
    let len = bytes.len() as u16;
    bytes[2..4].copy_from_slice(&len.to_be_bytes());
    bytes[4..6].copy_from_slice(&pending.token[..2]);
    bytes[6] = 0x40;
    bytes[8] = match pending.request.kind {
        Kind::Echo { ttl, .. } => ttl,
        _ => 64,
    };
    bytes[9] = match pending.request.kind {
        Kind::Echo { .. } => 1,
        _ => 17,
    };
    bytes[12..16].copy_from_slice(&local.octets());
    bytes[16..20].copy_from_slice(&pending.request.target.octets());
    match pending.request.kind {
        Kind::Echo { .. } => {
            bytes[20] = 8;
            bytes[24..28].copy_from_slice(&pending.token);
            bytes[28..].copy_from_slice(&pending.payload);
            let sum = checksum(&bytes[20..]);
            bytes[22..24].copy_from_slice(&sum.to_be_bytes());
        }
        Kind::Udp { port } => {
            bytes[20..22].copy_from_slice(&pending.token[..2]);
            bytes[22..24].copy_from_slice(&port.to_be_bytes());
            bytes[24..26].copy_from_slice(&8u16.to_be_bytes());
        }
    }
    let sum = checksum(&bytes[..20]);
    bytes[10..12].copy_from_slice(&sum.to_be_bytes());
    bytes
}
// Validate outer framing/checksums before correlating replies or quoted errors.
fn ipv4(bytes: &[u8]) -> Option<(Ipv4Addr, Ipv4Addr, u8, &[u8])> {
    if bytes.len() < 20 || bytes[0] >> 4 != 4 {
        return None;
    }
    let header = usize::from(bytes[0] & 15) * 4;
    let length = usize::from(u16::from_be_bytes([bytes[2], bytes[3]]));
    if header < 20
        || length < header
        || bytes.len() < length
        || bytes[6] & 0x3f != 0
        || bytes[7] != 0
        || checksum(&bytes[..header]) != 0
    {
        return None;
    }
    Some((
        Ipv4Addr::new(bytes[12], bytes[13], bytes[14], bytes[15]),
        Ipv4Addr::new(bytes[16], bytes[17], bytes[18], bytes[19]),
        bytes[9],
        &bytes[header..length],
    ))
}
fn match_reply(bytes: &[u8], local: Ipv4Addr, p: &Pending) -> Option<io::Result<ProbeReply>> {
    let (from, to, protocol, payload) = ipv4(bytes)?;
    if to != local || payload.len() < 8 {
        return None;
    }
    if protocol == 17 {
        let Kind::Udp { port } = p.request.kind else {
            return None;
        };
        let length = usize::from(u16::from_be_bytes([payload[4], payload[5]]));
        if from != p.request.target
            || payload[..2] != port.to_be_bytes()
            || payload[2..4] != p.token[..2]
            || length < 8
            || length > payload.len()
        {
            return None;
        }
        if payload[6..8] != [0, 0] {
            let mut pseudo = Vec::from(from.octets());
            pseudo.extend(to.octets());
            pseudo.extend([0, 17]);
            pseudo.extend((length as u16).to_be_bytes());
            pseudo.extend(&payload[..length]);
            if checksum(&pseudo) != 0 {
                return None;
            }
        }
        return Some(Ok(ProbeReply {
            from,
            reached: true,
            elapsed: p.started.elapsed(),
        }));
    }
    if protocol != 1 || checksum(payload) != 0 {
        return None;
    }
    if payload[0] == 0
        && payload[1] == 0
        && matches!(p.request.kind, Kind::Echo { .. })
        && from == p.request.target
        && payload[4..8] == p.token
        && payload[8..] == p.payload
    {
        return Some(Ok(ProbeReply {
            from,
            reached: true,
            elapsed: p.started.elapsed(),
        }));
    }
    if !matches!(payload[0], 3 | 11) || (payload[0] == 11 && payload[1] != 0) {
        return None;
    }
    let quoted = &payload[8..];
    if quoted.len() < 28 || quoted[0] >> 4 != 4 {
        return None;
    }
    let header = usize::from(quoted[0] & 15) * 4;
    if header < 20
        || quoted.len() < header + 8
        || quoted[12..16] != local.octets()
        || quoted[16..20] != p.request.target.octets()
    {
        return None;
    }
    let transport = &quoted[header..];
    let matched = match p.request.kind {
        Kind::Echo { .. } => quoted[9] == 1 && transport[0] == 8 && transport[4..8] == p.token,
        Kind::Udp { port } => {
            quoted[9] == 17
                && transport[..2] == p.token[..2]
                && transport[2..4] == port.to_be_bytes()
        }
    };
    if !matched {
        return None;
    }
    if payload[0] == 3 {
        return Some(Err(error(
            if payload[1] == 3 && matches!(p.request.kind, Kind::Udp { .. }) {
                io::ErrorKind::ConnectionRefused
            } else {
                io::ErrorKind::HostUnreachable
            },
            "Destination unreachable inside PPTP tunnel.",
        )));
    }
    Some(Ok(ProbeReply {
        from,
        reached: false,
        elapsed: p.started.elapsed(),
    }))
}
impl DiagnosticRouter {
    pub fn new() -> (DiagnosticConnector, Self) {
        let (tx, requests) = mpsc::channel(LIMIT);
        (
            DiagnosticConnector(tx),
            Self {
                requests,
                pending: Vec::new(),
                sockets: None,
            },
        )
    }
    pub fn poll(&mut self, stack: &mut Stack) {
        // Avoid allocating capture buffers until diagnostics are actually used.
        if self.sockets.is_none() && !self.requests.is_empty() {
            let mut add = |protocol| {
                stack.sockets.add(raw::Socket::new(
                    IpVersion::Ipv4,
                    protocol,
                    raw::PacketBuffer::new(
                        vec![raw::PacketMetadata::EMPTY; 32],
                        vec![0; stack.mtu * 32],
                    ),
                    raw::PacketBuffer::new(
                        vec![raw::PacketMetadata::EMPTY; 32],
                        vec![0; stack.mtu * 32],
                    ),
                ))
            };
            self.sockets = Some((add(IpProtocol::Icmp), add(IpProtocol::Udp)));
        }
        let Some((icmp, udp)) = self.sockets else {
            return;
        };
        while let Ok(request) = self.requests.try_recv() {
            if request.reply.is_closed() {
                continue;
            }
            if self.pending.len() >= LIMIT {
                let _ = request.reply.send(Err(error(
                    io::ErrorKind::WouldBlock,
                    "PPTP diagnostic capacity reached.",
                )));
                continue;
            }
            let mut token = [0u8; 4];
            if getrandom::fill(&mut token).is_err() {
                let _ = request
                    .reply
                    .send(Err(io::Error::other("Probe randomness unavailable.")));
                continue;
            }
            // Use a high source port and avoid simultaneous UDP/ICMP token collisions.
            token[0] |= 0xc0;
            if self.pending.iter().any(|p| p.token[..2] == token[..2]) {
                let _ = request.reply.send(Err(error(
                    io::ErrorKind::WouldBlock,
                    "Retry private probe.",
                )));
                continue;
            }
            let mut payload = match request.kind {
                Kind::Echo { size, .. } => vec![0; size],
                _ => vec![],
            };
            if getrandom::fill(&mut payload).is_err() {
                let _ = request
                    .reply
                    .send(Err(io::Error::other("Probe randomness unavailable.")));
                continue;
            }
            let pending = Pending {
                request,
                token,
                payload,
                started: Instant::now(),
            };
            let bytes = packet(stack.local_ip, &pending);
            let socket = if matches!(pending.request.kind, Kind::Echo { .. }) {
                icmp
            } else {
                udp
            };
            if bytes.len() > stack.mtu
                || stack
                    .sockets
                    .get_mut::<raw::Socket>(socket)
                    .send_slice(&bytes)
                    .is_err()
            {
                let _ = pending.request.reply.send(Err(error(
                    io::ErrorKind::InvalidInput,
                    "Probe exceeds the PPTP MTU or queue capacity.",
                )));
                continue;
            }
            self.pending.push(pending);
        }
        for handle in [icmp, udp] {
            let socket = stack.sockets.get_mut::<raw::Socket>(handle);
            while socket.can_recv() {
                let Ok(bytes) = socket.recv() else {
                    break;
                };
                if let Some((i, result)) = self
                    .pending
                    .iter()
                    .enumerate()
                    .find_map(|(i, p)| match_reply(bytes, stack.local_ip, p).map(|r| (i, r)))
                {
                    let pending = self.pending.swap_remove(i);
                    let _ = pending.request.reply.send(result);
                }
            }
        }
        let mut i = 0;
        while i < self.pending.len() {
            if self.pending[i].request.reply.is_closed()
                || self.pending[i].started.elapsed() >= self.pending[i].request.timeout
            {
                let pending = self.pending.swap_remove(i);
                let _ = pending
                    .request
                    .reply
                    .send(Err(error(io::ErrorKind::TimedOut, "PPTP probe timed out.")));
            } else {
                i += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mppe::{Codec, Keys};
    use zeroize::Zeroizing;
    fn exchange(a: &mut Stack, b: &mut Stack, send: &mut Codec, receive: &mut Codec) {
        while let Some(ip) = a.outgoing() {
            let encrypted = send.encrypt_ipv4(&ip).unwrap();
            assert!(b.ingest(receive.decrypt_ipv4(&encrypted).unwrap().unwrap()));
        }
    }
    #[tokio::test]
    async fn pptp_diagnostic_echo_udp_and_closed_tcp_use_encrypted_private_ip() {
        let a: Ipv4Addr = "192.0.2.1".parse().unwrap();
        let b: Ipv4Addr = "192.0.2.2".parse().unwrap();
        let mut client = Stack::new(a, b, 1360, 1);
        let mut server = Stack::new(b, a, 1360, 2);
        let mut send = Codec::new(Keys {
            send: Zeroizing::new([1; 16]),
            receive: Zeroizing::new([2; 16]),
        });
        let mut receive = Codec::new(Keys {
            send: Zeroizing::new([2; 16]),
            receive: Zeroizing::new([1; 16]),
        });
        let udp = server.sockets.add(raw::Socket::new(
            IpVersion::Ipv4,
            IpProtocol::Udp,
            raw::PacketBuffer::new(vec![raw::PacketMetadata::EMPTY; 4], vec![0; 4096]),
            raw::PacketBuffer::new(vec![raw::PacketMetadata::EMPTY; 4], vec![0; 4096]),
        ));
        let (connector, mut router) = crate::transport::TcpRouter::new();
        let c = connector.clone();
        let task = tokio::spawn(async move {
            let reply = c
                .diagnostics
                .echo("192.0.2.2", 56, 1, Duration::from_secs(2))
                .await
                .unwrap();
            assert_eq!(reply.from, b);
            assert!(reply.reached);
            assert!(
                c.diagnostics
                    .udp("192.0.2.2", 4321, Duration::from_secs(2))
                    .await
                    .unwrap()
                    .reached
            );
            assert_eq!(
                c.connect("192.0.2.2", 22).await.unwrap_err().kind(),
                io::ErrorKind::ConnectionRefused
            );
        });
        for tick in 0..10000 {
            router.poll(&mut client);
            client.poll(tick);
            exchange(&mut client, &mut server, &mut send, &mut receive);
            server.poll(tick);
            let udp = server.sockets.get_mut::<raw::Socket>(udp);
            if udp.can_recv() {
                let mut reply = udp.recv().unwrap().to_vec();
                assert_eq!(reply[8], 64);
                assert_eq!(reply[22..24], 4321u16.to_be_bytes());
                reply[12..16].copy_from_slice(&b.octets());
                reply[16..20].copy_from_slice(&a.octets());
                let port = [reply[20], reply[21]];
                reply[20..22].copy_from_slice(&4321u16.to_be_bytes());
                reply[22..24].copy_from_slice(&port);
                reply[10..12].fill(0);
                let sum = checksum(&reply[..20]);
                reply[10..12].copy_from_slice(&sum.to_be_bytes());
                udp.send_slice(&reply).unwrap();
            }
            server.poll(tick);
            exchange(&mut server, &mut client, &mut receive, &mut send);
            tokio::task::yield_now().await;
            if task.is_finished() {
                break;
            }
        }
        assert!(task.is_finished());
        task.await.unwrap();
    }
    #[test]
    fn pptp_diagnostic_correlates_ttl_errors_and_rejects_corrupt_or_wrong_endpoints() {
        let local: Ipv4Addr = "192.0.2.1".parse().unwrap();
        let remote: Ipv4Addr = "192.0.2.2".parse().unwrap();
        let (reply, _) = oneshot::channel();
        let pending = Pending {
            request: Request {
                target: remote,
                kind: Kind::Echo { size: 32, ttl: 1 },
                timeout: Duration::from_secs(1),
                reply,
            },
            started: Instant::now(),
            token: [1, 2, 3, 4],
            payload: vec![5; 32],
        };
        let inner = packet(local, &pending);
        assert_eq!(inner[8], 1);
        let mut response = vec![0; 56];
        response[..20].copy_from_slice(&inner[..20]);
        response[2..4].copy_from_slice(&56u16.to_be_bytes());
        response[12..16].copy_from_slice(&remote.octets());
        response[16..20].copy_from_slice(&local.octets());
        response[20] = 11;
        response[28..].copy_from_slice(&inner[..28]);
        let fix = |bytes: &mut Vec<u8>| {
            bytes[22..24].fill(0);
            let sum = checksum(&bytes[20..]);
            bytes[22..24].copy_from_slice(&sum.to_be_bytes());
            bytes[10..12].fill(0);
            let sum = checksum(&bytes[..20]);
            bytes[10..12].copy_from_slice(&sum.to_be_bytes());
        };
        fix(&mut response);
        assert!(
            !match_reply(&response, local, &pending)
                .unwrap()
                .unwrap()
                .reached
        );
        response[55] ^= 1;
        fix(&mut response);
        assert!(match_reply(&response, local, &pending).is_none());
        response[55] ^= 1;
        response[16] = 203;
        fix(&mut response);
        assert!(match_reply(&response, local, &pending).is_none());
        response[16] = local.octets()[0];
        fix(&mut response);
        response[22] ^= 1;
        assert!(match_reply(&response, local, &pending).is_none());
        for n in 0..56 {
            assert!(match_reply(&response[..n], local, &pending).is_none());
        }
    }
    #[tokio::test]
    async fn pptp_diagnostic_cancellation_and_tunnel_loss_release_pending_probes() {
        let (c, mut router) = DiagnosticRouter::new();
        let mut stack = Stack::new(
            "192.0.2.1".parse().unwrap(),
            "192.0.2.2".parse().unwrap(),
            1360,
            1,
        );
        assert!(
            c.echo("fixture.invalid", 0, 64, Duration::from_secs(1))
                .await
                .is_err()
        );
        let probe = {
            let c = c.clone();
            tokio::spawn(async move { c.echo("192.0.2.2", 32, 64, Duration::from_secs(2)).await })
        };
        tokio::task::yield_now().await;
        router.poll(&mut stack);
        assert_eq!(router.pending.len(), 1);
        probe.abort();
        let _ = probe.await;
        router.poll(&mut stack);
        assert!(router.pending.is_empty());
        drop(router);
        assert!(
            c.udp("192.0.2.2", 53, Duration::from_secs(1))
                .await
                .is_err()
        );
    }
}
