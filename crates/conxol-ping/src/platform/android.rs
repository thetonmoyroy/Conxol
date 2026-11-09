use super::*;
use crate::android_packet::{self, ExtendedError};
use std::mem::{size_of, size_of_val, zeroed};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

pub(super) struct NativeProbe {
    payload_size: u16,
    sequence: u16,
}
impl NativeProbe {
    pub fn new(payload_size: u16) -> Result<Self, Error> {
        // Check access at start, before reporting a diagnostic as running.
        let _ = socket()?;
        Ok(Self {
            payload_size,
            sequence: rand::random(),
        })
    }
}

fn socket() -> Result<OwnedFd, Error> {
    // SAFETY: fixed IPv4 datagram ICMP socket. No raw-socket/root fallback.
    let fd = unsafe {
        libc::socket(
            libc::AF_INET,
            libc::SOCK_DGRAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
            libc::IPPROTO_ICMP,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error().into());
    }
    // SAFETY: newly created, exclusively owned descriptor.
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

fn option(fd: i32, name: i32, value: i32) -> Result<(), Error> {
    // SAFETY: live descriptor and correctly sized integer IP option.
    if unsafe {
        libc::setsockopt(
            fd,
            libc::IPPROTO_IP,
            name,
            (&value as *const i32).cast(),
            size_of::<i32>() as _,
        )
    } < 0
    {
        return Err(io::Error::last_os_error().into());
    }
    Ok(())
}
fn address(ip: Ipv4Addr) -> libc::sockaddr_in {
    // SAFETY: all-zero sockaddr_in is valid before assigning its fields.
    let mut address: libc::sockaddr_in = unsafe { zeroed() };
    address.sin_family = libc::AF_INET as _;
    address.sin_addr.s_addr = u32::from_ne_bytes(ip.octets());
    address
}
fn ipv4(address: &libc::sockaddr_in) -> Ipv4Addr {
    Ipv4Addr::from(address.sin_addr.s_addr.to_ne_bytes())
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
        // Each probe has its own kernel-selected echo identifier and error
        // queue: delayed errors from a previous TTL cannot poison this probe.
        let socket = socket()?;
        let fd = socket.as_raw_fd();
        option(fd, libc::IP_TTL, i32::from(ttl))?;
        option(fd, libc::IP_RECVERR, 1)?;
        let mut local = address(Ipv4Addr::UNSPECIFIED);
        // SAFETY: initialized sockaddr_in with port zero requests a unique
        // kernel ping identifier; this does not bind a listening service.
        if unsafe {
            libc::bind(
                fd,
                (&local as *const libc::sockaddr_in).cast(),
                size_of_val(&local) as _,
            )
        } < 0
        {
            return Err(io::Error::last_os_error().into());
        }
        let mut length = size_of_val(&local) as libc::socklen_t;
        // SAFETY: writable address and size for this descriptor.
        if unsafe {
            libc::getsockname(
                fd,
                (&mut local as *mut libc::sockaddr_in).cast(),
                &mut length,
            )
        } < 0
        {
            return Err(io::Error::last_os_error().into());
        }
        if length as usize != size_of_val(&local) || local.sin_family != libc::AF_INET as _ {
            return Err(io::Error::other("Invalid ICMP socket identity").into());
        }
        self.sequence = self.sequence.wrapping_add(1);
        let request = packet::echo_sized(
            u16::from_be(local.sin_port),
            self.sequence,
            rand::random(),
            self.payload_size,
        );
        let destination = address(target);
        let started = Instant::now();
        // SAFETY: valid live descriptor and initialized packet/address buffers.
        let sent = unsafe {
            libc::sendto(
                fd,
                request.as_ptr().cast(),
                request.len(),
                0,
                (&destination as *const libc::sockaddr_in).cast(),
                size_of_val(&destination) as _,
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
            // SAFETY: one initialized pollfd; at most 20 ms between cancels.
            let ready =
                unsafe { libc::poll(&mut poll, 1, remaining.as_millis().clamp(1, 20) as _) };
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
            if poll.revents & (libc::POLLHUP | libc::POLLNVAL) != 0 {
                return Err(io::Error::other("ICMP socket closed").into());
            }
            if poll.revents & libc::POLLERR != 0 {
                if let Some((address, kind)) = error_reply(fd, &mut buffer, target, &request)? {
                    return Ok(Some(Reply {
                        address,
                        kind,
                        latency: started.elapsed(),
                    }));
                }
                continue;
            }
            let mut source = address(Ipv4Addr::UNSPECIFIED);
            let mut length = size_of_val(&source) as libc::socklen_t;
            // SAFETY: bounded writable buffer and correctly sized sockaddr.
            let size = unsafe {
                libc::recvfrom(
                    fd,
                    buffer.as_mut_ptr().cast(),
                    buffer.len(),
                    libc::MSG_DONTWAIT,
                    (&mut source as *mut libc::sockaddr_in).cast(),
                    &mut length,
                )
            };
            if size < 0 {
                let error = io::Error::last_os_error();
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) {
                    continue;
                }
                if let Some((address, kind)) = error_reply(fd, &mut buffer, target, &request)? {
                    return Ok(Some(Reply {
                        address,
                        kind,
                        latency: started.elapsed(),
                    }));
                }
                return Err(error.into());
            }
            if length as usize == size_of_val(&source)
                && source.sin_family == libc::AF_INET as _
                && android_packet::echo_reply(
                    &buffer[..size as usize],
                    ipv4(&source),
                    target,
                    &request,
                )
            {
                return Ok(Some(Reply {
                    address: target,
                    kind: ReplyKind::Destination,
                    latency: started.elapsed(),
                }));
            }
        }
    }
}

