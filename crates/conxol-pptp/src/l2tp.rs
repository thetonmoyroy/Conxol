//! Bounded L2TPv2 wire codec (RFC 2661).
//!
//! Native UDP transport. Plain L2TP does not authenticate or encrypt packets.
use std::io;

const MAX_PACKET: usize = 4096;
const T: u16 = 0x8000;
const L: u16 = 0x4000;
const S: u16 = 0x0800;
const O: u16 = 0x0200;
const P: u16 = 0x0100;

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid L2TPv2 packet")
}

fn word(bytes: &[u8], pos: &mut usize) -> io::Result<u16> {
    let value = bytes.get(*pos..*pos + 2).ok_or_else(invalid)?;
    *pos += 2;
    Ok(u16::from_be_bytes([value[0], value[1]]))
}

#[derive(Debug, PartialEq, Eq)]
pub struct Packet<'a> {
    pub control: bool,
    pub tunnel: u16,
    pub session: u16,
    pub sequence: Option<(u16, u16)>,
    pub payload: &'a [u8],
}

impl<'a> Packet<'a> {
    pub fn decode(bytes: &'a [u8]) -> io::Result<Self> {
        if bytes.len() > MAX_PACKET {
            return Err(invalid());
        }
        let mut pos = 0;
        let flags = word(bytes, &mut pos)?;
        let control = flags & T != 0;
        if flags & 0xf != 2 || flags & !(T | L | S | O | P | 0xf) != 0 {
            return Err(invalid());
        }
        if control && (flags & (L | S) != L | S || flags & (O | P) != 0) {
            return Err(invalid());
        }
        if flags & L != 0 && usize::from(word(bytes, &mut pos)?) != bytes.len() {
            return Err(invalid());
        }
        let tunnel = word(bytes, &mut pos)?;
        let session = word(bytes, &mut pos)?;
        let sequence = if flags & S != 0 {
            Some((word(bytes, &mut pos)?, word(bytes, &mut pos)?))
        } else {
            None
        };
        if flags & O != 0 {
            pos += usize::from(word(bytes, &mut pos)?);
        }
        let payload = bytes.get(pos..).ok_or_else(invalid)?;
        Ok(Self {
            control,
            tunnel,
            session,
            sequence,
            payload,
        })
    }

    pub fn encode(&self) -> io::Result<Vec<u8>> {
        if self.control && self.sequence.is_none() {
            return Err(invalid());
        }
        let len = 8 + usize::from(self.sequence.is_some()) * 4 + self.payload.len();
        if len > MAX_PACKET {
            return Err(invalid());
        }
        let flags =
            2 | L | if self.control { T } else { 0 } | if self.sequence.is_some() { S } else { 0 };
        let mut bytes = Vec::with_capacity(len);
        for value in [flags, len as u16, self.tunnel, self.session] {
            bytes.extend_from_slice(&value.to_be_bytes());
        }
        if let Some((ns, nr)) = self.sequence {
            bytes.extend_from_slice(&ns.to_be_bytes());
            bytes.extend_from_slice(&nr.to_be_bytes());
        }
        bytes.extend_from_slice(self.payload);
        Ok(bytes)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Avp<'a> {
    pub mandatory: bool,
    pub vendor: u16,
    pub kind: u16,
    pub value: &'a [u8],
}

/// Hidden AVPs require the tunnel shared-secret mechanism, which is distinct
/// from both a PPP password and an IPsec PSK. Reject them rather than guessing.
pub fn decode_avps(mut bytes: &[u8]) -> io::Result<Vec<Avp<'_>>> {
    let mut avps = Vec::new();
    while !bytes.is_empty() {
        if avps.len() >= 64 {
            return Err(invalid());
        }
        let mut pos = 0;
        let flags = word(bytes, &mut pos)?;
        let len = usize::from(flags & 0x03ff);
        if flags & 0x7c00 != 0 || len < 6 || len > bytes.len() {
            return Err(invalid());
        }
        let vendor = word(bytes, &mut pos)?;
        let kind = word(bytes, &mut pos)?;
        avps.push(Avp {
            mandatory: flags & 0x8000 != 0,
            vendor,
            kind,
            value: &bytes[6..len],
        });
        bytes = &bytes[len..];
    }
    Ok(avps)
}

