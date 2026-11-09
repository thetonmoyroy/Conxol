//! One-shot privileged raw-GRE socket creation. Authentication and all protocol
//! traffic stay in the unelevated app; only an FD crosses a private Unix socket.
use crate::gre::Gre;
use std::{
    fs, io,
    mem::{size_of, zeroed},
    net::Ipv4Addr,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::{
            fs::{DirBuilderExt, MetadataExt},
            net::{UnixListener, UnixStream},
        },
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

const MODE: &str = "--conxol-pptp-gre-unix";

struct Rendezvous(PathBuf);
impl Drop for Rendezvous {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.0.join("socket"));
        let _ = fs::remove_dir(&self.0);
    }
}

fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: getsockopt receives a correctly sized writable ucred.
        let mut cred: libc::ucred = unsafe { zeroed() };
        let mut len = size_of::<libc::ucred>() as libc::socklen_t;
        if unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut cred as *mut libc::ucred).cast(),
                &mut len,
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        if len as usize != size_of::<libc::ucred>() {
            return Err(io::Error::other("Invalid socket peer credentials"));
        }
        Ok(cred.uid)
    }
    #[cfg(target_os = "macos")]
    {
        let mut uid = 0;
        let mut gid = 0;
        // SAFETY: live Unix socket and writable UID/GID values.
        if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(uid)
    }
}

fn send_fd(stream: &UnixStream, fd: &OwnedFd) -> io::Result<()> {
    let mut byte = [1u8];
    let mut iov = libc::iovec {
        iov_base: byte.as_mut_ptr().cast(),
        iov_len: 1,
    };
    // usize storage supplies cmsghdr alignment on both Unix ABIs.
    let mut control = [0usize; 8];
    // SAFETY: zero is a valid empty msghdr.
    let mut msg: libc::msghdr = unsafe { zeroed() };
    msg.msg_iov = &mut iov;
    msg.msg_iovlen = 1;
    msg.msg_control = control.as_mut_ptr().cast();
    // SAFETY: one descriptor's ancillary storage fits the aligned array.
    msg.msg_controllen = unsafe { libc::CMSG_SPACE(size_of::<i32>() as _) } as _;
    // SAFETY: first header and data fall inside msg_control; exact payload size.
    unsafe {
        let header = libc::CMSG_FIRSTHDR(&msg);
        (*header).cmsg_level = libc::SOL_SOCKET;
        (*header).cmsg_type = libc::SCM_RIGHTS;
        (*header).cmsg_len = libc::CMSG_LEN(size_of::<i32>() as _) as _;
        std::ptr::write_unaligned(libc::CMSG_DATA(header).cast::<i32>(), fd.as_raw_fd());
        if libc::sendmsg(stream.as_raw_fd(), &msg, libc::MSG_NOSIGNAL) != 1 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

fn receive_fd(stream: &UnixStream) -> io::Result<OwnedFd> {
    let mut byte = [0u8];
    let mut iov = libc::iovec {
        iov_base: byte.as_mut_ptr().cast(),
        iov_len: 1,
    };
    let mut control = [0usize; 8];
    // SAFETY: writable buffers and matching lengths remain live through recvmsg.
    let mut msg: libc::msghdr = unsafe { zeroed() };
    msg.msg_iov = &mut iov;
    msg.msg_iovlen = 1;
    msg.msg_control = control.as_mut_ptr().cast();
    msg.msg_controllen = size_of_val(&control) as _;
    #[cfg(target_os = "linux")]
    let flags = libc::MSG_CMSG_CLOEXEC;
    #[cfg(target_os = "macos")]
    let flags = 0;
    let n = unsafe { libc::recvmsg(stream.as_raw_fd(), &mut msg, flags) };
    if n < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut descriptors = Vec::new();
    // SAFETY: CMSG traversal is bounded by recvmsg's initialized control length.
    unsafe {
        let mut header = libc::CMSG_FIRSTHDR(&msg);
        while !header.is_null() {
            if (*header).cmsg_level == libc::SOL_SOCKET && (*header).cmsg_type == libc::SCM_RIGHTS {
                let base = libc::CMSG_LEN(0) as usize;
                let len = (*header).cmsg_len as usize;
                if len >= base {
                    for index in 0..(len - base) / size_of::<i32>() {
                        let fd = std::ptr::read_unaligned(
                            libc::CMSG_DATA(header).cast::<i32>().add(index),
                        );
                        descriptors.push(OwnedFd::from_raw_fd(fd));
                    }
                }
            }
            header = libc::CMSG_NXTHDR(&msg, header);
        }
    }
    if n != 1 || byte[0] != 1 || msg.msg_flags & libc::MSG_CTRUNC != 0 || descriptors.len() != 1 {
        return Err(io::Error::other("Invalid GRE socket transfer"));
    }
    let fd = descriptors.pop().unwrap();
    // SAFETY: received descriptor is owned; never leak it to subsequent children.
    if unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(fd)
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn launch(path: &Path, uid: u32) -> io::Result<Child> {
    let executable = std::env::current_exe()?;
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("/usr/bin/pkexec");
        command
            .arg(executable)
            .arg(MODE)
            .arg(path)
            .arg(uid.to_string());
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let exe = executable
            .to_str()
            .ok_or_else(|| io::Error::other("Invalid application path"))?;
        let path = path
            .to_str()
            .ok_or_else(|| io::Error::other("Invalid socket path"))?;
        if exe.chars().any(char::is_control) || path.chars().any(char::is_control) {
            return Err(io::Error::other("Invalid permission request path"));
        }
        let shell = format!(
            "{} {} {} {}",
            shell_quote(exe),
            MODE,
            shell_quote(path),
            uid
        );
        // AppleScript string escaping is distinct from the shell quoting above.
        let script = format!(
            "do shell script \"{}\" with administrator privileges",
            shell.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let mut command = Command::new("/usr/bin/osascript");
        command.arg("-e").arg(script);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

pub fn open_gre(
    local: Ipv4Addr,
    remote: Ipv4Addr,
    call: u16,
    cancel: Arc<AtomicBool>,
) -> io::Result<Gre> {
    if cancel.load(Ordering::Acquire) {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "PPTP connection cancelled",
        ));
    }
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(io::Error::other)?;
    let name: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    // /tmp is shared by the GUI and elevated process (unlike macOS per-user TMPDIR).
    let directory = PathBuf::from(format!("/tmp/conxol-gre-{name}"));
    fs::DirBuilder::new().mode(0o700).create(&directory)?;
    let rendezvous = Rendezvous(directory);
    let path = rendezvous.0.join("socket");
    let listener = UnixListener::bind(&path)?;
    listener.set_nonblocking(true)?;
    // SAFETY: geteuid has no arguments or side effects.
    let uid = unsafe { libc::geteuid() };
    let mut child = launch(&path, uid).map_err(|_| io::Error::other("Could not request PPTP permission. Linux requires pkexec and a running polkit authentication agent; macOS requires administrator approval."))?;
    let deadline = Instant::now() + Duration::from_secs(90);
    let result = (|| {
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "PPTP connection cancelled",
                ));
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "PPTP permission request timed out",
                ));
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    if peer_uid(&stream)? != 0 {
                        return Err(io::Error::new(
                            io::ErrorKind::PermissionDenied,
                            "Unexpected GRE helper identity",
                        ));
                    }
                    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
                    let fd = receive_fd(&stream)?;
                    return Gre::from_socket(fd, local, remote, call);
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(e),
            }
            if child.try_wait()?.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "PPTP administrator permission was cancelled or unavailable",
                ));
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    })();
    let _ = child.kill();
    let _ = child.wait();
    result
}

