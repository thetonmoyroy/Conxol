use std::{io, mem::size_of, net::Ipv4Addr};

#[repr(C)]
struct Address {
    family: u16,
    port: u16,
    ip: [u8; 4],
    padding: [u8; 8],
}
#[link(name = "ws2_32")]
unsafe extern "system" {
    fn socket(af: i32, kind: i32, protocol: i32) -> usize;
    fn closesocket(s: usize) -> i32;
    fn bind(s: usize, address: *const Address, len: i32) -> i32;
    fn setsockopt(s: usize, level: i32, option: i32, value: *const u32, len: i32) -> i32;
    fn sendto(
        s: usize,
        bytes: *const u8,
        len: i32,
        flags: i32,
        address: *const Address,
        address_len: i32,
    ) -> i32;
    fn recv(s: usize, bytes: *mut u8, len: i32, flags: i32) -> i32;
    fn WSAGetLastError() -> i32;
}
fn error() -> io::Error {
    unsafe { io::Error::from_raw_os_error(WSAGetLastError()) }
}
pub struct Gre {
    socket: usize,
    remote: Address,
    local: Ipv4Addr,
    call: u16,
    sequence: u32,
    received: Option<u32>,
}
impl Drop for Gre {
    fn drop(&mut self) {
        unsafe {
            closesocket(self.socket);
        }
    }
}
impl Gre {
    pub fn open(local: Ipv4Addr, remote: Ipv4Addr, call: u16) -> io::Result<Self> {
        // Winsock is already initialized by the caller's TCP socket.
        let s = unsafe { socket(2, 3, 47) };
        if s == usize::MAX {
            return Err(error());
        }
        let gre = Self {
            socket: s,
            remote: Address {
                family: 2,
                port: 0,
                ip: remote.octets(),
                padding: [0; 8],
            },
            local,
            call,
            sequence: 0,
            received: None,
        };
        let address = Address {
            family: 2,
            port: 0,
            ip: local.octets(),
            padding: [0; 8],
        };
        // SAFETY: valid owned socket and sockaddr_in-compatible stack allocation.
        if unsafe { bind(s, &address, size_of::<Address>() as i32) } != 0 {
            return Err(error());
        }
        let ms = 10u32;
        if unsafe { setsockopt(s, 0xffff, 0x1006, &ms, 4) } != 0 {
            return Err(error());
        }
        Ok(gre)
    }
    pub fn send(&mut self, peer_call: u16, protocol: u16, payload: &[u8]) -> io::Result<()> {
        let mut ppp = vec![0xff, 3];
        ppp.extend_from_slice(&protocol.to_be_bytes());
        ppp.extend_from_slice(payload);
        let mut bytes = vec![
            0x30,
            if self.received.is_some() { 0x81 } else { 1 },
            0x88,
            0x0b,
        ];
        bytes.extend_from_slice(&(ppp.len() as u16).to_be_bytes());
        bytes.extend_from_slice(&peer_call.to_be_bytes());
        bytes.extend_from_slice(&self.sequence.to_be_bytes());
        if let Some(ack) = self.received {
            bytes.extend_from_slice(&ack.to_be_bytes());
        }
        bytes.extend_from_slice(&ppp);
        self.sequence = self.sequence.wrapping_add(1);
        self.write(&bytes)
    }
    fn write(&self, bytes: &[u8]) -> io::Result<()> {
        // SAFETY: buffers have the exact lengths supplied and live through the call.
        let n = unsafe {
            sendto(
                self.socket,
                bytes.as_ptr(),
                bytes.len() as i32,
                0,
                &self.remote,
                size_of::<Address>() as i32,
            )
        };
        if n == -1 {
            return Err(error());
        }
        if n as usize != bytes.len() {
            return Err(io::Error::other("short GRE write"));
        }
        Ok(())
    }
    pub fn receive(&mut self, peer_call: u16) -> io::Result<Option<Vec<u8>>> {
        let mut buffer = [0u8; 4096];
        // SAFETY: recv cannot write beyond the allocated buffer.
        let n = unsafe { recv(self.socket, buffer.as_mut_ptr(), buffer.len() as i32, 0) };
        if n == -1 {
            let e = error();
            if e.raw_os_error() == Some(10060) {
                return Ok(None);
            }
            return Err(e);
        }
        let Some((sequence, payload)) = parse(
            &buffer[..n as usize],
            self.remote.ip,
            self.local.octets(),
            self.call,
        ) else {
            return Ok(None);
        };
        if let Some(seq) = sequence {
            // ACK duplicates too, but never replay old PPP packets to the state machine.
            let fresh = self
                .received
                .is_none_or(|last| (seq.wrapping_sub(last) as i32) > 0);
            if fresh {
                self.received = Some(seq);
            }
            let mut ack = vec![0x20, 0x81, 0x88, 0x0b, 0, 0];
            ack.extend_from_slice(&peer_call.to_be_bytes());
            ack.extend_from_slice(&self.received.unwrap().to_be_bytes());
            self.write(&ack)?;
            if !fresh {
                return Ok(None);
            }
        }
        Ok(payload.map(Vec::from))
    }
}