pub fn encode_avps(avps: &[Avp<'_>]) -> io::Result<Vec<u8>> {
    if avps.len() > 64 {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    for avp in avps {
        let len = avp.value.len() + 6;
        if len > 1023 || bytes.len() + len > MAX_PACKET - 12 {
            return Err(invalid());
        }
        let flags = len as u16 | if avp.mandatory { 0x8000 } else { 0 };
        for word in [flags, avp.vendor, avp.kind] {
            bytes.extend_from_slice(&word.to_be_bytes());
        }
        bytes.extend_from_slice(avp.value);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_and_zlb_wire_vectors() {
        let zlb = [0xc8, 2, 0, 12, 0, 7, 0, 0, 0xff, 0xff, 0, 0];
        let packet = Packet::decode(&zlb).unwrap();
        assert!(packet.control);
        assert_eq!(packet.sequence, Some((65535, 0)));
        assert_eq!(packet.encode().unwrap(), zlb);
        let sccrq = [0x80, 8, 0, 0, 0, 0, 0, 1];
        let avps = decode_avps(&sccrq).unwrap();
        assert_eq!(avps[0].value, [0, 1]);
        assert_eq!(encode_avps(&avps).unwrap(), sccrq);
    }

    #[test]
    fn data_optional_headers_and_offsets() {
        let bytes = [
            0x0a, 2, 0, 7, 0, 9, 0, 1, 0, 2, 0, 3, 0, 0, 0, 0xff, 3, 0xc0, 0x21,
        ];
        let p = Packet::decode(&bytes).unwrap();
        assert!(!p.control);
        assert_eq!((p.tunnel, p.session), (7, 9));
        assert_eq!(p.payload, [0xff, 3, 0xc0, 0x21]);
        assert_eq!(Packet::decode(&p.encode().unwrap()).unwrap(), p);
    }

    #[test]
    fn malformed_untrusted_packets_are_rejected_without_panics() {
        let valid = [0xc8, 2, 0, 12, 0, 7, 0, 0, 0, 0, 0, 0];
        for end in 0..valid.len() {
            assert!(Packet::decode(&valid[..end]).is_err());
        }
        for flags in [0xc8u8, 0x88, 0xc0, 0xca, 0xc9] {
            let mut bad = valid;
            bad[0] = flags;
            if flags != 0xc8 {
                assert!(Packet::decode(&bad).is_err());
            }
        }
        for avp in [
            &[0x80, 0, 0, 0, 0, 0][..],
            &[0xc0, 6, 0, 0, 0, 0],
            &[0x80, 7, 0, 0, 0, 0],
        ] {
            assert!(decode_avps(avp).is_err());
        }
        assert!(Packet::decode(&vec![0; MAX_PACKET + 1]).is_err());
        // Exercise every possible header flag combination with a short buffer.
        for flags in 0u16..=u16::MAX {
            let mut bytes = valid;
            bytes[..2].copy_from_slice(&flags.to_be_bytes());
            let _ = Packet::decode(&bytes);
        }
    }
}

use std::{
    net::{SocketAddr, UdpSocket},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

enum Datagram {
    Plain(UdpSocket),
    Protected(std::cell::RefCell<crate::ipsec::Transport>),
}
impl Datagram {
    fn send(&self, bytes: &[u8]) -> io::Result<usize> {
        match self {
            Self::Plain(s) => s.send(bytes),
            Self::Protected(s) => s.borrow_mut().send(bytes),
        }
    }
    fn recv(&self, bytes: &mut [u8]) -> io::Result<usize> {
        match self {
            Self::Plain(s) => s.recv(bytes),
            Self::Protected(s) => s.borrow_mut().recv(bytes),
        }
    }
}
/// One private LAC session, with stop-and-wait reliable control delivery.
/// The socket never creates a host interface, route, or DNS configuration.
pub struct Tunnel {
    socket: Datagram,
    cancel: Arc<AtomicBool>,
    local: u16,
    remote: u16,
    session: u16,
    peer_session: u16,
    ns: u16,
    nr: u16,
    last_rx: Instant,
    pending: Option<(u16, Vec<u8>, Instant, u8)>,
    queued: std::collections::VecDeque<Vec<u8>>,
}
impl Tunnel {
    pub fn connect(server: SocketAddr, cancel: Arc<AtomicBool>) -> io::Result<Self> {
        if !server.is_ipv4() {
            return Err(invalid());
        }
        let socket = UdpSocket::bind((std::net::Ipv4Addr::UNSPECIFIED, 0))?;
        socket.connect(server)?;
        socket.set_read_timeout(Some(Duration::from_millis(10)))?;
        socket.set_write_timeout(Some(Duration::from_secs(2)))?;
        Self::negotiate(Datagram::Plain(socket), cancel)
    }
    pub fn connect_ipsec(
        server: std::net::Ipv4Addr,
        psk: &str,
        cancel: Arc<AtomicBool>,
    ) -> io::Result<Self> {
        let transport = crate::ipsec::Transport::connect(server, psk, cancel.clone())?;
        Self::negotiate(
            Datagram::Protected(std::cell::RefCell::new(transport)),
            cancel,
        )
    }
    fn negotiate(socket: Datagram, cancel: Arc<AtomicBool>) -> io::Result<Self> {
        let mut random = [0; 4];
        getrandom::fill(&mut random).map_err(io::Error::other)?;
        let mut tunnel = Self {
            socket,
            cancel,
            local: u16::from_be_bytes([random[0], random[1]]).max(1),
            remote: 0,
            session: u16::from_be_bytes([random[2], random[3]]).max(1),
            peer_session: 0,
            ns: 0,
            nr: 0,
            last_rx: Instant::now(),
            pending: None,
            queued: Default::default(),
        };
        let local = tunnel.local.to_be_bytes();
        tunnel.control(
            1,
            0,
            &[
                (2, &[1, 0]),
                (3, &[0, 0, 0, 3]),
                (7, b"Conxol"),
                (9, &local),
                (10, &[0, 1]),
            ],
        )?;
        let reply = tunnel.wait(2)?;
        let avps = decode_avps(&reply)?;
        if Self::value(&avps, 2)? != [1, 0]
            || Self::value(&avps, 3)?.len() != 4
            || Self::value(&avps, 7)?.is_empty()
        {
            return Err(invalid());
        }
        tunnel.remote = Self::id(&avps, 9)?;
        if avps
            .iter()
            .any(|a| a.vendor == 0 && [11, 13].contains(&a.kind))
        {
            return Err(io::Error::other(
                "L2TP tunnel-secret authentication is unsupported",
            ));
        }
        tunnel.control(3, 0, &[])?;
        tunnel.wait_ack()?;
        let session = tunnel.session.to_be_bytes();
        tunnel.control(10, 0, &[(14, &session), (15, &random)])?;
        let reply = tunnel.wait(11)?;
        tunnel.peer_session = Self::id(&decode_avps(&reply)?, 14)?;
        tunnel.control(
            12,
            tunnel.peer_session,
            &[(19, &[0, 0, 0, 1]), (24, &[0, 0, 0, 1])],
        )?;
        tunnel.wait_ack()?;
        Ok(tunnel)
    }
    fn value<'a>(avps: &[Avp<'a>], kind: u16) -> io::Result<&'a [u8]> {
        let mut matching = avps.iter().filter(|a| a.vendor == 0 && a.kind == kind);
        let value = matching.next().ok_or_else(invalid)?.value;
        if matching.next().is_some() {
            return Err(invalid());
        }
        Ok(value)
    }
    fn id(avps: &[Avp<'_>], kind: u16) -> io::Result<u16> {
        let value = Self::value(avps, kind)?;
        if value.len() != 2 {
            return Err(invalid());
        }
        let id = u16::from_be_bytes([value[0], value[1]]);
        if id == 0 {
            return Err(invalid());
        }
        Ok(id)
    }
    fn control(&mut self, kind: u16, session: u16, attributes: &[(u16, &[u8])]) -> io::Result<()> {
        if self.pending.is_some() {
            return Err(io::Error::other("L2TP control window is busy"));
        }
        let message = kind.to_be_bytes();
        let mut avps = vec![Avp {
            mandatory: true,
            vendor: 0,
            kind: 0,
            value: &message,
        }];
        avps.extend(attributes.iter().map(|(kind, value)| Avp {
            mandatory: true,
            vendor: 0,
            kind: *kind,
            value,
        }));
        let payload = encode_avps(&avps)?;
        let bytes = Packet {
            control: true,
            tunnel: self.remote,
            session,
            sequence: Some((self.ns, self.nr)),
            payload: &payload,
        }
        .encode()?;
        self.socket.send(&bytes)?;
        self.pending = Some((self.ns, bytes, Instant::now(), 0));
        self.ns = self.ns.wrapping_add(1);
        Ok(())
    }
    fn ack(&self) -> io::Result<()> {
        self.socket.send(
            &Packet {
                control: true,
                tunnel: self.remote,
                session: 0,
                sequence: Some((self.ns, self.nr)),
                payload: &[],
            }
            .encode()?,
        )?;
        Ok(())
    }
    fn tick(&mut self) -> io::Result<()> {
        if self.cancel.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "L2TP connection cancelled",
            ));
        }
        if self.last_rx.elapsed() > Duration::from_secs(90) {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "L2TP peer stopped responding",
            ));
        }
        if let Some((_, bytes, sent, retries)) = &mut self.pending {
            if sent.elapsed() >= Duration::from_secs(1u64 << (*retries).min(3)) {
                if *retries >= 5 {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "L2TP control acknowledgement timed out",
                    ));
                }
                self.socket.send(bytes)?;
                *sent = Instant::now();
                *retries += 1;
            }
        }
        Ok(())
    }
    fn read(&mut self) -> io::Result<Option<(u16, Vec<u8>)>> {
        self.tick()?;
        let mut bytes = [0; MAX_PACKET + 1];
        let n = match self.socket.recv(&mut bytes) {
            Ok(n) => n,
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                return Ok(None);
            }
            Err(e) => return Err(e),
        };
        let p = match Packet::decode(&bytes[..n]) {
            Ok(p) => p,
            Err(_) => return Ok(None),
        };
        if p.tunnel != self.local {
            return Ok(None);
        }
        if !p.control {
            if p.session == self.session && self.peer_session != 0 {
                self.last_rx = Instant::now();
                return Ok(Some((0, p.payload.to_vec())));
            }
            return Ok(None);
        }
        let (ns, nr) = p.sequence.ok_or_else(invalid)?;
        if nr != self.ns
            && self
                .pending
                .as_ref()
                .is_none_or(|(seq, _, _, _)| nr != *seq)
        {
            return Ok(None);
        }
        if nr == self.ns {
            self.pending = None;
        }
        if p.payload.is_empty() {
            self.last_rx = Instant::now();
            return Ok(None);
        }
        if ns != self.nr {
            self.ack()?;
            return Ok(None);
        }
        let avps = decode_avps(p.payload)?;
        if avps
            .first()
            .is_none_or(|a| a.vendor != 0 || a.kind != 0 || !a.mandatory)
        {
            return Err(invalid());
        }
        for a in &avps {
            if a.mandatory
                && (a.vendor != 0
                    || ![0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 19, 24].contains(&a.kind))
            {
                return Err(io::Error::other("Unsupported mandatory L2TP attribute"));
            }
        }
        let kind = Self::id(&avps, 0)?;
        if (kind == 11 && p.session != self.session) || ([2, 6].contains(&kind) && p.session != 0) {
            return Ok(None);
        }
        self.nr = self.nr.wrapping_add(1);
        self.last_rx = Instant::now();
        // SCCRP assigns the destination for its own acknowledgement.
        if kind == 2 && self.remote == 0 {
            self.remote = Self::id(&avps, 9)?;
        }
        self.ack()?;
        if [4, 14].contains(&kind) {
            return Err(io::Error::other("Server closed the L2TP tunnel/session"));
        }
        Ok(Some((kind, p.payload.to_vec())))
    }
    fn wait(&mut self, wanted: u16) -> io::Result<Vec<u8>> {
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if let Some((kind, body)) = self.read()? {
                if kind == wanted {
                    return Ok(body);
                }
            }
        }
        Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "L2TP negotiation timed out",
        ))
    }
    fn wait_ack(&mut self) -> io::Result<()> {
        let deadline = Instant::now() + Duration::from_secs(30);
        while self.pending.is_some() && Instant::now() < deadline {
            if let Some((0, body)) = self.read()? {
                if self.queued.len() >= 32 {
                    return Err(io::Error::other("L2TP setup data queue exceeded"));
                }
                self.queued.push_back(body);
            }
        }
        if self.pending.is_some() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "L2TP acknowledgement timed out",
            ));
        }
        Ok(())
    }
}
#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
impl crate::ppp::PppIo for Tunnel {
    fn send(&mut self, protocol: u16, body: &[u8]) -> io::Result<()> {
        self.tick()?;
        let mut payload = vec![0xff, 3];
        payload.extend_from_slice(&protocol.to_be_bytes());
        payload.extend_from_slice(body);
        let packet = Packet {
            control: false,
            tunnel: self.remote,
            session: self.peer_session,
            sequence: None,
            payload: &payload,
        };
        self.socket.send(&packet.encode()?)?;
        Ok(())
    }
    fn receive(&mut self) -> io::Result<Option<Vec<u8>>> {
        self.tick()?;
        if let Some(body) = self.queued.pop_front() {
            return Ok(Some(body));
        }
        if self.pending.is_none() && self.last_rx.elapsed() > Duration::from_secs(30) {
            self.control(6, 0, &[])?;
        }
        Ok(self
            .read()?
            .and_then(|(kind, body)| if kind == 0 { Some(body) } else { None }))
    }
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        if self.remote != 0 {
            self.pending = None;
            let local = self.local.to_be_bytes();
            let _ = self.control(4, 0, &[(1, &[0, 1]), (9, &local)]);
        }
    }
}