fn error_reply(
    fd: i32,
    buffer: &mut [u8],
    target: Ipv4Addr,
    request: &[u8],
) -> Result<Option<(Ipv4Addr, ReplyKind)>, Error> {
    let mut destination = address(Ipv4Addr::UNSPECIFIED);
    let mut control = [0usize; 64]; // aligned storage for cmsghdr, bounded at 512 bytes on ARM64
    let mut iov = libc::iovec {
        iov_base: buffer.as_mut_ptr().cast(),
        iov_len: buffer.len(),
    };
    // SAFETY: zeroed msghdr is populated with valid owned writable buffers.
    let mut message: libc::msghdr = unsafe { zeroed() };
    message.msg_name = (&mut destination as *mut libc::sockaddr_in).cast();
    message.msg_namelen = size_of_val(&destination) as _;
    message.msg_iov = &mut iov;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = size_of_val(&control) as _;
    // SAFETY: all buffers outlive the nonblocking recvmsg call.
    let size = unsafe { libc::recvmsg(fd, &mut message, libc::MSG_ERRQUEUE | libc::MSG_DONTWAIT) };
    if size < 0 {
        let error = io::Error::last_os_error();
        if matches!(
            error.kind(),
            io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
        ) {
            return Ok(None);
        }
        return Err(error.into());
    }
    if message.msg_flags & (libc::MSG_CTRUNC | libc::MSG_TRUNC) != 0 {
        return Err(io::Error::other("Truncated ICMP error message").into());
    }
    let used = message.msg_controllen as usize;
    if used > size_of_val(&control) {
        return Err(io::Error::other("Invalid ICMP control length").into());
    }
    // SAFETY: recvmsg initialized `used` bytes inside the aligned control buffer.
    let bytes = unsafe { std::slice::from_raw_parts(control.as_ptr().cast::<u8>(), used) };
    let mut offset = 0;
    // SAFETY: CMSG_LEN(0) computes the native header size without dereferencing.
    let header_size = unsafe { libc::CMSG_LEN(0) } as usize;
    while offset + size_of::<libc::cmsghdr>() <= used {
        // SAFETY: header fits in initialized bytes. Read unaligned avoids any
        // dependency on packet-provided alignment; all lengths are checked.
        let header =
            unsafe { std::ptr::read_unaligned(bytes.as_ptr().add(offset).cast::<libc::cmsghdr>()) };
        let length = header.cmsg_len as usize;
        if length < header_size || length > used - offset {
            return Err(io::Error::other("Malformed ICMP ancillary message").into());
        }
        if header.cmsg_level == libc::IPPROTO_IP && header.cmsg_type == libc::IP_RECVERR {
            let data = &bytes[offset + header_size..offset + length];
            if let Some(error) = android_packet::extended_error(
                data,
                &buffer[..size as usize],
                ipv4(&destination),
                target,
                request,
            ) {
                return match error {
                    ExtendedError::Local(errno) => Err(io::Error::from_raw_os_error(errno).into()),
                    ExtendedError::Remote(address, kind) => Ok(Some((address, kind))),
                };
            }
        }
        let align = size_of::<usize>();
        offset += (length + align - 1) & !(align - 1);
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_error_queue_reports_loopback_unreachable() {
        // An OS-assigned, closed loopback UDP port generates an ICMP error
        // without probing an external host. Its payload is a synthetic probe,
        // exercising recvmsg/cmsg layout and SO_EE_OFFENDER on Android itself.
        let reservation = std::net::UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = reservation.local_addr().unwrap().port();
        // SAFETY: fixed IPv4 datagram socket; exclusively owned below.
        let fd = unsafe {
            libc::socket(
                libc::AF_INET,
                libc::SOCK_DGRAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
                libc::IPPROTO_UDP,
            )
        };
        assert!(fd >= 0);
        // SAFETY: fd was just successfully created.
        let socket = unsafe { OwnedFd::from_raw_fd(fd) };
        option(socket.as_raw_fd(), libc::IP_RECVERR, 1).unwrap();
        let mut destination = address(Ipv4Addr::LOCALHOST);
        destination.sin_port = port.to_be();
        let request = packet::echo_sized(123, 456, [7; 8], 32);
        drop(reservation);
        // SAFETY: valid live socket, packet and destination.
        let sent = unsafe {
            libc::sendto(
                fd,
                request.as_ptr().cast(),
                request.len(),
                0,
                (&destination as *const libc::sockaddr_in).cast(),
                size_of_val(&destination) as _,
            )
        };
        assert_eq!(sent as usize, request.len());
        let started = Instant::now();
        let mut buffer = [0; 1024];
        loop {
            if let Some(reply) =
                error_reply(fd, &mut buffer, Ipv4Addr::LOCALHOST, &request).unwrap()
            {
                assert_eq!(reply, (Ipv4Addr::LOCALHOST, ReplyKind::Unreachable));
                break;
            }
            assert!(started.elapsed() < Duration::from_secs(2));
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
