//! Privileged raw-GRE socket creation (session-scoped on macOS).
//! Authentication and protocol traffic stay in the unelevated app; only
//! descriptors cross a private Unix socket.
use crate::gre::Gre;
use std::{
    fs, io,
    io::{Read, Write},
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

fn context(operation: &'static str) -> impl FnOnce(io::Error) -> io::Error {
    move |error| io::Error::new(error.kind(), format!("{operation}: {error}"))
}

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

// Only this already-authenticated, close-on-exec channel can request more sockets.
// No persistent service, reconnect listener, credentials, or commands are exposed.
#[cfg(target_os = "macos")]
struct AuthorizedHelper {
    stream: UnixStream,
    child: Child,
}
#[cfg(target_os = "macos")]
impl Drop for AuthorizedHelper {
    fn drop(&mut self) {
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn open_gre(
    local: Ipv4Addr,
    remote: Ipv4Addr,
    call: u16,
    cancel: Arc<AtomicBool>,
) -> io::Result<Gre> {
    #[cfg(target_os = "macos")]
    {
        static HELPER: std::sync::Mutex<Option<AuthorizedHelper>> = std::sync::Mutex::new(None);
        let mut helper = loop {
            if cancel.load(Ordering::Acquire) {
                return Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "PPTP connection cancelled",
                ));
            }
            match HELPER.try_lock() {
                Ok(helper) => break helper,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                Err(_) => return Err(io::Error::other("PPTP helper state unavailable")),
            }
        };
        if let Some(active) = helper.as_mut() {
            let result = (|| {
                active
                    .stream
                    .write_all(&[3])
                    .map_err(context("request retained GRE socket"))?;
                let fd = receive_fd(&active.stream)
                    .map_err(context("receive retained GRE descriptor"))?;
                let gre = Gre::from_socket(fd, local, remote, call)
                    .map_err(context("configure retained GRE socket"))?;
                active
                    .stream
                    .write_all(&[2])
                    .map_err(context("acknowledge retained GRE descriptor"))?;
                Ok(gre)
            })();
            if result.is_err() {
                // Never retry a broken exchange on a desynchronized channel.
                *helper = None;
            }
            return result;
        }
        let (gre, stream, child) = open_new(local, remote, call, cancel)?;
        *helper = Some(AuthorizedHelper { stream, child });
        Ok(gre)
    }
    #[cfg(target_os = "linux")]
    {
        let (gre, _stream, mut child) = open_new(local, remote, call, cancel)?;
        let _ = child.kill();
        let _ = child.wait();
        Ok(gre)
    }
}

/// Darwin inherits O_NONBLOCK from a nonblocking Unix listener on accept.
/// Restore blocking mode before installing bounded I/O timeouts; otherwise a
/// retained channel's next recvmsg races the helper and returns EAGAIN.
fn configure_handoff(stream: &UnixStream) -> io::Result<()> {
    stream
        .set_nonblocking(false)
        .map_err(context("configure blocking handoff channel"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(context("configure handoff receive timeout"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(context("configure handoff send timeout"))?;
    Ok(())
}

fn open_new(
    local: Ipv4Addr,
    remote: Ipv4Addr,
    call: u16,
    cancel: Arc<AtomicBool>,
) -> io::Result<(Gre, UnixStream, Child)> {
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
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&directory)
        .map_err(context("create handoff directory"))?;
    let rendezvous = Rendezvous(directory);
    let path = rendezvous.0.join("socket");
    let listener = UnixListener::bind(&path).map_err(context("bind handoff listener"))?;
    listener
        .set_nonblocking(true)
        .map_err(context("configure handoff listener"))?;
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
                Ok((mut stream, _)) => {
                    if peer_uid(&stream).map_err(context("verify helper identity"))? != 0 {
                        return Err(io::Error::new(
                            io::ErrorKind::PermissionDenied,
                            "Unexpected GRE helper identity",
                        ));
                    }
                    configure_handoff(&stream)?;
                    let fd = receive_fd(&stream).map_err(context("receive GRE descriptor"))?;
                    let gre = Gre::from_socket(fd, local, remote, call)?;
                    stream
                        .write_all(&[2])
                        .map_err(context("acknowledge GRE descriptor"))?;
                    return Ok((gre, stream));
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(context("accept helper connection")(e)),
            }
            if child
                .try_wait()
                .map_err(context("check helper process"))?
                .is_some()
            {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "PPTP administrator permission was cancelled or unavailable",
                ));
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    })();
    match result {
        Ok((gre, stream)) => Ok((gre, stream, child)),
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        }
    }
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
    let mut stream = UnixStream::connect(path)?;
    if peer_uid(&stream)? != uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Unexpected application identity",
        ));
    }
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    serve_socket_requests(&mut stream, cfg!(target_os = "macos"), create_gre_socket)
}