fn parse(
    bytes: &[u8],
    remote: [u8; 4],
    local: [u8; 4],
    call: u16,
) -> Option<(Option<u32>, Option<&[u8]>)> {
    if bytes.len() < 20
        || bytes[0] >> 4 != 4
        || bytes[9] != 47
        || bytes[12..16] != remote
        || bytes[16..20] != local
    {
        return None;
    }
    let ip = (bytes[0] & 15) as usize * 4;
    let total = u16::from_be_bytes(bytes[2..4].try_into().ok()?) as usize;
    if ip < 20
        || total > bytes.len()
        || total < ip
        || u16::from_be_bytes(bytes[6..8].try_into().ok()?) & 0x3fff != 0
    {
        return None;
    }
    let gre = bytes.get(ip..total)?;
    if gre.len() < 8
        || gre[0] & !0x10 != 0x20
        || gre[1] & 0x7f != 1
        || gre[2..4] != [0x88, 0x0b]
        || u16::from_be_bytes(gre[6..8].try_into().ok()?) != call
    {
        return None;
    }
    let seq = if gre[0] & 0x10 != 0 {
        Some(u32::from_be_bytes(gre.get(8..12)?.try_into().ok()?))
    } else {
        None
    };
    let header = 8 + if seq.is_some() { 4 } else { 0 } + if gre[1] & 0x80 != 0 { 4 } else { 0 };
    let len = u16::from_be_bytes(gre[4..6].try_into().ok()?) as usize;
    if header + len != gre.len() || (len > 0 && seq.is_none()) {
        return None;
    }
    Some((
        seq,
        if len > 0 {
            Some(gre.get(header..)?)
        } else {
            None
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_truncated_spoofed_fragmented_gre() {
        let mut bytes = vec![0u8; 20];
        bytes[0] = 0x45;
        bytes[9] = 47;
        bytes[12..16].copy_from_slice(&[127, 0, 0, 1]);
        bytes[16..20].copy_from_slice(&[127, 0, 0, 1]);
        bytes.extend_from_slice(&[
            0x30, 1, 0x88, 0x0b, 0, 4, 0x12, 0x34, 0, 0, 0, 0, 0xff, 3, 0xc0, 0x21,
        ]);
        let len = bytes.len() as u16;
        bytes[2..4].copy_from_slice(&len.to_be_bytes());
        assert!(parse(&bytes, [127, 0, 0, 1], [127, 0, 0, 1], 0x1234).is_some());
        for i in 0..bytes.len() {
            assert!(parse(&bytes[..i], [127, 0, 0, 1], [127, 0, 0, 1], 0x1234).is_none());
        }
        assert!(parse(&bytes, [127, 0, 0, 2], [127, 0, 0, 1], 0x1234).is_none());
        bytes[6] = 0x20;
        assert!(parse(&bytes, [127, 0, 0, 1], [127, 0, 0, 1], 0x1234).is_none());
    }
}
