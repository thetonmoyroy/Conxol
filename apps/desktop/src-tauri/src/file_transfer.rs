//! Bounded FTP/explicit-FTPS and TFTP clients using the platform curl transport.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::State;
use zeroize::Zeroizing;

const MAX_LIST: u64 = 1024 * 1024;
const MAX_FILE: u64 = 1024 * 1024 * 1024;
const MAX_TFTP: u64 = MAX_FILE;
#[derive(Clone, Default)]
pub struct FileTransferManager(Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);
impl FileTransferManager {
    pub async fn shutdown(&self) {
        self.cancel_all();
        for _ in 0..100 {
            let empty = self.0.lock().map(|jobs| jobs.is_empty()).unwrap_or(true);
            if empty {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    pub fn cancel_all(&self) {
        if let Ok(jobs) = self.0.lock() {
            for flag in jobs.values() {
                flag.store(true, Ordering::Release);
            }
        }
    }
}
#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Ftp,
    Ftps,
    Tftp,
}
#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    List,
    Download,
    Upload,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferRequest {
    id: String,
    protocol: Protocol,
    action: Action,
    host: String,
    port: u16,
    username: String,
    password: Zeroizing<String>,
    remote_path: String,
    local_path: Option<PathBuf>,
    allow_plaintext: bool,
    confirm_upload: bool,
    #[serde(default)]
    tftp_compatibility: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    entries: Vec<String>,
    bytes: u64,
}
fn valid_text(text: &str, max: usize) -> bool {
    text.len() <= max && !text.chars().any(char::is_control)
}
fn validate(r: &TransferRequest) -> Result<(), String> {
    if uuid::Uuid::parse_str(&r.id).is_err() {
        return Err("Invalid transfer ID.".into());
    }
    if r.port == 0
        || r.host.is_empty()
        || r.host.len() > 253
        || !r
            .host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-:".contains(&c))
    {
        return Err("Enter a hostname or IP address and a valid port.".into());
    }
    if !valid_text(&r.remote_path, 4096)
        || !valid_text(&r.username, 256)
        || r.username.contains(':')
        || !valid_text(&r.password, 1024)
    {
        return Err("Invalid path or login fields.".into());
    }
    if r.protocol != Protocol::Ftps && !r.allow_plaintext {
        return Err("Confirm use of an unencrypted protocol.".into());
    }
    if r.action == Action::List && r.protocol == Protocol::Tftp {
        return Err("TFTP cannot list folders. Enter the remote filename.".into());
    }
    if r.action != Action::List && (r.remote_path.is_empty() || r.remote_path.ends_with('/')) {
        return Err("Enter the complete remote filename.".into());
    }
    if r.action == Action::Upload && !r.confirm_upload {
        return Err("Confirm that the upload may replace the remote file.".into());
    }
    if r.action != Action::List && !r.local_path.as_ref().is_some_and(|p| p.is_absolute()) {
        return Err("Choose an absolute local file path.".into());
    }
    Ok(())
}
fn quote_config(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
fn url(r: &TransferRequest) -> String {
    let host = if r.host.contains(':') {
        format!("[{}]", r.host)
    } else {
        r.host.clone()
    };
    // Encode all URL metacharacters so paths cannot add credentials, options or commands.
    let path: String = r
        .remote_path
        .trim_start_matches('/')
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"/-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let scheme = if r.protocol == Protocol::Tftp {
        "tftp"
    } else {
        "ftp"
    };
    format!(
        "{scheme}://{host}:{}/{}{}",
        r.port,
        path,
        if r.action == Action::List && !path.is_empty() && !path.ends_with('/') {
            "/"
        } else {
            ""
        }
    )
}
fn curl_program() -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
            .join("System32/curl.exe")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/usr/bin/curl")
    }
}
struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn execute(r: TransferRequest, cancel: Arc<AtomicBool>) -> Result<TransferResult, String> {
    validate(&r)?;
    if cancel.load(Ordering::Acquire) {
        return Err("Transfer cancelled.".into());
    }
    let limit = if r.protocol == Protocol::Tftp {
        MAX_TFTP
    } else {
        MAX_FILE
    };
    let destination = r.local_path.as_ref();
    let temporary = if r.action == Action::Download {
        let path = destination.ok_or("Choose a destination.")?;
        if path.exists() {
            return Err("Destination already exists. Choose a new filename.".into());
        }
        Some(
            tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid destination.")?)
                .map_err(|_| "Could not create a temporary download file.")?,
        )
    } else {
        None
    };
    // Snapshot an explicitly selected upload so file growth/replacement cannot bypass
    // the size limit or swap the source while curl starts. The private snapshot is RAII-owned.
    let mut upload_snapshot = None;
    if r.action == Action::Upload {
        let mut source = std::fs::File::open(destination.ok_or("Choose a source file.")?)
            .map_err(|_| "Could not open the source file.")?;
        let meta = source
            .metadata()
            .map_err(|_| "Could not inspect the source file.")?;
        if !meta.is_file() || meta.len() > limit {
            return Err(format!("Choose a regular file smaller than {limit} bytes."));
        }
        let mut snapshot =
            tempfile::NamedTempFile::new().map_err(|_| "Could not prepare the upload.")?;
        let mut buffer = [0u8; 65536];
        let mut total = 0u64;
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err("Transfer cancelled.".into());
            }
            let len = source
                .read(&mut buffer)
                .map_err(|_| "Could not read the source file.")?;
            if len == 0 {
                break;
            }
            total += len as u64;
            if total > limit {
                return Err("Upload exceeds the size limit.".into());
            }
            snapshot
                .write_all(&buffer[..len])
                .map_err(|_| "Could not prepare the upload.")?;
        }
        snapshot
            .flush()
            .map_err(|_| "Could not prepare the upload.")?;
        upload_snapshot = Some(snapshot);
    }
    let deadline = if r.protocol == Protocol::Tftp {
        1800
    } else {
        300
    };
    let mut command = Command::new(curl_program());
    command
        .args([
            "--disable",
            "--silent",
            "--globoff",
            "--noproxy",
            "*",
            "--proto",
            "=ftp,tftp",
            "--connect-timeout",
            "10",
            "--speed-limit",
            "1",
            "--speed-time",
            "30",
            "--config",
            "-",
        ])
        .arg("--max-time")
        .arg(deadline.to_string())
        .arg("--max-filesize")
        .arg(limit.to_string())
        .arg("--url")
        .arg(url(&r))
        .stdin(Stdio::piped())
        .stderr(Stdio::null());
    // Do not read curlrc/netrc, proxies, certificate overrides, or ambient credentials.
    for key in [
        "CURL_HOME",
        "CURL_CA_BUNDLE",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "SSLKEYLOGFILE",
        "NETRC",
        "http_proxy",
        "https_proxy",
        "ftp_proxy",
        "all_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "FTP_PROXY",
        "ALL_PROXY",
    ] {
        command.env_remove(key);
    }
    if r.protocol == Protocol::Ftps {
        command.arg("--ssl-reqd");
    }
    if r.protocol != Protocol::Tftp {
        command.args(["--ftp-pasv", "--ftp-skip-pasv-ip"]);
    } else if r.tftp_compatibility {
        command.arg("--tftp-no-options");
    } else {
        command.args(["--tftp-blksize", "1468"]);
    }
    match r.action {
        Action::List => {
            command.arg("--list-only").stdout(Stdio::piped());
        }
        Action::Download => {
            command
                .arg("--output")
                .arg(temporary.as_ref().ok_or("Missing download file.")?.path())
                .stdout(Stdio::null());
        }
        Action::Upload => {
            command
                .arg("--upload-file")
                .arg(
                    upload_snapshot
                        .as_ref()
                        .ok_or("Missing upload file.")?
                        .path(),
                )
                .stdout(Stdio::null());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = ChildGuard(command.spawn().map_err(
        |_| "Could not start system curl. FTP/TFTP requires curl with these protocols enabled.",
    )?);
    let mut config = Zeroizing::new(String::new());
    if r.protocol != Protocol::Tftp {
        let user = if r.username.is_empty() {
            "anonymous"
        } else {
            &r.username
        };
        config.push_str("user = ");
        let credentials = Zeroizing::new(format!("{user}:{}", r.password.as_str()));
        let quoted = Zeroizing::new(quote_config(&credentials));
        config.push_str(&quoted);
        config.push('\n');
    }
    if let Some(mut stdin) = child.0.stdin.take() {
        stdin
            .write_all(config.as_bytes())
            .map_err(|_| "Could not initialize the transfer.")?;
    }
    let listing = child.0.stdout.take().map(|stdout| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = stdout.take(MAX_LIST + 1).read_to_end(&mut bytes);
            (result, bytes)
        })
    });
    let started = Instant::now();
    let status = loop {
        if cancel.load(Ordering::Acquire) {
            return Err(
                "Transfer cancelled. An interrupted upload may leave a partial file on the server."
                    .into(),
            );
        }
        if started.elapsed() > Duration::from_secs(deadline + 5) {
            return Err("Transfer timed out.".into());
        }
        if temporary.as_ref().is_some_and(|file| {
            file.as_file()
                .metadata()
                .is_ok_and(|meta| meta.len() > limit)
        }) {
            return Err("Download exceeds the size limit.".into());
        }
        if let Some(status) = child
            .0
            .try_wait()
            .map_err(|_| "Could not monitor the transfer.")?
        {
            break status;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let bytes = if let Some(thread) = listing {
        let (read, bytes) = thread
            .join()
            .map_err(|_| "Could not read the folder listing.")?;
        read.map_err(|_| "Could not read the folder listing.")?;
        if bytes.len() as u64 > MAX_LIST {
            return Err("Folder listing is too large. Open a smaller folder.".into());
        }
        bytes
    } else {
        Vec::new()
    };
    if !status.success() {
        return Err(match status.code() {
        Some(1 | 4) => "System curl does not support this protocol or option.",
        Some(6 | 7) => "Could not reach the server. Check the host and port.",
        Some(28) => "Transfer timed out.", Some(67) => "FTP login was rejected.",
        Some(60) => "The FTPS certificate could not be verified.",
        Some(78) => "Remote file was not found.",
        _ => "Transfer failed. Check the remote path, login, permissions and server protocol. Interrupted uploads can leave partial remote files.",
    }.into());
    }
    if cancel.load(Ordering::Acquire) {
        return Err("Transfer cancelled.".into());
    }
    let count = if let Some(file) = temporary {
        let len = file
            .as_file()
            .metadata()
            .map_err(|_| "Could not inspect the download.")?
            .len();
        if len > limit {
            return Err("Download exceeds the size limit.".into());
        }
        file.persist_noclobber(destination.ok_or("Missing download destination.")?)
            .map_err(|_| "Could not save download; the destination may already exist.")?;
        len
    } else if r.action == Action::Upload {
        std::fs::metadata(upload_snapshot.as_ref().ok_or("Missing source.")?.path())
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };
    let entries: Vec<String> = String::from_utf8_lossy(&bytes)
        .lines()
        .take(10001)
        .filter(|line| !line.is_empty() && *line != "." && *line != "..")
        .map(str::to_owned)
        .collect();
    if entries.len() > 10000 {
        return Err("Folder contains too many entries. Open a smaller folder.".into());
    }
    Ok(TransferResult {
        entries,
        bytes: count,
    })
}
#[tauri::command]
pub async fn file_transfer_run(
    manager: State<'_, FileTransferManager>,
    request: TransferRequest,
) -> Result<TransferResult, String> {
    validate(&request)?;
    let id = request.id.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = manager
            .0
            .lock()
            .map_err(|_| "Transfer manager unavailable.")?;
        if jobs.len() >= 2 || jobs.contains_key(&id) {
            return Err("Two transfers are already running, or this ID is in use.".into());
        }
        jobs.insert(id.clone(), Arc::clone(&cancel));
    }
    let result = tauri::async_runtime::spawn_blocking(move || execute(request, cancel))
        .await
        .map_err(|_| "Transfer worker failed.".to_string())
        .and_then(|r| r);
    if let Ok(mut jobs) = manager.0.lock() {
        jobs.remove(&id);
    }
    result
}
#[tauri::command]
pub fn file_transfer_cancel(
    manager: State<'_, FileTransferManager>,
    id: String,
) -> Result<(), String> {
    if let Some(flag) = manager
        .0
        .lock()
        .map_err(|_| "Transfer manager unavailable.")?
        .get(&id)
    {
        flag.store(true, Ordering::Release);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        net::{TcpListener, UdpSocket},
    };
    fn request(
        protocol: Protocol,
        action: Action,
        port: u16,
        local_path: Option<PathBuf>,
    ) -> TransferRequest {
        TransferRequest {
            id: uuid::Uuid::new_v4().to_string(),
            protocol,
            action,
            host: "127.0.0.1".into(),
            port,
            username: "fixture".into(),
            password: Zeroizing::new("synthetic-only".into()),
            remote_path: "fixture.bin".into(),
            local_path,
            allow_plaintext: true,
            confirm_upload: true,
            tftp_compatibility: true,
        }
    }
    fn flag() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }
    #[test]
    fn validation_and_url_boundaries() {
        let mut r = request(Protocol::Ftp, Action::List, 21, None);
        r.host = "localhost/other".into();
        assert!(validate(&r).is_err());
        r.host = "::1".into();
        r.remote_path = "a b/@x?z#%\\file".into();
        assert_eq!(url(&r), "ftp://[::1]:21/a%20b/%40x%3Fz%23%25%5Cfile/");
        r.password = Zeroizing::new("x\nurl=http://invalid".into());
        assert!(validate(&r).is_err());
        r.password = Zeroizing::new("x".into());
        r.allow_plaintext = false;
        assert!(validate(&r).is_err());
        r.protocol = Protocol::Ftps;
        assert!(validate(&r).is_ok());
        r.protocol = Protocol::Tftp;
        r.allow_plaintext = true;
        assert!(validate(&r).is_err());
        assert_eq!(quote_config("a\\b\"c"), "\"a\\\\b\\\"c\"");
    }
    #[test]
    fn ftps_never_falls_back_to_plaintext_login() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream.write_all(b"220 fixture\r\n").unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut commands = Vec::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                let name = line.split_whitespace().next().unwrap_or("").to_owned();
                commands.push(name.clone());
                if name == "QUIT" {
                    break;
                }
                stream.write_all(b"500 TLS not available\r\n").unwrap();
            }
            commands
        });
        let mut r = request(Protocol::Ftps, Action::List, port, None);
        r.allow_plaintext = false;
        assert!(execute(r, flag()).is_err());
        let commands = worker.join().unwrap();
        assert!(commands.contains(&"AUTH".into()));
        assert!(!commands.iter().any(|name| name == "USER" || name == "PASS"));
    }
    #[test]
    fn upload_caps_and_confirmation() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("oversized.bin");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(MAX_TFTP + 1)
            .unwrap();
        let mut r = request(Protocol::Tftp, Action::Upload, 1, Some(path));
        r.confirm_upload = false;
        assert!(validate(&r).is_err());
        r.confirm_upload = true;
        assert!(execute(r, flag()).unwrap_err().contains("smaller"));
    }
    // Minimal disposable FTP server: no workstation accounts, files or credentials.
    fn ftp_server() -> (u16, std::thread::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(8)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            stream.write_all(b"220 fixture\r\n").unwrap();
            let mut passive = None;
            let mut uploaded = Vec::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                let command = line.split_whitespace().next().unwrap_or("");
                match command {
                    "USER" => stream.write_all(b"331 password\r\n").unwrap(),
                    "PASS" => stream.write_all(b"230 logged in\r\n").unwrap(),
                    "PWD" => stream.write_all(b"257 \"/\"\r\n").unwrap(),
                    "EPSV" => {
                        let data = TcpListener::bind("127.0.0.1:0").unwrap();
                        write!(
                            stream,
                            "229 Entering Extended Passive Mode (|||{}|)\r\n",
                            data.local_addr().unwrap().port()
                        )
                        .unwrap();
                        passive = Some(data);
                    }
                    "SIZE" => stream.write_all(b"213 12\r\n").unwrap(),
                    "RETR" | "NLST" | "STOR" => {
                        stream.write_all(b"150 data\r\n").unwrap();
                        let (mut data, _) = passive.take().unwrap().accept().unwrap();
                        data.set_read_timeout(Some(Duration::from_secs(8))).unwrap();
                        match command {
                            "STOR" => {
                                data.read_to_end(&mut uploaded).unwrap();
                            }
                            "NLST" => {
                                data.write_all(b"one.bin\r\ntwo.bin\r\n").unwrap();
                            }
                            _ => {
                                data.write_all(b"fixture-data").unwrap();
                            }
                        }
                        drop(data);
                        stream.write_all(b"226 done\r\n").unwrap();
                    }
                    "QUIT" => {
                        let _ = stream.write_all(b"221 bye\r\n");
                        break;
                    }
                    _ => stream.write_all(b"200 ok\r\n").unwrap(),
                }
            }
            uploaded
        });
        (port, worker)
    }
    #[test]
    fn ftp_listing_download_upload_and_noclobber() {
        let temp = tempfile::tempdir().unwrap();
        let (port, worker) = ftp_server();
        let result = execute(request(Protocol::Ftp, Action::List, port, None), flag()).unwrap();
        assert_eq!(result.entries, ["one.bin", "two.bin"]);
        worker.join().unwrap();
        let output = temp.path().join("download.bin");
        let (port, worker) = ftp_server();
        assert_eq!(
            execute(
                request(Protocol::Ftp, Action::Download, port, Some(output.clone())),
                flag()
            )
            .unwrap()
            .bytes,
            12
        );
        worker.join().unwrap();
        assert_eq!(std::fs::read(&output).unwrap(), b"fixture-data");
        // Refuse an occupied destination before any network connection.
        assert!(
            execute(
                request(Protocol::Ftp, Action::Download, 1, Some(output.clone())),
                flag()
            )
            .is_err()
        );
        assert_eq!(std::fs::read(&output).unwrap(), b"fixture-data");
        let (port, worker) = ftp_server();
        execute(
            request(Protocol::Ftp, Action::Upload, port, Some(output)),
            flag(),
        )
        .unwrap();
        assert_eq!(worker.join().unwrap(), b"fixture-data");
    }
    #[test]
    fn tftp_download_and_upload() {
        for upload in [false, true] {
            for size in [0, 12, 512, 1200] {
                let temp = tempfile::tempdir().unwrap();
                let path = temp.path().join("file.bin");
                let payload: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
                if upload {
                    std::fs::write(&path, &payload).unwrap();
                }
                let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(8)))
                    .unwrap();
                let port = socket.local_addr().unwrap().port();
                let expected = payload.clone();
                let worker = std::thread::spawn(move || {
                    let mut buf = [0u8; 1024];
                    let (_, peer) = socket.recv_from(&mut buf).unwrap();
                    assert_eq!(&buf[..2], if upload { &[0, 2] } else { &[0, 1] });
                    // Real servers switch from the well-known port to a transfer port.
                    let data = UdpSocket::bind("127.0.0.1:0").unwrap();
                    data.set_read_timeout(Some(Duration::from_secs(8))).unwrap();
                    if upload {
                        data.send_to(&[0, 4, 0, 0], peer).unwrap();
                        let mut received = Vec::new();
                        for block in 1u16.. {
                            let (len, from) = data.recv_from(&mut buf).unwrap();
                            assert_eq!(from, peer);
                            assert_eq!(&buf[..4], &[0, 3, (block >> 8) as u8, block as u8]);
                            received.extend_from_slice(&buf[4..len]);
                            data.send_to(&[0, 4, (block >> 8) as u8, block as u8], peer)
                                .unwrap();
                            if len < 516 {
                                break;
                            }
                        }
                        assert_eq!(received, expected);
                    } else {
                        let mut offset = 0;
                        for block in 1u16.. {
                            let end = (offset + 512).min(expected.len());
                            let mut packet = vec![0, 3, (block >> 8) as u8, block as u8];
                            packet.extend_from_slice(&expected[offset..end]);
                            data.send_to(&packet, peer).unwrap();
                            let (len, from) = data.recv_from(&mut buf).unwrap();
                            assert_eq!(from, peer);
                            assert_eq!(&buf[..len], &[0, 4, (block >> 8) as u8, block as u8]);
                            if end - offset < 512 {
                                break;
                            }
                            offset = end;
                        }
                    }
                });
                let result = execute(
                    request(
                        Protocol::Tftp,
                        if upload {
                            Action::Upload
                        } else {
                            Action::Download
                        },
                        port,
                        Some(path.clone()),
                    ),
                    flag(),
                )
                .unwrap();
                assert_eq!(result.bytes, size as u64);
                assert_eq!(std::fs::read(path).unwrap(), payload);
                worker.join().unwrap();
            }
        }
    }
    #[test]
    fn failed_and_cancelled_downloads_leave_no_partial_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file.bin");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = flag();
        let trigger = Arc::clone(&cancel);
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            trigger.store(true, Ordering::Release);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
            let _ = stream.read(&mut [0; 1]);
        });
        assert!(
            execute(
                request(Protocol::Ftp, Action::Download, port, Some(path.clone())),
                cancel
            )
            .unwrap_err()
            .contains("cancelled")
        );
        worker.join().unwrap();
        assert!(!path.exists());
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
        // Dead loopback port: no external network target is contacted.
        let socket = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        drop(socket);
        assert!(
            execute(
                request(Protocol::Ftp, Action::Download, port, Some(path.clone())),
                flag()
            )
            .is_err()
        );
        assert!(!path.exists());
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }
}
