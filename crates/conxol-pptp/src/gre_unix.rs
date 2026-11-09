use super::{Address, Gre};
use std::{io, mem::{size_of, zeroed}, net::Ipv4Addr, os::fd::{AsRawFd, FromRawFd, OwnedFd}};

fn address(ip: Ipv4Addr) -> libc::sockaddr_in {
    // SAFETY: zero initializes sockaddr_in, including padding.
    let mut address: libc::sockaddr_in = unsafe { zeroed() };
    #[cfg(target_os = "macos")]
    { address.sin_len = size_of::<libc::sockaddr_in>() as u8; }
    address.sin_family = libc::AF_INET as _;
    address.sin_addr.s_addr = u32::from_ne_bytes(ip.octets());
    address
}

impl Gre {
    pub fn open(local: Ipv4Addr, remote: Ipv4Addr, call: u16) -> io::Result<Self> {
        // SAFETY: fixed IPv4 raw GRE socket, never IPPROTO_RAW or IP_HDRINCL.
        let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_RAW, 47) };
        if fd < 0 { return Err(io::Error::last_os_error()); }
        // SAFETY: newly created descriptor is exclusively owned.
        let socket = unsafe { OwnedFd::from_raw_fd(fd) };
        Self::from_socket(socket, local, remote, call)
    }

    pub(crate) fn from_socket(socket: OwnedFd, local: Ipv4Addr, remote: Ipv4Addr, call: u16) -> io::Result<Self> {
        let fd = socket.as_raw_fd();
        // SAFETY: live owned descriptor; preserve flags, prevent exec inheritance.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
            || unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let local_address = address(local);
        let remote_address = address(remote);
        // SAFETY: sockaddr_in pointers and lengths match live allocations. Binding
        // and connecting scope reception to the chosen interface address and peer.
        if unsafe { libc::bind(fd, (&local_address as *const libc::sockaddr_in).cast(), size_of::<libc::sockaddr_in>() as _) } < 0
            || unsafe { libc::connect(fd, (&remote_address as *const libc::sockaddr_in).cast(), size_of::<libc::sockaddr_in>() as _) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self { socket, remote: Address { family: 2, port: 0, ip: remote.octets(), padding: [0; 8] }, local, call, sequence: 0, received: None })
    }

    fn write(&self, bytes: &[u8]) -> io::Result<()> {
        // SAFETY: valid connected socket, immutable packet buffer.
        let n = unsafe { libc::send(self.socket.as_raw_fd(), bytes.as_ptr().cast(), bytes.len(), 0) };
        if n < 0 { return Err(io::Error::last_os_error()); }
        if n as usize != bytes.len() { return Err(io::Error::new(io::ErrorKind::WriteZero, "short GRE write")); }
        Ok(())
    }

    fn read(&self, buffer: &mut [u8]) -> io::Result<Option<usize>> {
        let mut poll = libc::pollfd { fd: self.socket.as_raw_fd(), events: libc::POLLIN, revents: 0 };
        // SAFETY: one valid pollfd, bounded wait keeps cancellation responsive.
        let ready = unsafe { libc::poll(&mut poll, 1, 10) };
        if ready < 0 {
            let e = io::Error::last_os_error();
            return if e.kind() == io::ErrorKind::Interrupted { Ok(None) } else { Err(e) };
        }
        if ready == 0 { return Ok(None); }
        // SAFETY: writable buffer and its precise length.
        let n = unsafe { libc::recv(self.socket.as_raw_fd(), buffer.as_mut_ptr().cast(), buffer.len(), 0) };
        if n < 0 {
            let e = io::Error::last_os_error();
            return if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted) { Ok(None) } else { Err(e) };
        }
        let n = n as usize;
        #[cfg(target_os = "macos")]
        if !normalize_darwin(&mut buffer[..n]) { return Ok(None); }
        Ok(Some(n))
    }
}

// XNU raw IPv4 input retains host-order payload length and fragment offset.
// Normalize only at the OS boundary; shared GRE validation uses wire format.
#[cfg(any(target_os = "macos", test))]
fn normalize_darwin(packet: &mut [u8]) -> bool {
    if packet.len() < 20 || packet[0] >> 4 != 4 { return false; }
    let header = usize::from(packet[0] & 15) * 4;
    let payload = usize::from(u16::from_ne_bytes([packet[2], packet[3]]));
    if header < 20 || header.checked_add(payload) != Some(packet.len()) || packet.len() > u16::MAX as usize { return false; }
    let length = packet.len() as u16;
    let fragments = u16::from_ne_bytes([packet[6], packet[7]]);
    packet[2..4].copy_from_slice(&length.to_be_bytes());
    packet[6..8].copy_from_slice(&fragments.to_be_bytes());
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn darwin_header_preserves_fragment_rejection_and_bounds() {
        let mut bytes = vec![0; 32];
        bytes[0] = 0x45;
        bytes[2..4].copy_from_slice(&12u16.to_ne_bytes());
        bytes[6..8].copy_from_slice(&0x2000u16.to_ne_bytes());
        assert!(normalize_darwin(&mut bytes));
        assert_eq!(&bytes[2..4], &32u16.to_be_bytes());
        assert_eq!(&bytes[6..8], &0x2000u16.to_be_bytes());
        assert!(!normalize_darwin(&mut bytes[..19]));
        bytes[2..4].copy_from_slice(&13u16.to_ne_bytes());
        assert!(!normalize_darwin(&mut bytes));
    }
}
