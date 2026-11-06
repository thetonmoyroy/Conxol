//! Read-only TFTP server. Only an explicitly selected immutable snapshot is served.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Write},
    net::{IpAddr, SocketAddr, UdpSocket},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::State;
const MAX_FILE: u64 = 1024 * 1024 * 1024;
const MAX_BLOCK: usize = 1468;
const RETRY: Duration = Duration::from_secs(2);
const MAX_ATTEMPTS: usize = 6;
const DEADLINE: Duration = Duration::from_secs(1800);
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    running: bool,
    bind_address: String,
    file_name: String,
    file_size: u64,
    active_transfers: usize,
    completed_transfers: u64,
    bytes_sent: u64,
    message: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerRequest {
    local_path: PathBuf,
    bind_address: IpAddr,
    port: u16,
    allowed_client: Option<IpAddr>,
    allow_unencrypted: bool,
    #[serde(default)]
    compatibility: bool,
}
struct SharedFile {
    snapshot: Arc<tempfile::NamedTempFile>,
    name: String,
    size: u64,
}
struct Running {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
    status: Arc<Mutex<ServerStatus>>,
}
#[derive(Clone, Default)]
pub struct TftpServerManager(Arc<Mutex<Option<Running>>>);
impl TftpServerManager {
    fn status(&self) -> Result<ServerStatus, String> {
        let guard = self.0.lock().map_err(|_| "TFTP server unavailable.")?;
        if let Some(server) = guard.as_ref() {
            let mut status = server
                .status
                .lock()
                .map_err(|_| "TFTP status unavailable.")?
                .clone();
            status.running = !server.handle.is_finished();
            Ok(status)
        } else {
            Ok(ServerStatus::default())
        }
    }
    fn start(&self, request: ServerRequest) -> Result<ServerStatus, String> {
        if !request.allow_unencrypted {
            return Err("Confirm sharing this file over unencrypted TFTP.".into());
        }
        if request.port == 0 {
            return Err("Choose a listen port between 1 and 65535.".into());
        }
        if !request.local_path.is_absolute() {
            return Err("Choose a local file to share.".into());
        }
        let mut guard = self.0.lock().map_err(|_| "TFTP server unavailable.")?;
        if guard.is_some() {
            return Err("Stop the current TFTP server before starting another.".into());
        }
        let name = request
            .local_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("The selected filename is not supported.")?
            .to_owned();
        if !safe_name(&name) {
            return Err(
                "Choose a filename without path separators or control characters, up to 255 bytes."
                    .into(),
            );
        }
        let mut source =
            File::open(&request.local_path).map_err(|_| "Could not open the selected file.")?;
        let meta = source
            .metadata()
            .map_err(|_| "Could not inspect the selected file.")?;
        if !meta.is_file() || meta.len() > MAX_FILE {
            return Err("Choose a regular file up to 1 GiB.".into());
        }
        let mut snapshot =
            tempfile::NamedTempFile::new().map_err(|_| "Could not prepare the shared file.")?;
        let mut bytes = 0u64;
        let mut buffer = [0; 65536];
        loop {
            let count = source
                .read(&mut buffer)
                .map_err(|_| "Could not read the selected file.")?;
            if count == 0 {
                break;
            }
            bytes += count as u64;
            if bytes > MAX_FILE {
                return Err("Selected file exceeds 1 GiB.".into());
            }
            snapshot
                .write_all(&buffer[..count])
                .map_err(|_| "Could not prepare the shared file.")?;
        }
        snapshot
            .flush()
            .map_err(|_| "Could not prepare the shared file.")?;
        let socket = UdpSocket::bind(SocketAddr::new(request.bind_address, request.port)).map_err(|_| "Could not bind TFTP. The address may be unavailable or the port already used; low ports may require permission.")?;
        self.start_bound(
            &mut guard,
            socket,
            SharedFile {
                snapshot: Arc::new(snapshot),
                name,
                size: bytes,
            },
            request.allowed_client,
            request.compatibility,
        )
    }
    fn start_bound(
        &self,
        guard: &mut Option<Running>,
        socket: UdpSocket,
        shared: SharedFile,
        allowed: Option<IpAddr>,
        compatibility: bool,
    ) -> Result<ServerStatus, String> {
        let SharedFile {
            snapshot: file,
            name,
            size,
        } = shared;
        socket
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|_| "Could not configure server socket.")?;
        let bind = socket
            .local_addr()
            .map_err(|_| "Could not read listen address.")?;
        let initial = ServerStatus {
            running: true,
            bind_address: bind.to_string(),
            file_name: name.clone(),
            file_size: size,
            message: "Waiting for a device to request the file.".into(),
            ..Default::default()
        };
        let status = Arc::new(Mutex::new(initial.clone()));
        let state = Arc::clone(&status);
        let stop = Arc::new(AtomicBool::new(false));
        let cancelled = Arc::clone(&stop);
        let handle = thread::Builder::new()
            .name("tftp-listener".into())
            .spawn(move || {
                let mut workers: HashMap<SocketAddr, JoinHandle<()>> = HashMap::new();
                let mut packet = [0; 4097];
                while !cancelled.load(Ordering::Acquire) {
                    let done: Vec<_> = workers
                        .iter()
                        .filter_map(|(peer, handle)| handle.is_finished().then_some(*peer))
                        .collect();
                    for peer in done {
                        if let Some(handle) = workers.remove(&peer) {
                            let _ = handle.join();
                        }
                    }
                    let (len, peer) = match socket.recv_from(&mut packet) {
                        Ok(value) => value,
                        Err(e)
                            if matches!(
                                e.kind(),
                                std::io::ErrorKind::WouldBlock
                                    | std::io::ErrorKind::TimedOut
                                    | std::io::ErrorKind::ConnectionReset
                            ) =>
                        {
                            continue;
                        }
                        Err(_) => {
                            if let Ok(mut s) = state.lock() {
                                s.message = "TFTP listener stopped after a socket error.".into();
                            }
                            break;
                        }
                    };
                    // A worker can finish while recv_from blocks. Reap again before
                    // classifying a fresh request from the same client as a duplicate.
                    let done: Vec<_> = workers
                        .iter()
                        .filter_map(|(peer, handle)| handle.is_finished().then_some(*peer))
                        .collect();
                    for peer in done {
                        if let Some(handle) = workers.remove(&peer) {
                            let _ = handle.join();
                        }
                    }
                    if allowed.is_some_and(|ip| ip != peer.ip()) {
                        continue;
                    }
                    if workers.contains_key(&peer) {
                        continue;
                    } // Existing worker retransmits from its own transfer port.
                    if workers.len() >= 2 {
                        send_error(&socket, peer, 0, "Server busy");
                        continue;
                    }
                    let options = match parse_request(&packet[..len], &name, size, compatibility) {
                        Ok(options) => options,
                        Err((code, reason)) => {
                            send_error(&socket, peer, code, reason);
                            continue;
                        }
                    };
                    let file = Arc::clone(&file);
                    let stopped = Arc::clone(&cancelled);
                    let stats = Arc::clone(&state);
                    if let Ok(mut s) = state.lock() {
                        s.active_transfers += 1;
                        s.message = "Serving the selected file.".into();
                    }
                    match thread::Builder::new()
                        .name("tftp-transfer".into())
                        .spawn(move || {
                            let result =
                                serve(file.path(), bind.ip(), peer, options, &stopped, &stats);
                            if let Ok(mut s) = stats.lock() {
                                s.active_transfers = s.active_transfers.saturating_sub(1);
                                match result {
                                    Ok(()) => {
                                        s.completed_transfers += 1;
                                        s.message = "Transfer completed.".into();
                                    }
                                    Err(reason) => s.message = reason.into(),
                                }
                            }
                        }) {
                        Ok(handle) => {
                            workers.insert(peer, handle);
                        }
                        Err(_) => {
                            if let Ok(mut s) = state.lock() {
                                s.active_transfers = s.active_transfers.saturating_sub(1);
                                s.message = "Could not start a transfer worker.".into();
                            }
                        }
                    }
                }
                cancelled.store(true, Ordering::Release);
                for (_, handle) in workers {
                    let _ = handle.join();
                }
                if let Ok(mut s) = state.lock() {
                    s.running = false;
                }
            })
            .map_err(|_| "Could not start the TFTP listener.")?;
        *guard = Some(Running {
            stop,
            handle,
            status,
        });
        Ok(initial)
    }
    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|_| "TFTP server unavailable.")?;
        if let Some(server) = guard.take() {
            server.stop.store(true, Ordering::Release);
            let _ = server.handle.join();
        }
        Ok(())
    }
    pub async fn shutdown(&self) {
        let server = self.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || server.stop()).await;
    }
}
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':'])
        && !name.chars().any(char::is_control)
}
fn send_error(socket: &UdpSocket, peer: SocketAddr, code: u16, text: &str) {
    let mut packet = vec![0, 5, (code >> 8) as u8, code as u8];
    packet.extend_from_slice(text.as_bytes());
    packet.push(0);
    let _ = socket.send_to(&packet, peer);
}
struct Options {
    block: usize,
    timeout: Duration,
    acknowledgement: Vec<u8>,
}
fn parse_request(
    packet: &[u8],
    file_name: &str,
    size: u64,
    compatibility: bool,
) -> Result<Options, (u16, &'static str)> {
    if packet.len() > 4096 || packet.len() < 4 || !packet.ends_with(&[0]) {
        return Err((4, "Invalid request"));
    }
    if packet[..2] != [0, 1] {
        return Err((2, "Read-only server"));
    }
    let fields: Vec<_> = packet[2..packet.len() - 1].split(|b| *b == 0).collect();
    if fields.len() < 2 || fields.len() % 2 != 0 {
        return Err((4, "Invalid request"));
    }
    let name = std::str::from_utf8(fields[0]).map_err(|_| (2, "Filename denied"))?;
    if !safe_name(name) || name != file_name {
        return Err((1, "File not shared"));
    }
    if !fields[1].eq_ignore_ascii_case(b"octet") {
        return Err((4, "Use binary octet mode"));
    }
    let mut result = Options {
        block: 512,
        timeout: RETRY,
        acknowledgement: vec![0, 6],
    };
    let mut used = Vec::<String>::new();
    for pair in fields[2..].chunks_exact(2) {
        let key = std::str::from_utf8(pair[0])
            .map_err(|_| (8, "Invalid option"))?
            .to_ascii_lowercase();
        let value = std::str::from_utf8(pair[1]).map_err(|_| (8, "Invalid option"))?;
        if used.contains(&key) {
            return Err((8, "Duplicate option"));
        }
        used.push(key.clone());
        if compatibility {
            continue;
        }
        let accepted = match key.as_str() {
            "blksize" => {
                let block: usize = value.parse().map_err(|_| (8, "Invalid block size"))?;
                if !(8..=65464).contains(&block) {
                    return Err((8, "Invalid block size"));
                }
                result.block = block.min(MAX_BLOCK);
                Some(result.block.to_string())
            }
            "tsize" => {
                if value != "0" {
                    return Err((8, "Read size must be zero"));
                }
                // Omit the optional size for empty files: some clients reject tsize=0.
                (size > 0).then(|| size.to_string())
            }
            "timeout" => {
                let seconds: u64 = value.parse().map_err(|_| (8, "Invalid timeout"))?;
                if !(1..=255).contains(&seconds) {
                    return Err((8, "Invalid timeout"));
                }
                if seconds <= 5 {
                    result.timeout = Duration::from_secs(seconds);
                    Some(seconds.to_string())
                } else {
                    None
                }
            }
            _ => None,
        };
        if let Some(value) = accepted {
            result.acknowledgement.extend_from_slice(key.as_bytes());
            result.acknowledgement.push(0);
            result.acknowledgement.extend_from_slice(value.as_bytes());
            result.acknowledgement.push(0);
        }
    }
    if result.acknowledgement.len() == 2 {
        result.acknowledgement.clear();
    }
    Ok(result)
}
fn exchange(
    socket: &UdpSocket,
    packet: &[u8],
    expected: u16,
    timeout: Duration,
    stop: &AtomicBool,
    deadline: Instant,
) -> Result<(), &'static str> {
    let mut response = [0u8; 2048];
    for _ in 0..MAX_ATTEMPTS {
        if stop.load(Ordering::Acquire) {
            return Err("Transfer stopped.");
        }
        if Instant::now() >= deadline {
            return Err("Transfer timed out.");
        }
        socket
            .send(packet)
            .map_err(|_| "Could not send file data.")?;
        let until = Instant::now() + timeout;
        while Instant::now() < until {
            if stop.load(Ordering::Acquire) {
                return Err("Transfer stopped.");
            }
            if Instant::now() >= deadline {
                return Err("Transfer timed out.");
            }
            match socket.recv(&mut response) {
                Ok(4)
                    if response[..2] == [0, 4]
                        && u16::from_be_bytes([response[2], response[3]]) == expected =>
                {
                    return Ok(());
                }
                Ok(n) if n >= 4 && response[..2] == [0, 5] => {
                    return Err("Device rejected the transfer.");
                }
                Ok(_) => {} // Duplicate/out-of-order ACKs do not trigger amplification.
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(_) => return Err("Device disconnected."),
            }
        }
    }
    Err("Device stopped acknowledging the file.")
}
fn serve(
    path: &Path,
    bind: IpAddr,
    peer: SocketAddr,
    options: Options,
    stop: &AtomicBool,
    status: &Mutex<ServerStatus>,
) -> Result<(), &'static str> {
    let socket =
        UdpSocket::bind(SocketAddr::new(bind, 0)).map_err(|_| "Could not open a transfer port.")?;
    socket
        .connect(peer)
        .map_err(|_| "Could not reach the device.")?;
    socket
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|_| "Could not configure a transfer port.")?;
    let deadline = Instant::now() + DEADLINE;
    if !options.acknowledgement.is_empty() {
        exchange(
            &socket,
            &options.acknowledgement,
            0,
            options.timeout,
            stop,
            deadline,
        )?;
    }
    let mut source = File::open(path).map_err(|_| "Shared file is unavailable.")?;
    let mut block = 1u16;
    let mut packet = vec![0u8; options.block + 4];
    loop {
        packet[1] = 3;
        packet[2..4].copy_from_slice(&block.to_be_bytes());
        let mut count = 0;
        while count < options.block {
            let read = source
                .read(&mut packet[4 + count..])
                .map_err(|_| "Could not read shared file.")?;
            if read == 0 {
                break;
            }
            count += read;
        }
        exchange(
            &socket,
            &packet[..count + 4],
            block,
            options.timeout,
            stop,
            deadline,
        )?;
        if let Ok(mut s) = status.lock() {
            s.bytes_sent = s.bytes_sent.saturating_add(count as u64);
        }
        if count < options.block {
            return Ok(());
        }
        block = block.wrapping_add(1); // Common interoperable rollover: 65535 -> 0 -> 1.
    }
}
#[tauri::command]
pub async fn tftp_server_status(
    manager: State<'_, TftpServerManager>,
) -> Result<ServerStatus, String> {
    let server = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || server.status())
        .await
        .map_err(|_| "Server status worker failed.".to_string())?
}
#[tauri::command]
pub async fn tftp_server_start(
    manager: State<'_, TftpServerManager>,
    request: ServerRequest,
) -> Result<ServerStatus, String> {
    let server = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || server.start(request))
        .await
        .map_err(|_| "Server worker failed.".to_string())?
}
#[tauri::command]
pub async fn tftp_server_stop(manager: State<'_, TftpServerManager>) -> Result<(), String> {
    let server = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || server.stop())
        .await
        .map_err(|_| "Server worker failed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    struct TestServer {
        manager: TftpServerManager,
        address: SocketAddr,
    }
    impl Drop for TestServer {
        fn drop(&mut self) {
            let _ = self.manager.stop();
        }
    }
    fn server(size: u64, compatibility: bool, allowed: Option<IpAddr>) -> TestServer {
        let file = tempfile::NamedTempFile::new().unwrap();
        file.as_file().set_len(size).unwrap();
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let address = socket.local_addr().unwrap();
        let manager = TftpServerManager::default();
        manager
            .start_bound(
                &mut manager.0.lock().unwrap(),
                socket,
                SharedFile {
                    snapshot: Arc::new(file),
                    name: "firmware.bin".into(),
                    size,
                },
                allowed,
                compatibility,
            )
            .unwrap();
        TestServer { manager, address }
    }
    fn request(name: &str, extra: &[u8]) -> Vec<u8> {
        let mut bytes = b"\0\x01".to_vec();
        bytes.extend_from_slice(name.as_bytes());
        bytes.extend_from_slice(b"\0octet\0");
        bytes.extend_from_slice(extra);
        bytes
    }
    fn curl_download(address: SocketAddr, path: &Path, options: bool) {
        #[cfg(windows)]
        let program =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
                .join("System32/curl.exe");
        #[cfg(not(windows))]
        let program = PathBuf::from("/usr/bin/curl");
        let mut command = Command::new(program);
        command
            .args([
                "--disable",
                "--silent",
                "--noproxy",
                "*",
                "--proto",
                "=tftp",
                "--connect-timeout",
                "3",
                "--max-time",
                "90",
                "--url",
            ])
            .arg(format!("tftp://{address}/firmware.bin"))
            .arg("--output")
            .arg(path)
            .stdin(Stdio::null())
            .stderr(Stdio::null());
        if options {
            command.args(["--tftp-blksize", "1468"]);
        } else {
            command.arg("--tftp-no-options");
        }
        assert!(
            command.status().unwrap().success(),
            "local curl TFTP fixture failed"
        );
    }
    fn wait_complete(server: &TestServer, expected: u64) {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let status = server.manager.status().unwrap();
            if status.completed_transfers == expected {
                break;
            }
            assert!(Instant::now() < deadline, "transfer did not complete");
            thread::sleep(Duration::from_millis(10));
        }
    }
    #[test]
    fn tftp_options_paths_and_read_only_validation() {
        for name in [
            "../secret",
            "a/b",
            "a\\b",
            "C:secret",
            "..",
            "",
            "other.bin",
        ] {
            assert!(parse_request(&request(name, b""), "firmware.bin", 100, false).is_err());
        }
        let mut write = request("firmware.bin", b"");
        write[1] = 2;
        assert_eq!(
            parse_request(&write, "firmware.bin", 100, false)
                .err()
                .unwrap()
                .0,
            2
        );
        let options = parse_request(
            &request(
                "firmware.bin",
                b"blksize\x0065464\0tsize\x000\0timeout\x001\0",
            ),
            "firmware.bin",
            123,
            false,
        )
        .unwrap();
        assert_eq!(options.block, MAX_BLOCK);
        assert_eq!(options.timeout, Duration::from_secs(1));
        assert!(
            options
                .acknowledgement
                .windows(10)
                .any(|w| w == b"tsize\x00123\0")
        );
        for extra in [
            b"blksize\x000\0".as_slice(),
            b"blksize\x001468\0blksize\x00512\0",
            b"timeout\x000\0",
            b"tsize\x001\0",
            b"blksize\0",
        ] {
            assert!(
                parse_request(&request("firmware.bin", extra), "firmware.bin", 1, false).is_err()
            );
        }
        let legacy = parse_request(
            &request("firmware.bin", b"blksize\x001468\0"),
            "firmware.bin",
            1,
            true,
        )
        .unwrap();
        assert_eq!(legacy.block, 512);
        assert!(legacy.acknowledgement.is_empty());
    }
    #[test]
    fn tftp_curl_downloads_empty_exact_block_and_negotiated_files() {
        let temp = tempfile::tempdir().unwrap();
        for (index, size) in [0, 512, 1468, 65536].into_iter().enumerate() {
            let server = server(size, false, None);
            let path = temp.path().join(format!("download-{index}.bin"));
            curl_download(server.address, &path, true);
            wait_complete(&server, 1);
            assert_eq!(std::fs::metadata(&path).unwrap().len(), size);
            assert_eq!(server.manager.status().unwrap().bytes_sent, size);
        }
    }
    #[test]
    fn tftp_large_file_crosses_32mib_and_rolls_block_numbers() {
        let temp = tempfile::tempdir().unwrap();
        let size = 32 * 1024 * 1024 + 4096;
        let server = server(size, true, None);
        let path = temp.path().join("large.bin");
        curl_download(server.address, &path, false);
        wait_complete(&server, 1);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), size);
        let mut file = File::open(path).unwrap();
        let mut buffer = [0; 65536];
        let mut total = 0u64;
        loop {
            let n = file.read(&mut buffer).unwrap();
            if n == 0 {
                break;
            }
            assert!(buffer[..n].iter().all(|b| *b == 0));
            total += n as u64;
        }
        assert_eq!(total, size);
        assert_eq!(server.manager.status().unwrap().bytes_sent, size);
    }
    #[test]
    fn tftp_duplicate_ack_retry_and_stop_active_transfer() {
        let server = server(12, false, None);
        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        client
            .send_to(&request("firmware.bin", b""), server.address)
            .unwrap();
        let mut packet = [0; 2048];
        let (n, peer) = client.recv_from(&mut packet).unwrap();
        assert_eq!(&packet[..4], &[0, 3, 0, 1]);
        let original = packet[..n].to_vec();
        client.send_to(&[0, 4, 0, 0], peer).unwrap(); // Stale ACK must not advance the file.
        let (n, retry_peer) = client.recv_from(&mut packet).unwrap();
        assert_eq!(peer, retry_peer);
        assert_eq!(&packet[..n], original);
        client.send_to(&[0, 4, 0, 1], peer).unwrap();
        wait_complete(&server, 1);
        client
            .send_to(&request("firmware.bin", b""), server.address)
            .unwrap();
        client.recv_from(&mut packet).unwrap();
        let started = Instant::now();
        server.manager.stop().unwrap();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(!server.manager.status().unwrap().running);
        let rebound = UdpSocket::bind(server.address).unwrap();
        drop(rebound);
    }
    #[test]
    fn tftp_ip_restriction_and_unshared_paths() {
        let server = server(12, false, Some("127.0.0.2".parse().unwrap()));
        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(250)))
            .unwrap();
        client
            .send_to(&request("firmware.bin", b""), server.address)
            .unwrap();
        assert!(client.recv_from(&mut [0; 64]).is_err());
        server.manager.stop().unwrap();
        let server = self::server(12, false, None);
        client
            .send_to(&request("../secret", b""), server.address)
            .unwrap();
        let mut data = [0; 64];
        let (len, _) = client.recv_from(&mut data).unwrap();
        assert!(len > 4);
        assert_eq!(&data[..2], &[0, 5]);
    }
    #[test]
    fn tftp_bounded_workers_and_stop() {
        let server = server(2048, false, None);
        let clients: Vec<_> = (0..3)
            .map(|_| {
                let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                socket
            })
            .collect();
        for client in &clients[..2] {
            client
                .send_to(&request("firmware.bin", b""), server.address)
                .unwrap();
            let mut packet = [0; 2048];
            client.recv_from(&mut packet).unwrap();
            assert_eq!(&packet[..2], &[0, 3]);
        }
        assert_eq!(server.manager.status().unwrap().active_transfers, 2);
        clients[2]
            .send_to(&request("firmware.bin", b""), server.address)
            .unwrap();
        let mut packet = [0; 2048];
        clients[2].recv_from(&mut packet).unwrap();
        assert_eq!(&packet[..2], &[0, 5]);
        let started = Instant::now();
        server.manager.stop().unwrap();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(!server.manager.status().unwrap().running);
    }
    #[test]
    fn tftp_real_start_snapshots_file_and_requires_approval() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("firmware.bin");
        std::fs::write(&path, b"original").unwrap();
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let address = socket.local_addr().unwrap();
        drop(socket);
        let manager = TftpServerManager::default();
        let mut req = ServerRequest {
            local_path: path.clone(),
            bind_address: address.ip(),
            port: address.port(),
            allowed_client: None,
            allow_unencrypted: false,
            compatibility: false,
        };
        assert!(manager.start(req).is_err());
        req = ServerRequest {
            local_path: path.clone(),
            bind_address: address.ip(),
            port: address.port(),
            allowed_client: None,
            allow_unencrypted: true,
            compatibility: false,
        };
        manager.start(req).unwrap();
        let _server = TestServer { manager, address };
        std::fs::write(path, b"replacement").unwrap();
        let output = temp.path().join("download.bin");
        curl_download(address, &output, true);
        assert_eq!(std::fs::read(output).unwrap(), b"original");
    }
}
