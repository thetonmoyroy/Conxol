use std::{
    io::{self, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    time::{Duration, Instant},
};
pub struct Control {
    stream: TcpStream,
    buffered: Vec<u8>,
    call: Option<u16>,
    cancel: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
}
pub fn frame(kind: u16, body: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(12 + body.len());
    bytes.extend_from_slice(&((12 + body.len()) as u16).to_be_bytes());
    bytes.extend_from_slice(&[0, 1, 0x1a, 0x2b, 0x3c, 0x4d]);
    bytes.extend_from_slice(&kind.to_be_bytes());
    bytes.extend_from_slice(&[0, 0]);
    bytes.extend_from_slice(body);
    bytes
}
impl Control {
    pub fn connect(server: Ipv4Addr) -> io::Result<Self> {
        let stream =
            TcpStream::connect_timeout(&SocketAddr::from((server, 1723)), Duration::from_secs(5))?;
        stream.set_read_timeout(Some(Duration::from_millis(10)))?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        Ok(Self {
            stream,
            buffered: Vec::new(),
            call: None,
            cancel: None,
        })
    }
    pub fn local(&self) -> io::Result<Ipv4Addr> {
        match self.stream.local_addr()?.ip() {
            std::net::IpAddr::V4(ip) => Ok(ip),
            _ => Err(io::Error::other("IPv4 required")),
        }
    }
    pub fn set_cancellation(&mut self, cancel: std::sync::Arc<std::sync::atomic::AtomicBool>) {
        self.cancel = Some(cancel);
    }
    pub fn send(&mut self, kind: u16, body: &[u8]) -> io::Result<()> {
        self.stream.write_all(&frame(kind, body))
    }
    pub fn poll(&mut self) -> io::Result<Option<(u16, Vec<u8>)>> {
        if self
            .cancel
            .as_ref()
            .is_some_and(|cancel| cancel.load(std::sync::atomic::Ordering::Acquire))
        {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "PPTP connection cancelled",
            ));
        }
        if let Some(message) = extract(&mut self.buffered)? {
            return Ok(Some(message));
        }
        // Control traffic is usually idle. Never spend its read timeout before
        // receiving the next GRE packet. This socket has exactly one reader.
        if !read_ready(&self.stream)? {
            return Ok(None);
        }
        let mut bytes = [0u8; 512];
        match self.stream.read(&mut bytes) {
            Ok(0) => return Err(io::Error::other("PPTP control connection closed")),
            Ok(n) => {
                self.buffered.extend_from_slice(&bytes[..n]);
            }
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                return Ok(None);
            }
            Err(e) => return Err(e),
        }
        extract(&mut self.buffered)
    }
    pub fn wait(&mut self, wanted: u16) -> io::Result<Vec<u8>> {
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if let Some((kind, body)) = self.poll()? {
                if kind == wanted {
                    return Ok(body);
                }
                self.service(kind, &body)?;
            } else {
                // Setup waits have no GRE receive to pace an idle poll loop.
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        Err(io::Error::other("PPTP control reply deadline exceeded"))
    }
    pub fn service(&mut self, kind: u16, body: &[u8]) -> io::Result<()> {
        match kind {
            5 if body.len() == 4 => {
                let mut reply = body.to_vec();
                reply.extend_from_slice(&[1, 0, 0, 0]);
                self.send(6, &reply)?;
            }
            3 | 12 | 13 => {
                return Err(io::Error::other(
                    "server terminated PPTP call/control connection",
                ));
            }
            _ => {}
        }
        Ok(())
    }
    pub fn start(&mut self, call: u16) -> io::Result<u16> {
        let mut body = vec![0u8; 144];
        body[..2].copy_from_slice(&0x100u16.to_be_bytes());
        body[4..8].copy_from_slice(&3u32.to_be_bytes());
        body[8..12].copy_from_slice(&3u32.to_be_bytes());
        body[12..14].copy_from_slice(&1u16.to_be_bytes());
        body[16..22].copy_from_slice(b"Conxol");
        body[80..92].copy_from_slice(b"Native probe");
        self.send(1, &body)?;
        let reply = self.wait(2)?;
        if reply.len() != 144 || reply[..2] != [1, 0] || reply[2] != 1 {
            return Err(io::Error::other(
                "server rejected PPTP start-control request",
            ));
        }
        println!("PASS: PPTP control connection established.");
        let mut body = vec![0u8; 156];
        body[..2].copy_from_slice(&call.to_be_bytes());
        body[2..4].copy_from_slice(&1u16.to_be_bytes());
        body[4..8].copy_from_slice(&2400u32.to_be_bytes());
        body[8..12].copy_from_slice(&100_000_000u32.to_be_bytes());
        body[12..16].copy_from_slice(&3u32.to_be_bytes());
        body[16..20].copy_from_slice(&3u32.to_be_bytes());
        body[20..22].copy_from_slice(&64u16.to_be_bytes());
        self.send(7, &body)?;
        self.call = Some(call);
        let reply = self.wait(8)?;
        if reply.len() != 20 || reply[2..4] != call.to_be_bytes() || reply[4] != 1 {
            return Err(io::Error::other("server rejected PPTP outgoing call"));
        }
        let peer = u16::from_be_bytes(reply[..2].try_into().unwrap());
        let mut link = peer.to_be_bytes().to_vec();
        link.extend_from_slice(&[0, 0]);
        link.extend_from_slice(&[0xff; 8]);
        self.send(15, &link)?;
        println!("PASS: PPTP outgoing call accepted.");
        Ok(peer)
    }
}