/// Invoked before the GUI, logging, profiles or vault are initialized.
pub fn broker_entry(args: &[String]) -> Option<i32> {
    if args.first().map(String::as_str) != Some(MODE) {
        return None;
    }
    Some(if helper(args).is_ok() { 0 } else { 1 })
}

fn helper(args: &[String]) -> io::Result<()> {
    if args.len() != 3 || unsafe { libc::geteuid() } != 0 {
        return Err(io::Error::other("Invalid GRE helper invocation"));
    }
    let uid: u32 = args[2].parse().map_err(io::Error::other)?;
    let path = Path::new(&args[1]);
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Invalid helper path"))?;
    let name = parent
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if path.file_name().and_then(|s| s.to_str()) != Some("socket")
        || parent.parent() != Some(Path::new("/tmp"))
        || !name.starts_with("conxol-gre-")
        || name.len() != 43
        || !name[11..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(io::Error::other("Invalid helper path"));
    }
    let metadata = fs::symlink_metadata(parent)?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o777 != 0o700 {
        return Err(io::Error::other("Invalid helper directory"));
    }
    let stream = UnixStream::connect(path)?;
    if peer_uid(&stream)? != uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Unexpected application identity",
        ));
    }
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    // SAFETY: the only privileged operation is creation of one raw GRE socket.
    // It sends no packets; the normal app binds and connects the received FD.
    #[cfg(target_os = "linux")]
    let kind = libc::SOCK_RAW | libc::SOCK_CLOEXEC;
    #[cfg(target_os = "macos")]
    let kind = libc::SOCK_RAW;
    let fd = unsafe { libc::socket(libc::AF_INET, kind, 47) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: exclusive newly created descriptor, closed immediately after send.
    let fd = unsafe { OwnedFd::from_raw_fd(fd) };
    send_fd(&stream, &fd)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descriptor_round_trip_is_owned_and_cloexec() {
        let (sender, receiver) = UnixStream::pair().unwrap();
        let (data, mut peer) = UnixStream::pair().unwrap();
        let fd: OwnedFd = data.into();
        send_fd(&sender, &fd).unwrap();
        let received = receive_fd(&receiver).unwrap();
        drop(fd);
        assert_ne!(
            unsafe { libc::fcntl(received.as_raw_fd(), libc::F_GETFD) } & libc::FD_CLOEXEC,
            0
        );
        use std::io::{Read, Write};
        let mut stream = UnixStream::from(received);
        peer.write_all(b"fixture").unwrap();
        let mut bytes = [0; 7];
        stream.read_exact(&mut bytes).unwrap();
        assert_eq!(&bytes, b"fixture");
    }
    #[test]
    fn rejects_missing_descriptor_and_invalid_invocation() {
        use std::io::Write;
        let (mut sender, receiver) = UnixStream::pair().unwrap();
        sender.write_all(&[1]).unwrap();
        assert!(receive_fd(&receiver).is_err());
        assert_eq!(broker_entry(&[MODE.into()]), Some(1));
        assert_eq!(broker_entry(&[]), None);
    }
    #[test]
    fn cancellation_never_launches_permission_prompt() {
        assert!(
            open_gre(
                Ipv4Addr::LOCALHOST,
                Ipv4Addr::LOCALHOST,
                1,
                Arc::new(AtomicBool::new(true))
            )
            .is_err()
        );
    }
}