fn create_gre_socket() -> io::Result<OwnedFd> {
    // SAFETY: the only privileged operation is creation of a raw GRE socket.
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
    // SAFETY: this exclusively owned socket must not leak into child processes.
    if unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(fd)
}

/// Poll for the single acknowledgement byte instead of changing SO_RCVTIMEO
/// between requests. Darwin rejects setsockopt after the client has closed,
/// even if its final acknowledgement is still queued.
fn read_acknowledgement(stream: &mut UnixStream, byte: &mut [u8; 1]) -> io::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "GRE acknowledgement timed out",
            ));
        }
        let mut descriptor = libc::pollfd {
            fd: stream.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: one initialized pollfd remains live throughout the call.
        let ready = unsafe { libc::poll(&mut descriptor, 1, remaining.as_millis().max(1) as i32) };
        if ready > 0 {
            return stream.read_exact(byte);
        }
        if ready < 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}

/// Fixed one-byte protocol. EOF ends retained authority. No paths, addresses,
/// passwords, or shell commands are accepted over this channel.
fn serve_socket_requests(
    stream: &mut UnixStream,
    retain: bool,
    mut create: impl FnMut() -> io::Result<OwnedFd>,
) -> io::Result<()> {
    loop {
        let fd = create()?;
        send_fd(stream, &fd)?;
        let mut acknowledgement = [0];
        read_acknowledgement(stream, &mut acknowledgement)?;
        if acknowledgement != [2] {
            return Err(io::Error::other("Invalid GRE handoff acknowledgement"));
        }
        drop(fd);
        if !retain {
            return Ok(());
        }
        // The app's close-on-exec socket closes on exit or crash. The helper
        // has no listener and exits on EOF, without installing a root service.
        let mut request = [0];
        match stream.read_exact(&mut request) {
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(error) => return Err(error),
            Ok(()) if request == [3] => {}
            Ok(()) => return Err(io::Error::other("Invalid GRE socket request")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Unix-pair fixtures exercise the retained macOS protocol without root,
    // raw sockets, network traffic, or an authorization prompt.
    fn fixture_helper() -> (UnixStream, std::thread::JoinHandle<io::Result<()>>) {
        let (mut server, client) = UnixStream::pair().unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        client
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let worker = std::thread::spawn(move || {
            serve_socket_requests(&mut server, true, || {
                let (fd, _peer) = UnixStream::pair()?;
                Ok(fd.into())
            })
        });
        (client, worker)
    }

    #[test]
    fn retained_helper_serves_repeated_requests_and_exits_on_eof() {
        let (mut client, worker) = fixture_helper();
        for index in 0..4 {
            if index > 0 {
                client.write_all(&[3]).unwrap();
            }
            receive_fd(&client).unwrap();
            client.write_all(&[2]).unwrap();
        }
        drop(client);
        worker.join().unwrap().unwrap();
    }

    #[test]
    fn inherited_nonblocking_channel_waits_for_delayed_reconnect_descriptors() {
        let (mut server, mut client) = UnixStream::pair().unwrap();
        // Explicitly simulate Darwin's accepted socket flags on every Unix OS.
        client.set_nonblocking(true).unwrap();
        configure_handoff(&client).unwrap();
        assert_eq!(
            unsafe { libc::fcntl(client.as_raw_fd(), libc::F_GETFL) } & libc::O_NONBLOCK,
            0
        );
        let worker = std::thread::spawn(move || {
            serve_socket_requests(&mut server, true, || {
                // Ensure recvmsg runs before each descriptor is ready, including
                // after disconnecting (dropping) each previous socket.
                std::thread::sleep(Duration::from_millis(30));
                let (fd, _peer) = UnixStream::pair()?;
                Ok(fd.into())
            })
        });
        for index in 0..4 {
            if index > 0 {
                client.write_all(&[3]).unwrap();
            }
            let fd = receive_fd(&client).expect("wait for delayed helper response");
            client.write_all(&[2]).unwrap();
            drop(fd);
        }
        drop(client);
        worker.join().unwrap().unwrap();
    }

    #[test]
    fn retained_helper_rejects_unknown_request_and_bad_acknowledgement() {
        for (ack, request) in [(2, 99), (99, 3)] {
            let (mut client, worker) = fixture_helper();
            receive_fd(&client).unwrap();
            client.write_all(&[ack]).unwrap();
            if ack == 2 {
                client.write_all(&[request]).unwrap();
            }
            assert!(worker.join().unwrap().is_err());
        }
    }

    #[test]
    fn retained_helper_exits_if_client_dies_before_acknowledgement() {
        let (client, worker) = fixture_helper();
        receive_fd(&client).unwrap();
        drop(client);
        assert!(worker.join().unwrap().is_err());
    }

    #[test]
    fn named_handoff_checks_identity_timeout_and_descriptor() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let directory = PathBuf::from(format!("/tmp/conxol-gre-{name}"));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&directory)
            .unwrap();
        let rendezvous = Rendezvous(directory);
        let path = rendezvous.0.join("socket");
        let listener = UnixListener::bind(&path).expect("bind listener");
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        let sender = UnixStream::connect(&path).expect("connect sender");
        let (receiver, _) = listener.accept().expect("accept sender");
        assert_eq!(peer_uid(&receiver).expect("sender credentials"), unsafe {
            libc::geteuid()
        });
        assert_eq!(peer_uid(&sender).expect("listener credentials"), unsafe {
            libc::geteuid()
        });
        receiver
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("receive timeout");
        let (data, _peer) = UnixStream::pair().unwrap();
        send_fd(&sender, &data.into()).expect("send descriptor");
        drop(sender);
        receive_fd(&receiver).expect("receive after helper exit");
    }

    #[test]
    #[ignore = "Child entry for the explicitly invoked sudo loopback fixture"]
    fn privileged_sender_child() {
        let Ok(path) = std::env::var("CONXOL_PPTP_FIXTURE_SOCKET") else {
            return;
        };
        let uid = std::env::var("CONXOL_PPTP_FIXTURE_UID").unwrap();
        helper(&[MODE.into(), path, uid]).expect("privileged GRE helper");
    }

    #[test]
    #[ignore = "Requires passwordless sudo; creates only a loopback GRE socket"]
    fn privileged_descriptor_handoff_to_unprivileged_app() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let directory = PathBuf::from(format!("/tmp/conxol-gre-{name}"));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&directory)
            .unwrap();
        let rendezvous = Rendezvous(directory);
        let path = rendezvous.0.join("socket");
        let listener = UnixListener::bind(&path).unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut child = Command::new("/usr/bin/sudo")
            .args(["-n", "/usr/bin/env"])
            .arg(format!("CONXOL_PPTP_FIXTURE_SOCKET={}", path.display()))
            .arg(format!("CONXOL_PPTP_FIXTURE_UID={}", unsafe {
                libc::geteuid()
            }))
            .arg(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "elevation::tests::privileged_sender_child",
                "--nocapture",
            ])
            .spawn()
            .unwrap();
        let result = (|| -> io::Result<()> {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        assert_eq!(peer_uid(&stream).expect("root peer identity"), 0);
                        stream
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .expect("timeout");
                        let fd = receive_fd(&stream).expect("receive root GRE descriptor");
                        Gre::from_socket(fd, Ipv4Addr::LOCALHOST, Ipv4Addr::LOCALHOST, 1)
                            .expect("configure transferred GRE socket");
                        stream.write_all(&[2]).expect("acknowledge handoff");
                        return Ok(());
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
                    Err(e) => return Err(e),
                }
                if Instant::now() >= deadline {
                    return Err(io::Error::other("fixture timed out"));
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        })();
        if result.is_err() {
            let _ = child.kill();
        }
        let exit = child.wait().unwrap();
        result.unwrap();
        assert!(exit.success());
    }

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