#[cfg(windows)]
fn read_ready(stream: &TcpStream) -> io::Result<bool> {
    use std::os::windows::io::AsRawSocket;
    use windows_sys::Win32::Networking::WinSock::{
        POLLRDNORM, SOCKET_ERROR, WSAGetLastError, WSAPOLLFD, WSAPoll,
    };
    let mut fd = WSAPOLLFD {
        fd: stream.as_raw_socket() as usize,
        events: POLLRDNORM,
        revents: 0,
    };
    // SAFETY: one initialized descriptor for a live, exclusively read socket.
    // A zero timeout checks readiness without delaying GRE processing.
    if unsafe { WSAPoll(&mut fd, 1, 0) } == SOCKET_ERROR {
        return Err(io::Error::from_raw_os_error(unsafe { WSAGetLastError() }));
    }
    // Read on hangup/error too, so EOF and socket errors reach the caller.
    Ok(fd.revents != 0)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn read_ready(stream: &TcpStream) -> io::Result<bool> {
    use std::os::fd::AsRawFd;
    let mut fd = libc::pollfd {
        fd: stream.as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    // SAFETY: one initialized descriptor for a live, exclusively read socket.
    if unsafe { libc::poll(&mut fd, 1, 0) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(fd.revents != 0)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn read_ready(_: &TcpStream) -> io::Result<bool> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "native PPTP control is unavailable on this platform",
    ))
}

impl Drop for Control {
    fn drop(&mut self) {
        if let Some(call) = self.call {
            let mut body = call.to_be_bytes().to_vec();
            body.extend_from_slice(&[0, 0]);
            let _ = self.send(12, &body);
        }
        let _ = self.send(3, &[1, 0, 0, 0]);
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
    }
}
fn extract(buffer: &mut Vec<u8>) -> io::Result<Option<(u16, Vec<u8>)>> {
    if buffer.len() < 12 {
        return Ok(None);
    }
    let len = u16::from_be_bytes(buffer[..2].try_into().unwrap()) as usize;
    if !(12..=512).contains(&len)
        || buffer[2..8] != [0, 1, 0x1a, 0x2b, 0x3c, 0x4d]
        || buffer[10..12] != [0, 0]
    {
        return Err(io::Error::other("invalid PPTP control frame"));
    }
    if buffer.len() < len {
        return Ok(None);
    }
    let kind = u16::from_be_bytes(buffer[8..10].try_into().unwrap());
    let body = buffer[12..len].to_vec();
    buffer.drain(..len);
    Ok(Some((kind, body)))
}
#[cfg(test)]
mod tests {
    use super::*;

    fn pair() -> (Control, TcpStream) {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(10)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let (peer, _) = listener.accept().unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        (
            Control {
                stream,
                buffered: Vec::new(),
                call: None,
                cancel: None,
            },
            peer,
        )
    }

    #[test]
    fn idle_control_polls_do_not_pay_the_read_timeout() {
        let (mut control, _peer) = pair();
        let start = Instant::now();
        for _ in 0..100 {
            assert!(control.poll().unwrap().is_none());
        }
        // The old path takes at least one second for these 100 idle polls.
        assert!(start.elapsed() < Duration::from_millis(250));
    }

    #[test]
    fn socket_control_frames_survive_fragmentation_and_service_echo() {
        let (mut control, mut peer) = pair();
        let echo = frame(5, &[1, 2, 3, 4]);
        peer.write_all(&echo[..7]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while control.buffered.is_empty() {
            assert!(control.poll().unwrap().is_none());
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        assert!(control.poll().unwrap().is_none());
        let mut tail = echo[7..].to_vec();
        tail.extend_from_slice(&frame(12, &[0, 1, 0, 0]));
        peer.write_all(&tail).unwrap();
        let body = control.wait(5).unwrap();
        control.service(5, &body).unwrap();
        let expected = frame(6, &[1, 2, 3, 4, 1, 0, 0, 0]);
        let mut reply = vec![0; expected.len()];
        peer.read_exact(&mut reply).unwrap();
        assert_eq!(reply, expected);
        let body = control.wait(12).unwrap();
        assert!(control.service(12, &body).is_err());
    }

    #[test]
    fn control_peer_shutdown_is_not_treated_as_idle() {
        let (mut control, peer) = pair();
        peer.shutdown(std::net::Shutdown::Both).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match control.poll() {
                Err(_) => break,
                Ok(None) => assert!(Instant::now() < deadline),
                Ok(Some(_)) => panic!("unexpected control message"),
            }
            std::thread::yield_now();
        }
    }
    #[test]
    fn cancellation_interrupts_control_before_socket_read() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_peer, _) = listener.accept().unwrap();
        let mut control = Control {
            stream,
            buffered: Vec::new(),
            call: None,
            cancel: Some(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(
                true,
            ))),
        };
        assert_eq!(
            control.poll().unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
    }
    #[test]
    fn fragmented_coalesced_and_invalid_control_frames() {
        let bytes = frame(5, &[1, 2, 3, 4]);
        let mut buffer = Vec::new();
        for b in &bytes[..15] {
            buffer.push(*b);
            assert!(extract(&mut buffer).unwrap().is_none());
        }
        buffer.push(bytes[15]);
        buffer.extend_from_slice(&bytes);
        assert_eq!(extract(&mut buffer).unwrap(), Some((5, vec![1, 2, 3, 4])));
        assert!(extract(&mut buffer).unwrap().is_some());
        assert!(buffer.is_empty());
        let mut bad = bytes;
        bad[4] = 0;
        assert!(extract(&mut bad).is_err());
    }
}