#[cfg(all(test, any(windows, target_os = "linux", target_os = "macos")))]
mod native_tests {
    use super::*;
    use crate::ppp::PppIo;
    #[test]
    fn loopback_negotiation_data_and_cancellation() {
        let server = UdpSocket::bind("127.0.0.1:0").unwrap();
        server
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let address = server.local_addr().unwrap();
        let peer = std::thread::spawn(move || {
            let mut bytes = [0; 4096];
            let (n, address) = server.recv_from(&mut bytes).unwrap();
            let packet = Packet::decode(&bytes[..n]).unwrap();
            let avps = decode_avps(packet.payload).unwrap();
            assert_eq!(Tunnel::id(&avps, 0).unwrap(), 1);
            let local = Tunnel::id(&avps, 9).unwrap();
            let send = |ns, nr, session, kind: u16, attrs: &[(u16, &[u8])]| {
                let message = kind.to_be_bytes();
                let mut avps = vec![Avp {
                    mandatory: true,
                    vendor: 0,
                    kind: 0,
                    value: &message,
                }];
                avps.extend(attrs.iter().map(|(kind, value)| Avp {
                    mandatory: true,
                    vendor: 0,
                    kind: *kind,
                    value,
                }));
                let payload = encode_avps(&avps).unwrap();
                server
                    .send_to(
                        &Packet {
                            control: true,
                            tunnel: local,
                            session,
                            sequence: Some((ns, nr)),
                            payload: &payload,
                        }
                        .encode()
                        .unwrap(),
                        address,
                    )
                    .unwrap();
            };
            send(
                0,
                1,
                0,
                2,
                &[
                    (2, &[1, 0]),
                    (3, &[0, 0, 0, 3]),
                    (7, b"fixture"),
                    (9, &[0, 77]),
                ],
            );
            let mut local_session = 0;
            loop {
                let (n, _) = server.recv_from(&mut bytes).unwrap();
                let p = Packet::decode(&bytes[..n]).unwrap();
                if !p.control {
                    assert_eq!((p.tunnel, p.session), (77, 88));
                    assert_eq!(p.payload, [255, 3, 0, 33, 1, 2, 3]);
                    server
                        .send_to(
                            &Packet {
                                control: false,
                                tunnel: local,
                                session: local_session,
                                sequence: None,
                                payload: &[255, 3, 0, 33, 4, 5, 6],
                            }
                            .encode()
                            .unwrap(),
                            address,
                        )
                        .unwrap();
                    break;
                }
                if p.payload.is_empty() {
                    continue;
                }
                let avps = decode_avps(p.payload).unwrap();
                match Tunnel::id(&avps, 0).unwrap() {
                    3 => {
                        server
                            .send_to(
                                &Packet {
                                    control: true,
                                    tunnel: local,
                                    session: 0,
                                    sequence: Some((1, 2)),
                                    payload: &[],
                                }
                                .encode()
                                .unwrap(),
                                address,
                            )
                            .unwrap();
                    }
                    10 => {
                        local_session = Tunnel::id(&avps, 14).unwrap();
                        send(1, 3, local_session, 11, &[(14, &[0, 88])]);
                    }
                    12 => {
                        server
                            .send_to(
                                &Packet {
                                    control: true,
                                    tunnel: local,
                                    session: 0,
                                    sequence: Some((2, 4)),
                                    payload: &[],
                                }
                                .encode()
                                .unwrap(),
                                address,
                            )
                            .unwrap();
                    }
                    _ => panic!("unexpected control message"),
                }
            }
        });
        let cancel = Arc::new(AtomicBool::new(false));
        let mut tunnel = Tunnel::connect(address, cancel.clone()).unwrap();
        tunnel.send(0x21, &[1, 2, 3]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(body) = tunnel.receive().unwrap() {
                assert_eq!(body, [255, 3, 0, 33, 4, 5, 6]);
                break;
            }
            assert!(Instant::now() < deadline);
        }
        cancel.store(true, Ordering::Release);
        assert_eq!(
            tunnel.receive().unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
        peer.join().unwrap();
    }
}
