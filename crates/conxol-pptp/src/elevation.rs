//! An app-session UAC socket broker in the same executable. It never receives VPN
//! credentials and never launches a shell, installs a service, or alters routes.
use crate::gre::{Gre, ProtocolInfo};
use std::{
    ffi::OsStr,
    fs::{File, OpenOptions},
    io,
    mem::{size_of, zeroed},
    net::{Ipv4Addr, UdpSocket},
    os::windows::{
        ffi::OsStrExt,
        fs::OpenOptionsExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::PathBuf,
    ptr::{null, null_mut},
    sync::{
        Arc, Mutex, OnceLock, TryLockError,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{
        ERROR_CANCELLED, ERROR_NO_DATA, ERROR_PIPE_CONNECTED, ERROR_PIPE_LISTENING, GetLastError,
        HANDLE, INVALID_HANDLE_VALUE, LocalFree, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Security::{
        Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW, SECURITY_ATTRIBUTES,
    },
    Storage::FileSystem::{
        FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX, ReadFile, SECURITY_IDENTIFICATION,
        SECURITY_SQOS_PRESENT, WriteFile,
    },
    System::{
        Pipes::{
            ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeClientProcessId,
            GetNamedPipeServerProcessId, PIPE_NOWAIT, PIPE_REJECT_REMOTE_CLIENTS,
            SetNamedPipeHandleState,
        },
        Threading::{
            GetProcessId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
            QueryFullProcessImageNameW, WaitForSingleObject,
        },
    },
    UI::Shell::{
        SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
        ShellExecuteExW,
    },
};
const SWITCH: &str = "--conxol-gre-broker";
const PREFIX: &str = "conxol-gre-";
const MAGIC: &[u8; 8] = b"CXGRE002";
fn wide(text: impl AsRef<OsStr>) -> Vec<u16> {
    text.as_ref().encode_wide().chain(Some(0)).collect()
}
fn failure(message: &str) -> io::Error {
    io::Error::other(message)
}
struct Handle(OwnedHandle);
impl Handle {
    fn new(handle: HANDLE) -> Self {
        Self(unsafe { OwnedHandle::from_raw_handle(handle) })
    }
    fn raw(&self) -> HANDLE {
        self.0.as_raw_handle()
    }
}
struct Descriptor(*mut std::ffi::c_void);
impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}
struct Pipe {
    file: File,
    deadline: Option<Instant>,
    cancel: Arc<AtomicBool>,
    parent: Option<Handle>,
}
impl Pipe {
    fn check(&self) -> io::Result<()> {
        if self.cancel.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "PPTP elevation cancelled",
            ));
        }
        if self
            .parent
            .as_ref()
            .is_some_and(|parent| unsafe { WaitForSingleObject(parent.raw(), 0) } == WAIT_OBJECT_0)
        {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "Conxol parent process exited",
            ));
        }
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "PPTP elevation helper timed out",
            ));
        }
        Ok(())
    }
    fn handle(&self) -> HANDLE {
        self.file.as_raw_handle()
    }
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<()> {
        let mut pos = 0;
        while pos < bytes.len() {
            self.check()?;
            let mut count = 0;
            let ok = unsafe {
                ReadFile(
                    self.handle(),
                    bytes[pos..].as_mut_ptr(),
                    (bytes.len() - pos) as u32,
                    &mut count,
                    null_mut(),
                )
            };
            if ok == 0 {
                let error = unsafe { GetLastError() };
                if error != ERROR_NO_DATA {
                    return Err(io::Error::from_raw_os_error(error as i32));
                }
            }
            if count == 0 {
                std::thread::sleep(Duration::from_millis(if self.deadline.is_none() {
                    100
                } else {
                    5
                }));
            } else {
                pos += count as usize;
            }
        }
        Ok(())
    }
    fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        let mut pos = 0;
        while pos < bytes.len() {
            self.check()?;
            let mut count = 0;
            let ok = unsafe {
                WriteFile(
                    self.handle(),
                    bytes[pos..].as_ptr(),
                    (bytes.len() - pos) as u32,
                    &mut count,
                    null_mut(),
                )
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            if count == 0 {
                std::thread::sleep(Duration::from_millis(5));
            } else {
                pos += count as usize;
            }
        }
        Ok(())
    }
}
fn pipe_pid(name: &str) -> io::Result<u32> {
    let rest = name
        .strip_prefix(PREFIX)
        .ok_or_else(|| failure("invalid PPTP broker pipe"))?;
    let (pid, nonce) = rest
        .split_once('-')
        .ok_or_else(|| failure("invalid PPTP broker pipe"))?;
    if pid.len() > 10
        || !pid.bytes().all(|b| b.is_ascii_digit())
        || nonce.len() != 32
        || !nonce.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(failure("invalid PPTP broker pipe"));
    }
    let pid = pid
        .parse::<u32>()
        .map_err(|_| failure("invalid PPTP parent process"))?;
    if pid == 0 {
        return Err(failure("invalid PPTP parent process"));
    }
    Ok(pid)
}
fn create_pipe(name: &str, cancel: Arc<AtomicBool>) -> io::Result<Pipe> {
    // Only the owner, Administrators and SYSTEM; no Everyone/Authenticated Users.
    let sddl = wide("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;OW)");
    let mut descriptor = null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            null_mut(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let descriptor = Descriptor(descriptor);
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: 0,
    };
    let name = wide(format!(r"\\.\pipe\{name}"));
    let handle = unsafe {
        CreateNamedPipeW(
            name.as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            4096,
            4096,
            0,
            &security,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: newly created handle has exactly one owner, this File.
    Ok(Pipe {
        file: unsafe { File::from_raw_handle(handle) },
        deadline: Some(Instant::now() + Duration::from_secs(30)),
        cancel,
        parent: None,
    })
}
fn launch(name: &str) -> io::Result<Handle> {
    let executable = wide(std::env::current_exe()?);
    let verb = wide("runas");
    let args = wide(format!("{SWITCH} {name}"));
    let mut info: SHELLEXECUTEINFOW = unsafe { zeroed() };
    info.cbSize = size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    info.lpFile = executable.as_ptr();
    info.lpVerb = verb.as_ptr();
    info.lpParameters = args.as_ptr();
    info.nShow = 0;
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let code = unsafe { GetLastError() };
        return Err(if code == ERROR_CANCELLED {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Administrator permission was declined. Retry Connect to request it again.",
            )
        } else {
            io::Error::from_raw_os_error(code as i32)
        });
    }
    if info.hProcess.is_null() {
        return Err(failure("Windows did not return the PPTP broker process"));
    }
    Ok(Handle::new(info.hProcess))
}
fn verify_image(pid: u32) -> io::Result<()> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return Err(io::Error::last_os_error());
    }
    let process = Handle::new(process);
    let mut path = vec![0u16; 32768];
    let mut len = path.len() as u32;
    if unsafe { QueryFullProcessImageNameW(process.raw(), 0, path.as_mut_ptr(), &mut len) } == 0 {
        return Err(io::Error::last_os_error());
    }
    use std::os::windows::ffi::OsStringExt;
    let actual = PathBuf::from(std::ffi::OsString::from_wide(&path[..len as usize]));
    let expected = std::env::current_exe()?;
    if !actual
        .as_os_str()
        .eq_ignore_ascii_case(expected.as_os_str())
    {
        return Err(failure("PPTP broker peer is not this Conxol executable"));
    }
    Ok(())
}
struct Broker {
    pipe: Pipe,
    helper: Handle,
}
enum Session {
    Empty,
    Ready(Broker),
    Failed,
    Stopped,
}
static SESSION: OnceLock<Mutex<Session>> = OnceLock::new();
fn session() -> &'static Mutex<Session> {
    SESSION.get_or_init(|| Mutex::new(Session::Empty))
}
fn start(cancel: Arc<AtomicBool>, approved: &mut bool) -> io::Result<Broker> {
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|_| failure("Could not prepare PPTP elevation request"))?;
    use std::fmt::Write;
    let mut hex = String::new();
    for byte in nonce {
        write!(&mut hex, "{byte:02x}").unwrap();
    }
    let name = format!("{PREFIX}{}-{hex}", std::process::id());
    let mut pipe = create_pipe(&name, cancel.clone())?;
    pipe.check()?;
    let helper = launch(&name)?;
    *approved = true;
    pipe.cancel = Arc::new(AtomicBool::new(false));
    // Give the helper its own deadline after the user has answered UAC.
    pipe.deadline = Some(Instant::now() + Duration::from_secs(30));
    loop {
        pipe.check()?;
        if unsafe { ConnectNamedPipe(pipe.handle(), null_mut()) } != 0 {
            break;
        }
        let error = unsafe { GetLastError() };
        if error == ERROR_PIPE_CONNECTED {
            break;
        }
        if error != ERROR_PIPE_LISTENING {
            return Err(io::Error::from_raw_os_error(error as i32));
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    let expected = unsafe { GetProcessId(helper.raw()) };
    let mut actual = 0;
    if expected == 0
        || unsafe { GetNamedPipeClientProcessId(pipe.handle(), &mut actual) } == 0
        || actual != expected
    {
        return Err(failure("PPTP elevation helper identity mismatch"));
    }
    verify_image(actual)?;
    // Authentication is complete. Keep this private channel open for the app
    // session; per-connection cancellation must not invalidate the shared pipe.
    pipe.cancel = Arc::new(AtomicBool::new(false));
    Ok(Broker { pipe, helper })
}
fn request(
    broker: &mut Broker,
    local: Ipv4Addr,
    remote: Ipv4Addr,
    call: u16,
) -> io::Result<io::Result<Gre>> {
    if unsafe { WaitForSingleObject(broker.helper.raw(), 0) } != WAIT_TIMEOUT {
        return Err(failure(
            "The elevated PPTP helper stopped. Restart Conxol to request permission again.",
        ));
    }
    let pipe = &mut broker.pipe;
    pipe.deadline = Some(Instant::now() + Duration::from_secs(30));
    let mut request = MAGIC.to_vec();
    request.extend_from_slice(&local.octets());
    request.extend_from_slice(&remote.octets());
    request.extend_from_slice(&call.to_be_bytes());
    pipe.check()?;
    // Finish consuming the process-specific socket capability even if Cancel
    // arrives during handoff, then immediately close it below. Before this
    // point cancellation can close the pipe without a duplicated socket.
    pipe.cancel = Arc::new(AtomicBool::new(false));
    pipe.write(&request)?;
    let mut header = [0u8; 12];
    pipe.read(&mut header)?;
    if &header[..8] != MAGIC {
        return Err(failure("Invalid PPTP elevation response"));
    }
    let result = i32::from_le_bytes(header[8..12].try_into().unwrap());
    if result != 0 {
        // A failed bind/socket request leaves the shared protocol synchronized.
        return Ok(Err(io::Error::from_raw_os_error(result)));
    }
    let mut info: ProtocolInfo = unsafe { zeroed() };
    // WSAPROTOCOL_INFOW contains only scalar fields/arrays, no pointers. Both
    // authenticated peers are the exact same executable and protocol version.
    let bytes = unsafe {
        std::slice::from_raw_parts_mut(
            (&mut info as *mut ProtocolInfo).cast::<u8>(),
            size_of::<ProtocolInfo>(),
        )
    };
    pipe.read(bytes)?;
    let gre = Gre::from_protocol_info(local, remote, call, &info)?;
    pipe.write(&[1])?;
    Ok(Ok(gre))
}

pub fn open_gre(
    local: Ipv4Addr,
    remote: Ipv4Addr,
    call: u16,
    cancel: Arc<AtomicBool>,
) -> io::Result<Gre> {
    if call == 0
        || local.is_unspecified()
        || local.is_multicast()
        || remote.is_unspecified()
        || remote.is_multicast()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid PPTP socket parameters",
        ));
    }
    let mut state = loop {
        if cancel.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "PPTP connection cancelled",
            ));
        }
        match session().try_lock() {
            Ok(state) => break state,
            Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(10)),
            Err(TryLockError::Poisoned(_)) => {
                return Err(failure("PPTP permission state is unavailable"));
            }
        }
    };
    if matches!(*state, Session::Empty) {
        // A declined prompt leaves Empty so a deliberate retry may ask again.
        let mut approved = false;
        let broker = match start(cancel.clone(), &mut approved) {
            Ok(broker) => broker,
            Err(error) => {
                if approved {
                    *state = Session::Failed;
                }
                return Err(error);
            }
        };
        *state = Session::Ready(broker);
    }
    if cancel.load(Ordering::Acquire) {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "PPTP connection cancelled",
        ));
    }
    let result = match &mut *state {
        Session::Ready(broker) => request(broker, local, remote, call),
        Session::Failed => {
            return Err(failure(
                "The elevated PPTP helper stopped. Restart Conxol to request permission again.",
            ));
        }
        Session::Stopped => return Err(failure("Conxol is shutting down")),
        Session::Empty => unreachable!(),
    };
    let gre = match result {
        Ok(socket) => socket?,
        Err(error) => {
            *state = Session::Failed;
            return Err(error);
        }
    };
    if cancel.load(Ordering::Acquire) {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "PPTP connection cancelled",
        ));
    }
    Ok(gre)
}

