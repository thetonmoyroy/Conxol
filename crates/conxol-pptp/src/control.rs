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
