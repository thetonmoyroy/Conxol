use super::*;
use std::mem::{size_of, zeroed};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

pub(super) struct NativeProbe {
    socket: OwnedFd,
    identifier: u16,
    sequence: u16,
    nonce: [u8; 8],
    payload_size: u16,
}

impl NativeProbe {
    pub fn new(payload_size: u16) -> Result<Self, Error> {
        // SAFETY: constant domain/type/protocol. Datagram ICMP does not request
        // raw-socket privileges; no elevation or raw fallback is attempted.
        let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_DGRAM, libc::IPPROTO_ICMP) };
        if fd < 0 {
            return Err(io::Error::last_os_error().into());
        }
        // SAFETY: newly created descriptor is valid and exclusively owned.
        let socket = unsafe { OwnedFd::from_raw_fd(fd) };
        // SAFETY: operates on a live descriptor, preserving existing flags.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error().into());
        }
        // SAFETY: FD_CLOEXEC prevents descriptor inheritance; no pointer arguments.
        if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(Self {
            socket,
            identifier: rand::random(),
            sequence: 0,
            nonce: rand::random(),
            payload_size,
        })
    }
}

impl Probe for NativeProbe {
    fn probe(
        &mut self,
        target: Ipv4Addr,
        ttl: u8,
        timeout: Duration,
        cancel: &AtomicBool,
    ) -> Result<Option<Reply>, Error> {
        check_cancel(cancel)?;
        let fd = self.socket.as_raw_fd();
        let ttl = i32::from(ttl);
        // SAFETY: a correctly sized integer is provided for the IP_TTL option.
        if unsafe {
            libc::setsockopt(
                fd,
                libc::IPPROTO_IP,
                libc::IP_TTL,
                (&ttl as *const i32).cast(),
                size_of::<i32>() as libc::socklen_t,
            )
        } < 0
        {
            return Err(io::Error::last_os_error().into());
        }
        self.sequence = self.sequence.wrapping_add(1);
        // Rotate the identity at sequence wrap so old errors cannot match.
        if self.sequence == 0 {
            self.identifier = rand::random();
            self.nonce = rand::random();
        }
        let request = packet::echo_sized(
            self.identifier,
            self.sequence,
            self.nonce,
            self.payload_size,
        );
        // SAFETY: zero is a valid initialization for sockaddr_in; all required
        // macOS address fields are then assigned before passing it to sendto.
        let mut destination: libc::sockaddr_in = unsafe { zeroed() };
        destination.sin_len = size_of::<libc::sockaddr_in>() as u8;
        destination.sin_family = libc::AF_INET as u8;
        destination.sin_addr.s_addr = u32::from_ne_bytes(target.octets());
        let started = Instant::now();
        // SAFETY: descriptor, address and packet buffers are valid for this call.
        let sent = unsafe {
            libc::sendto(
                fd,
                request.as_ptr().cast(),
                request.len(),
                0,
                (&destination as *const libc::sockaddr_in).cast(),
                size_of::<libc::sockaddr_in>() as libc::socklen_t,
            )
        };
        if sent < 0 {
            return Err(io::Error::last_os_error().into());
        }
        if sent as usize != request.len() {
            return Err(io::Error::from(io::ErrorKind::WriteZero).into());
        }
        let mut buffer = [0u8; 65536];
        loop {
            check_cancel(cancel)?;
            let Some(remaining) = timeout.checked_sub(started.elapsed()) else {
                return Ok(None);
            };
            let mut poll = libc::pollfd {
                fd,
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: one initialized, writable pollfd; wait is at most 20 ms.
            let ready =
                unsafe { libc::poll(&mut poll, 1, remaining.as_millis().clamp(1, 20) as i32) };
            if ready < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error.into());
            }
            if ready == 0 {
                continue;
            }
            if poll.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
                return Err(io::Error::other("ICMP socket poll failed").into());
            }
            // SAFETY: buffer is writable and bounded; socket is nonblocking.
            let size = unsafe { libc::recv(fd, buffer.as_mut_ptr().cast(), buffer.len(), 0) };
            if size < 0 {
                let error = io::Error::last_os_error();
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) {
                    continue;
                }
                return Err(error.into());
            }
            if let Some((address, kind)) =
                packet::darwin_reply(&mut buffer[..size as usize], target, &request)
            {
                return Ok(Some(Reply {
                    address,
                    kind,
                    latency: started.elapsed(),
                }));
            }
        }
    }
}