/// Diagnostic identity, used by the explicit loopback probe to verify reuse.
pub fn helper_process_id() -> Option<u32> {
    let state = session().lock().ok()?;
    match &*state {
        Session::Ready(broker) => Some(unsafe { GetProcessId(broker.helper.raw()) }),
        _ => None,
    }
}
/// Stop accepting socket requests and close the pipe. The elevated process
/// exits on EOF or parent death; it is never installed as a system service.
pub fn shutdown() -> io::Result<()> {
    let old = std::mem::replace(
        &mut *session()
            .lock()
            .map_err(|_| failure("PPTP permission state is unavailable"))?,
        Session::Stopped,
    );
    if let Session::Ready(Broker { pipe, helper }) = old {
        drop(pipe);
        if unsafe { WaitForSingleObject(helper.raw(), 2000) } != WAIT_OBJECT_0 {
            return Err(failure("PPTP helper did not exit after its session closed"));
        }
    }
    Ok(())
}

/// Return Some only for the broker entry point; it must run before Tauri opens
/// app data, webviews or the vault. Broker failures are exit codes, not logs.
pub fn broker_entry(args: &[String]) -> Option<i32> {
    if args.first().map(String::as_str) != Some(SWITCH) {
        return None;
    }
    Some(if args.len() == 2 && serve(&args[1]).is_ok() {
        0
    } else {
        1
    })
}
fn serve(name: &str) -> io::Result<()> {
    let expected = pipe_pid(name)?;
    // Initialize Winsock without reading any machine/user VPN configuration.
    let _winsock = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))?;
    let path = format!(r"\\.\pipe\{name}");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION)
        .open(path)?;
    let mut pipe = Pipe {
        file,
        deadline: Some(Instant::now() + Duration::from_secs(30)),
        cancel: Arc::new(AtomicBool::new(false)),
        parent: None,
    };
    let mode = PIPE_NOWAIT;
    if unsafe { SetNamedPipeHandleState(pipe.handle(), &mode, null(), null()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut actual = 0;
    if unsafe { GetNamedPipeServerProcessId(pipe.handle(), &mut actual) } == 0 || actual != expected
    {
        return Err(failure("Invalid PPTP broker parent"));
    }
    verify_image(actual)?;
    let parent = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            actual,
        )
    };
    if parent.is_null() {
        return Err(io::Error::last_os_error());
    }
    pipe.parent = Some(Handle::new(parent));
    loop {
        let mut bytes = [0u8; 18];
        // Idle for the lifetime of the parent, but bound every partial request.
        pipe.deadline = None;
        if let Err(error) = pipe.read(&mut bytes[..1]) {
            return if error.kind() == io::ErrorKind::BrokenPipe {
                Ok(())
            } else {
                Err(error)
            };
        }
        pipe.deadline = Some(Instant::now() + Duration::from_secs(30));
        pipe.read(&mut bytes[1..])?;
        if &bytes[..8] != MAGIC {
            return Err(failure("Invalid PPTP broker request"));
        }
        let local = Ipv4Addr::from(<[u8; 4]>::try_from(&bytes[8..12]).unwrap());
        let remote = Ipv4Addr::from(<[u8; 4]>::try_from(&bytes[12..16]).unwrap());
        let call = u16::from_be_bytes([bytes[16], bytes[17]]);
        if call == 0
            || local.is_unspecified()
            || local.is_multicast()
            || remote.is_unspecified()
            || remote.is_multicast()
        {
            return Err(failure("Invalid PPTP socket parameters"));
        }
        let outcome = Gre::open(local, remote, call).and_then(|socket| {
            socket
                .duplicate_for_process(actual)
                .map(|info| (socket, info))
        });
        match outcome {
            Ok((_socket, info)) => {
                let mut header = MAGIC.to_vec();
                header.extend_from_slice(&0i32.to_le_bytes());
                pipe.write(&header)?;
                let data = unsafe {
                    std::slice::from_raw_parts(
                        (&info as *const ProtocolInfo).cast::<u8>(),
                        size_of::<ProtocolInfo>(),
                    )
                };
                pipe.write(data)?;
                let mut ack = [0u8; 1];
                pipe.read(&mut ack)?;
                if ack != [1] {
                    return Err(failure("Invalid socket handoff acknowledgement"));
                }
            }
            Err(error) => {
                let mut header = MAGIC.to_vec();
                header.extend_from_slice(&error.raw_os_error().unwrap_or(10013).to_le_bytes());
                pipe.write(&header)?;
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn socket_rejections_keep_the_shared_channel_usable() {
        let name = format!(
            "{PREFIX}{}-{:032x}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let pipe = create_pipe(&name, Arc::new(AtomicBool::new(false))).unwrap();
        let child_name = name.clone();
        let peer = std::thread::spawn(move || {
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .custom_flags(SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION)
                .open(format!(r"\\.\pipe\{child_name}"))
                .unwrap();
            let mut peer = Pipe {
                file,
                deadline: Some(Instant::now() + Duration::from_secs(3)),
                cancel: Arc::new(AtomicBool::new(false)),
                parent: None,
            };
            let mode = PIPE_NOWAIT;
            assert_ne!(
                unsafe { SetNamedPipeHandleState(peer.handle(), &mode, null(), null()) },
                0
            );
            for _ in 0..2 {
                let mut frame = [0u8; 18];
                peer.read(&mut frame).unwrap();
                assert_eq!(&frame[..8], MAGIC);
                let mut response = MAGIC.to_vec();
                response.extend_from_slice(&10049i32.to_le_bytes());
                peer.write(&response).unwrap();
            }
        });
        loop {
            pipe.check().unwrap();
            if unsafe { ConnectNamedPipe(pipe.handle(), null_mut()) } != 0 {
                break;
            }
            let error = unsafe { GetLastError() };
            if error == ERROR_PIPE_CONNECTED {
                break;
            }
            assert_eq!(error, ERROR_PIPE_LISTENING);
            std::thread::sleep(Duration::from_millis(1));
        }
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                std::process::id(),
            )
        };
        assert!(!handle.is_null());
        let mut broker = Broker {
            pipe,
            helper: Handle::new(handle),
        };
        for call in [1, 2] {
            let outcome =
                request(&mut broker, Ipv4Addr::LOCALHOST, Ipv4Addr::LOCALHOST, call).unwrap();
            assert_eq!(outcome.err().unwrap().raw_os_error(), Some(10049));
        }
        drop(broker);
        peer.join().unwrap();
    }
    #[test]
    fn invalid_socket_request_never_launches_uac() {
        let error = open_gre(
            Ipv4Addr::UNSPECIFIED,
            Ipv4Addr::LOCALHOST,
            1,
            Arc::new(AtomicBool::new(false)),
        )
        .err()
        .unwrap();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }
    #[test]
    fn already_cancelled_request_never_launches_uac() {
        let error = open_gre(
            Ipv4Addr::LOCALHOST,
            Ipv4Addr::LOCALHOST,
            1,
            Arc::new(AtomicBool::new(true)),
        )
        .err()
        .unwrap();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    }
    #[test]
    fn validates_broker_pipe_names_and_exact_entry_arguments() {
        assert_eq!(
            pipe_pid("conxol-gre-42-0123456789abcdef0123456789abcdef").unwrap(),
            42
        );
        for name in [
            "other-42-0123456789abcdef0123456789abcdef",
            "conxol-gre-0-0123456789abcdef0123456789abcdef",
            "conxol-gre-42-short",
            r"conxol-gre-42-..\pipe\arbitrary",
        ] {
            assert!(pipe_pid(name).is_err());
        }
        assert_eq!(broker_entry(&[SWITCH.into()]), Some(1));
        assert_eq!(broker_entry(&["--other".into()]), None);
    }
}
