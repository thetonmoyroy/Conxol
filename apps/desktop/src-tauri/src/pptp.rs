//! Saved PPTP profiles and independently owned, private native tunnel workers.
use crate::{backup::BackupState, workspace_lock::NativeVault};
use conxol_vault::{CredentialId, SecretMaterial, VaultError};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::Ipv4Addr,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
};
use tauri::State;
use uuid::Uuid;
use zeroize::Zeroizing;
const MAX_PROFILES: usize = 2000;
const MAX_BYTES: u64 = 4 * 1024 * 1024;
const MAX_CONNECTIONS: usize = 16;
fn vault_message(error: VaultError) -> String {
    match error {
        VaultError::PortableStateUnavailable(_) => "Workspace password vault is unavailable. Set up or unlock your workspace PIN in Settings > Security, then try again. You can also save the profile without a password and enter it when connecting.".into(),
        VaultError::PortableCredentialMissing(_) => "The saved PPTP password is missing. Edit the profile to replace or remove its saved password.".into(),
        other => other.to_string(),
    }
}
#[derive(Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TunnelProtocol {
    #[default]
    Pptp,
    L2tp,
    L2tpIpsec,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct IpsecCredentials {
    password: Zeroizing<String>,
    psk: Zeroizing<String>,
}
fn valid_password(value: &str) -> bool {
    !value.is_empty() && value.encode_utf16().count() <= 256 && !value.contains(['\r', '\n'])
}
fn pack_ipsec(
    password: Zeroizing<String>,
    psk: Zeroizing<String>,
) -> Result<Zeroizing<String>, String> {
    if !valid_password(&password)
        || psk.is_empty()
        || psk.len() > 1024
        || psk.contains(['\r', '\n'])
    {
        return Err(
            "Enter a password (1–256 characters) and PSK (1–1024 bytes) without line breaks."
                .into(),
        );
    }
    serde_json::to_string(&IpsecCredentials { password, psk })
        .map(Zeroizing::new)
        .map_err(|_| "Could not prepare IPsec credentials.".into())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    #[serde(default)]
    protocol: TunnelProtocol,
    id: Uuid,
    name: String,
    server: String,
    username: String,
    folder: String,
    notes: String,
    #[serde(rename = "credentialRef")]
    credential_id: Option<String>,
}
fn validate(p: &Profile) -> Result<(), String> {
    if p.name.trim().is_empty()
        || p.name.len() > 160
        || p.username.trim().is_empty()
        || p.username.len() > 256
        || p.folder.len() > 160
        || p.notes.len() > 4096
        || p.name
            .chars()
            .chain(p.username.chars())
            .chain(p.folder.chars())
            .any(char::is_control)
    {
        return Err("Use a name and username up to 160/256 characters, a folder up to 160 characters, and notes up to 4096 characters.".into());
    }
    let ip: Ipv4Addr = p
        .server
        .parse()
        .map_err(|_| "Enter a PPTP server IPv4 address.")?;
    if ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() || ip.octets()[0] >= 240 {
        return Err("Enter a unicast PPTP server IPv4 address.".into());
    }
    if let Some(id) = &p.credential_id {
        if !(id.starts_with("pptp-") || id.starts_with("restored-"))
            || CredentialId::new(id).is_err()
        {
            return Err("Invalid PPTP credential reference.".into());
        }
    }
    Ok(())
}
pub struct ProfileStore {
    path: PathBuf,
    profiles: Vec<Profile>,
}
impl ProfileStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let profiles = match std::fs::symlink_metadata(&path) {
            Ok(meta) => {
                if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_BYTES {
                    return Err("PPTP profile storage is invalid or too large.".into());
                }
                let mut bytes = Vec::new();
                std::fs::File::open(&path)
                    .map_err(|_| "Could not read PPTP profiles.")?
                    .take(MAX_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "Could not read PPTP profiles.")?;
                if bytes.len() as u64 > MAX_BYTES {
                    return Err("PPTP profile storage is too large.".into());
                }
                serde_json::from_slice::<Vec<Profile>>(&bytes)
                    .map_err(|_| "PPTP profile storage is invalid.")?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(_) => return Err("Could not read PPTP profile storage.".into()),
        };
        if profiles.len() > MAX_PROFILES {
            return Err("Too many saved PPTP profiles.".into());
        }
        let mut ids = HashSet::new();
        for p in &profiles {
            validate(p)?;
            if !ids.insert(p.id) {
                return Err("Duplicate PPTP profile IDs in storage.".into());
            }
        }
        Ok(Self { path, profiles })
    }
    fn persist(&mut self, profiles: Vec<Profile>) -> Result<(), String> {
        if profiles.len() > MAX_PROFILES {
            return Err("Up to 2000 PPTP profiles can be saved.".into());
        }
        let bytes = serde_json::to_vec(&profiles).map_err(|_| "Could not encode PPTP profiles.")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("PPTP profile storage is full.".into());
        }
        let parent = self.path.parent().ok_or("Invalid PPTP storage path.")?;
        std::fs::create_dir_all(parent).map_err(|_| "Could not create PPTP storage.")?;
        let mut temp =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "Could not save PPTP profiles.")?;
        temp.write_all(&bytes)
            .and_then(|()| temp.as_file().sync_all())
            .map_err(|_| "Could not save PPTP profiles.")?;
        temp.persist(&self.path)
            .map_err(|_| "Could not replace PPTP profiles.")?;
        self.profiles = profiles;
        Ok(())
    }
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    state: String,
    message: String,
    sent: u64,
    received: u64,
}
struct Worker {
    connector: conxol_pptp::transport::Connector,
    cancel: Arc<AtomicBool>,
    status: Arc<Mutex<ConnectionStatus>>,
    thread: JoinHandle<()>,
}
struct PendingConnection {
    connector: conxol_pptp::transport::Connector,
    status: Arc<Mutex<ConnectionStatus>>,
    cancel: Arc<AtomicBool>,
}
impl PendingConnection {
    async fn ready(self) -> Result<conxol_pptp::transport::Connector, String> {
        tokio::time::timeout(std::time::Duration::from_secs(120), async {
            loop {
                if self.cancel.load(Ordering::Acquire) {
                    return Err("Assigned PPTP connection was cancelled.".into());
                }
                {
                    let status = self.status.lock().map_err(|_| "PPTP status unavailable.")?;
                    match status.state.as_str() {
                        "connected" => return Ok(self.connector.clone()),
                        "connecting" => {},
                        "error" => return Err(format!("Assigned PPTP connection failed: {}", status.message)),
                        _ => return Err("Assigned PPTP connection closed before it was ready.".into()),
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        }).await.map_err(|_| "Timed out waiting for the assigned PPTP connection. Check its status in Tools > PPTP manager.".to_string())?
    }
}
#[derive(Clone)]
pub struct PptpManager {
    store: Arc<Mutex<ProfileStore>>,
    workers: Arc<Mutex<HashMap<Uuid, Worker>>>,
    stopping: Arc<AtomicBool>,
}
impl PptpManager {
    pub(crate) fn browser_route(&self, id: Uuid) -> Result<(String, String), String> {
        let store = self.store.lock().map_err(|_| "PPTP profiles unavailable")?;
        let profile = store
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .ok_or("PPTP profile not found")?;
        Ok((profile.name.clone(), profile.server.clone()))
    }
    /// Share an existing attempt or start the assigned profile once, then await readiness.
    pub async fn ensure_connected(
        &self,
        id: Uuid,
        vault: &NativeVault,
    ) -> Result<conxol_pptp::transport::Connector, String> {
        if !conxol_pptp::SUPPORTED {
            return Err(
                "Native PPTP connections are available on Windows, Linux and macOS.".into(),
            );
        }
        if let Ok(connector) = self.connector(id) {
            return Ok(connector);
        }
        start_connection(
            self,
            vault,
            ConnectRequest {
                id,
                password: None,
                psk: None,
            },
            true,
            run_tunnel,
        )?
        .ready()
        .await
    }
    pub(crate) fn connector(&self, id: Uuid) -> Result<conxol_pptp::transport::Connector, String> {
        if self.stopping.load(Ordering::Acquire) {
            return Err("Conxol is shutting down.".into());
        }
        let workers = self
            .workers
            .lock()
            .map_err(|_| "PPTP connection state unavailable.")?;
        let worker = workers
            .get(&id)
            .ok_or("Assigned PPTP tunnel is not connected.")?;
        if worker.thread.is_finished()
            || worker.cancel.load(Ordering::Acquire)
            || worker
                .status
                .lock()
                .map_err(|_| "PPTP status unavailable.")?
                .state
                != "connected"
        {
            return Err("Assigned PPTP tunnel is not connected.".into());
        }
        Ok(worker.connector.clone())
    }
    pub fn open(path: PathBuf) -> Result<Self, String> {
        Ok(Self {
            store: Arc::new(Mutex::new(ProfileStore::open(path)?)),
            workers: Arc::new(Mutex::new(HashMap::new())),
            stopping: Arc::new(AtomicBool::new(false)),
        })
    }
    fn editable(&self, id: Uuid) -> Result<(), String> {
        if self
            .workers
            .lock()
            .map_err(|_| "PPTP connection state unavailable.")?
            .get(&id)
            .is_some_and(|w| !w.thread.is_finished())
        {
            return Err("Disconnect this PPTP profile before editing or deleting it.".into());
        }
        Ok(())
    }
    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::Release);
        let workers = if let Ok(mut workers) = self.workers.lock() {
            for w in workers.values() {
                w.cancel.store(true, Ordering::Release);
            }
            std::mem::take(&mut *workers)
        } else {
            return;
        };
        for (_, w) in workers {
            let _ = w.thread.join();
        }
        #[cfg(windows)]
        if conxol_pptp::elevation::shutdown().is_err() {
            tracing::warn!(event = "pptp_helper_shutdown_incomplete");
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    protocol: TunnelProtocol,
    id: Uuid,
    name: String,
    server: String,
    username: String,
    folder: String,
    notes: String,
    has_password: bool,
    connection: ConnectionStatus,
}
fn view(p: &Profile, connection: ConnectionStatus) -> ProfileView {
    ProfileView {
        protocol: p.protocol,
        id: p.id,
        name: p.name.clone(),
        server: p.server.clone(),
        username: p.username.clone(),
        folder: p.folder.clone(),
        notes: p.notes.clone(),
        has_password: p.credential_id.is_some(),
        connection,
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    profiles: Vec<ProfileView>,
    supported: bool,
    max_connections: usize,
}
#[tauri::command]
pub fn pptp_list(manager: State<'_, PptpManager>) -> Result<Snapshot, String> {
    let store = manager
        .store
        .lock()
        .map_err(|_| "PPTP profiles unavailable.")?;
    let workers = manager
        .workers
        .lock()
        .map_err(|_| "PPTP connection state unavailable.")?;
    let mut profiles = store
        .profiles
        .iter()
        .map(|p| {
            let status = workers
                .get(&p.id)
                .and_then(|w| w.status.lock().ok().map(|s| s.clone()))
                .unwrap_or_else(|| ConnectionStatus {
                    state: "disconnected".into(),
                    ..Default::default()
                });
            view(p, status)
        })
        .collect::<Vec<_>>();
    profiles.sort_by_key(|p| (p.folder.to_lowercase(), p.name.to_lowercase()));
    Ok(Snapshot {
        profiles,
        supported: conxol_pptp::SUPPORTED,
        max_connections: MAX_CONNECTIONS,
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    #[serde(default)]
    protocol: TunnelProtocol,
    id: Option<Uuid>,
    name: String,
    server: String,
    username: String,
    folder: String,
    notes: String,
    password: Option<Zeroizing<String>>,
    #[serde(default)]
    psk: Option<Zeroizing<String>>,
    clear_password: bool,
}
#[tauri::command]
pub fn pptp_save(
    manager: State<'_, PptpManager>,
    vault: State<'_, NativeVault>,
    backup: State<'_, BackupState>,
    request: SaveRequest,
) -> Result<Uuid, String> {
    save_profile(&manager, &vault, &backup, request)
}
fn save_profile(
    manager: &PptpManager,
    vault: &NativeVault,
    backup: &BackupState,
    request: SaveRequest,
) -> Result<Uuid, String> {
    let _operation = backup.operation()?;
    let mut store = manager
        .store
        .lock()
        .map_err(|_| "PPTP profiles unavailable.")?;
    let id = request.id.unwrap_or_else(Uuid::new_v4);
    manager.editable(id)?;
    let previous = store.profiles.iter().find(|p| p.id == id).cloned();
    if request.id.is_some() && previous.is_none() {
        return Err("PPTP profile no longer exists. Refresh the manager.".into());
    }
    let old_ref = previous.as_ref().and_then(|p| p.credential_id.clone());
    if previous
        .as_ref()
        .is_some_and(|p| p.protocol != request.protocol)
        && old_ref.is_some()
        && !request.clear_password
        && request.password.is_none()
    {
        return Err("Replace or remove saved credentials when changing protocol.".into());
    }
    if request.protocol == TunnelProtocol::L2tpIpsec {
        if request.password.is_some() != request.psk.is_some() {
            return Err("Enter both the replacement password and PSK, or leave both blank.".into());
        }
    } else if request.psk.is_some() {
        return Err("PSK is only used by L2TP/IPsec.".into());
    }

    let mut p = Profile {
        protocol: request.protocol,
        id,
        name: request.name.trim().into(),
        server: request.server.trim().into(),
        username: request.username.trim().into(),
        folder: request.folder.trim().into(),
        notes: request.notes,
        credential_id: if request.clear_password {
            None
        } else {
            old_ref.clone()
        },
    };
    validate(&p)?;
    if let Some(secret) = &request.password {
        if secret.is_empty() || secret.encode_utf16().count() > 256 || secret.contains(['\r', '\n'])
        {
            return Err("Use a PPTP password of 1–256 characters without line breaks.".into());
        }
    }
    if request.clear_password && request.password.is_some() {
        return Err("Choose a new password or remove the saved password.".into());
    }
    let new_ref = if let Some(password) = request.password {
        let password = if request.protocol == TunnelProtocol::L2tpIpsec {
            pack_ipsec(password, request.psk.ok_or("IPsec PSK is required.")?)?
        } else {
            password
        };
        let credential = CredentialId::new(format!("pptp-{}", Uuid::new_v4()))
            .map_err(|_| "Could not prepare PPTP credential.")?;
        vault
            .put(&credential, &SecretMaterial::from_zeroizing(password))
            .map_err(vault_message)?;
        if let Err(error) = backup.track(credential.as_str(), false) {
            let _ = vault.delete(&credential);
            return Err(error);
        }
        p.credential_id = Some(credential.to_string());
        Some(credential)
    } else {
        None
    };
    let mut profiles = store.profiles.clone();
    if let Some(existing) = profiles.iter_mut().find(|p| p.id == id) {
        *existing = p.clone();
    } else {
        profiles.push(p.clone());
    }
    if let Err(error) = store.persist(profiles) {
        if let Some(reference) = new_ref {
            let _ = vault.delete(&reference);
            let _ = backup.track(reference.as_str(), true);
        }
        return Err(error);
    }
    if old_ref != p.credential_id {
        if let Some(reference) = old_ref {
            let credential =
                CredentialId::new(reference).map_err(|_| "Invalid previous PPTP credential.")?;
            vault.delete(&credential).map_err(|_|"Profile saved, but the previous password could not be removed. Unlock the vault and remove unused credentials.")?;
            backup.track(credential.as_str(), true)?;
        }
    }
    Ok(id)
}
#[tauri::command]
pub fn pptp_delete(
    manager: State<'_, PptpManager>,
    vault: State<'_, NativeVault>,
    backup: State<'_, BackupState>,
    id: Uuid,
) -> Result<(), String> {
    delete_profile(&manager, &vault, &backup, id)
}
fn delete_profile(
    manager: &PptpManager,
    vault: &NativeVault,
    backup: &BackupState,
    id: Uuid,
) -> Result<(), String> {
    let _operation = backup.operation()?;
    let mut store = manager
        .store
        .lock()
        .map_err(|_| "PPTP profiles unavailable.")?;
    manager.editable(id)?;
    let profile = store
        .profiles
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or("PPTP profile no longer exists.")?;
    // Remove a secret first, retaining it in zeroizing memory for rollback on disk failure.
    let removed = if let Some(reference) = profile.credential_id {
        let reference = CredentialId::new(reference).map_err(|_| "Invalid PPTP credential.")?;
        let secret = vault.get(&reference).map_err(vault_message)?;
        vault.delete(&reference).map_err(vault_message)?;
        Some((reference, secret))
    } else {
        None
    };
    let profiles = store
        .profiles
        .iter()
        .filter(|p| p.id != id)
        .cloned()
        .collect();
    if let Err(error) = store.persist(profiles) {
        if let Some((reference, secret)) = removed {
            let _ = vault.put(&reference, &secret);
        }
        return Err(error);
    }
    if let Some((reference, _)) = removed {
        backup.track(reference.as_str(), true)?;
    }
    manager
        .workers
        .lock()
        .map_err(|_| "PPTP connection state unavailable.")?
        .remove(&id);
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectRequest {
    id: Uuid,
    password: Option<Zeroizing<String>>,
    #[serde(default)]
    psk: Option<Zeroizing<String>>,
}
#[tauri::command]
pub fn pptp_connect(
    manager: State<'_, PptpManager>,
    vault: State<'_, NativeVault>,
    request: ConnectRequest,
) -> Result<(), String> {
    if !conxol_pptp::SUPPORTED {
        return Err("Native PPTP connections are available on Windows, Linux and macOS.".into());
    }
    start_connection(&manager, &vault, request, false, run_tunnel).map(|_| ())
}

type TunnelRunner = fn(
    &Profile,
    Zeroizing<String>,
    &Arc<AtomicBool>,
    &Arc<Mutex<ConnectionStatus>>,
    &mut conxol_pptp::transport::TcpRouter,
) -> Result<(), String>;
fn start_connection(
    manager: &PptpManager,
    vault: &NativeVault,
    request: ConnectRequest,
    reuse: bool,
    runner: TunnelRunner,
) -> Result<PendingConnection, String> {
    let store = manager
        .store
        .lock()
        .map_err(|_| "PPTP profiles unavailable.")?;
    let profile = store
        .profiles
        .iter()
        .find(|p| p.id == request.id)
        .cloned()
        .ok_or("PPTP profile no longer exists.")?;
    let mut workers = manager
        .workers
        .lock()
        .map_err(|_| "PPTP connection state unavailable.")?;
    if manager.stopping.load(Ordering::Acquire) {
        return Err("Conxol is shutting down. New PPTP connections are unavailable.".into());
    }
    if let Some(worker) = workers.get(&request.id).filter(|w| !w.thread.is_finished()) {
        if !reuse {
            return Err("This PPTP profile is already connected or connecting.".into());
        }
        if worker.cancel.load(Ordering::Acquire) {
            return Err("Assigned PPTP tunnel is disconnecting. Retry after it closes.".into());
        }
        return Ok(PendingConnection {
            connector: worker.connector.clone(),
            status: worker.status.clone(),
            cancel: worker.cancel.clone(),
        });
    }
    if workers.values().filter(|w| !w.thread.is_finished()).count() >= MAX_CONNECTIONS {
        return Err("Up to 16 PPTP tunnels can be connected at once.".into());
    }
    let password = match request.password {
        Some(secret) => {
            if profile.protocol == TunnelProtocol::L2tpIpsec {
                pack_ipsec(secret, request.psk.ok_or("IPsec PSK is required.")?)?
            } else {
                if request.psk.is_some() {
                    return Err("Unexpected PSK.".into());
                }
                secret
            }
        }
        None => {
            if request.psk.is_some() {
                return Err("Supply password and PSK together.".into());
            }
            let reference = profile
                .credential_id
                .as_deref()
                .ok_or("Save a password for the assigned profile in Tools > PPTP manager, or connect it there once with a temporary password.")?;
            vault
                .get(&CredentialId::new(reference).map_err(|_| "Invalid PPTP credential.")?)
                .map_err(vault_message)?
                .into_zeroizing()
        }
    };
    if profile.protocol == TunnelProtocol::L2tpIpsec {
        let credentials: IpsecCredentials =
            serde_json::from_str(&password).map_err(|_| "Replace the saved IPsec credentials.")?;
        if !valid_password(&credentials.password)
            || credentials.psk.is_empty()
            || credentials.psk.len() > 1024
            || credentials.psk.contains(['\r', '\n'])
        {
            return Err("Invalid IPsec credentials.".into());
        }
    } else if !valid_password(&password) {
        return Err("Invalid tunnel password.".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    let status = Arc::new(Mutex::new(ConnectionStatus {
        state: "connecting".into(),
        message: "Opening native PPTP connection…".into(),
        ..Default::default()
    }));
    let worker_cancel = cancel.clone();
    let worker_status = status.clone();
    let (connector, mut router) = conxol_pptp::transport::TcpRouter::new();
    let thread = std::thread::Builder::new()
        .name("conxol-pptp".into())
        .spawn(move || {
            let outcome = runner(
                &profile,
                password,
                &worker_cancel,
                &worker_status,
                &mut router,
            );
            if let Ok(mut status) = worker_status.lock() {
                if worker_cancel.load(Ordering::Acquire) {
                    status.state = "disconnected".into();
                    status.message.clear();
                } else if let Err(error) = outcome {
                    status.state = "error".into();
                    status.message = error;
                } else {
                    status.state = "disconnected".into();
                    status.message.clear();
                }
            }
        })
        .map_err(|_| "Could not start native PPTP worker.")?;
    let pending = PendingConnection {
        connector: connector.clone(),
        status: status.clone(),
        cancel: cancel.clone(),
    };
    workers.insert(
        request.id,
        Worker {
            connector,
            cancel,
            status,
            thread,
        },
    );
    Ok(pending)
}
#[tauri::command]
pub fn pptp_disconnect(manager: State<'_, PptpManager>, id: Uuid) -> Result<(), String> {
    let workers = manager
        .workers
        .lock()
        .map_err(|_| "PPTP connection state unavailable.")?;
    if let Some(worker) = workers.get(&id) {
        if !worker.thread.is_finished() {
            worker.cancel.store(true, Ordering::Release);
            if let Ok(mut status) = worker.status.lock() {
                status.state = "disconnecting".into();
                status.message = "Closing private tunnel…".into();
            }
        }
    }
    Ok(())
}
#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
fn run_tunnel(
    profile: &Profile,
    password: Zeroizing<String>,
    cancel: &Arc<AtomicBool>,
    status: &Arc<Mutex<ConnectionStatus>>,
    router: &mut conxol_pptp::transport::TcpRouter,
) -> Result<(), String> {
    use conxol_pptp::{control::Control, gre::Gre, link::Link, ppp, stack::Stack};
    use std::time::{Duration, Instant};
    let set_stage = |message: &str| {
        if let Ok(mut s) = status.lock() {
            s.message = message.into();
        }
    };
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        let server: Ipv4Addr = profile.server.parse()?;
        if profile.protocol != TunnelProtocol::Pptp {
            set_stage("Negotiating L2TP and authenticating PPP…");
            let credentials = if profile.protocol == TunnelProtocol::L2tpIpsec {
                Some(serde_json::from_str::<IpsecCredentials>(&password)?)
            } else {
                None
            };
            let mut transport = if let Some(c) = &credentials {
                set_stage("Authenticating IKEv1 and negotiating IPsec…");
                conxol_pptp::l2tp::Tunnel::connect_ipsec(server, &c.psk, cancel.clone())?
            } else {
                conxol_pptp::l2tp::Tunnel::connect((server, 1701).into(), cancel.clone())?
            };
            let auth = ppp::authenticate_io(
                &mut transport,
                &profile.username,
                credentials
                    .as_ref()
                    .map_or(password.as_str(), |c| c.password.as_str()),
            )?;
            drop(credentials);
            drop(password);
            let mut link = Link::negotiate_io(transport, auth, false)?;
            let mut seed = [0; 8];
            getrandom::fill(&mut seed)?;
            let mut stack = Stack::new(
                link.local_ip,
                link.peer_ip,
                link.mtu,
                u64::from_ne_bytes(seed),
            );
            if let Ok(mut s) = status.lock() {
                s.state = "connected".into();
                s.message = if profile.protocol == TunnelProtocol::L2tpIpsec {
                    "Private L2TP/IPsec connected."
                } else {
                    "Private L2TP connected (unencrypted)."
                }
                .into();
            }
            let start = Instant::now();
            let mut publish = Instant::now();
            while !cancel.load(Ordering::Acquire) {
                router.poll(&mut stack);
                stack.poll(start.elapsed().as_millis() as i64);
                // Bound each drain so cancellation and incoming control keep progressing.
                for _ in 0..64 {
                    let Some(ip) = stack.outgoing() else { break };
                    link.send_ipv4(&ip)?;
                }
                if let Some(ip) = link.poll()? {
                    stack.ingest(ip);
                }
                router.poll(&mut stack);
                if publish.elapsed() >= Duration::from_secs(1) {
                    if let Ok(mut s) = status.lock() {
                        s.sent = link.sent;
                        s.received = link.received;
                    }
                    publish = Instant::now();
                }
            }
            return Ok(());
        }
        let mut control =
            Control::connect(server).map_err(|e| format!("PPTP TCP control connection: {e}"))?;
        control.set_cancellation(cancel.clone());
        let mut random = [0u8; 26];
        getrandom::fill(&mut random)?;
        let call = u16::from_ne_bytes(random[..2].try_into()?).max(1);
        let local = control.local()?;
        let mut gre = match Gre::open(local, server, call) {
            Ok(socket) => socket,
            #[cfg(windows)]
            Err(error) if error.raw_os_error() == Some(10013) => {
                set_stage("Preparing app-session administrator permission. Windows may ask once…");
                conxol_pptp::elevation::open_gre(local, server, call, cancel.clone())
                    .map_err(|e| format!("PPTP permission/socket handoff: {e}"))?
            }
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                set_stage("Requesting permission for private PPTP traffic…");
                conxol_pptp::elevation::open_gre(local, server, call, cancel.clone())
                    .map_err(|e| format!("PPTP permission/socket handoff: {e}"))?
            }
            Err(error) => return Err(format!("PPTP GRE socket setup: {error}").into()),
        };
        set_stage("Negotiating PPTP and authenticating…");
        let peer = control
            .start(call)
            .map_err(|e| format!("PPTP control negotiation: {e}"))?;
        let auth = ppp::authenticate(&mut control, &mut gre, peer, &profile.username, &password)
            .map_err(|e| format!("PPTP PPP authentication: {e}"))?;
        drop(password);
        set_stage("Negotiating encrypted IP traffic…");
        let mut link = Link::negotiate(&mut control, &mut gre, peer, auth)
            .map_err(|e| format!("PPTP encrypted IP negotiation: {e}"))?;
        let mut stack = Stack::new(
            link.local_ip,
            link.peer_ip,
            link.mtu,
            u64::from_ne_bytes(random[..8].try_into()?),
        );
        if cancel.load(Ordering::Acquire) {
            return Ok(());
        }
        if let Ok(mut s) = status.lock() {
            s.state = "connected".into();
            s.message = "Private encrypted tunnel connected.".into();
        }
        let start = Instant::now();
        let mut ping_at = Instant::now();
        let mut publish_at = Instant::now();
        while !cancel.load(Ordering::Acquire) {
            router.poll(&mut stack);
            // A bounded peer keepalive; no network scans or application connections.
            if Instant::now() >= ping_at {
                stack.start_ping(
                    link.peer_ip,
                    u16::from_ne_bytes(random[8..10].try_into()?),
                    random[10..].try_into()?,
                )?;
                ping_at = Instant::now() + Duration::from_secs(30);
            }
            stack.poll(start.elapsed().as_millis() as i64);
            while let Some(ip) = stack.outgoing() {
                link.send_ipv4(&ip)?;
            }
            if let Some(ip) = link.poll()? {
                stack.ingest(ip);
            }
            stack.poll(start.elapsed().as_millis() as i64);
            let _ = stack.ping_done();
            router.poll(&mut stack);
            if Instant::now() >= publish_at {
                if let Ok(mut s) = status.lock() {
                    s.sent = link.sent;
                    s.received = link.received;
                }
                publish_at = Instant::now() + Duration::from_secs(1);
            }
        }
        Ok(())
    })();
    result.map_err(|e| e.to_string())
}
#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn run_tunnel(
    _: &Profile,
    _: Zeroizing<String>,
    _: &Arc<AtomicBool>,
    _: &Arc<Mutex<ConnectionStatus>>,
    _: &mut conxol_pptp::transport::TcpRouter,
) -> Result<(), String> {
    Err("Native PPTP is unavailable on this platform.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tunnel_protocol_legacy_default_and_l2tp_persist_without_secrets() {
        let mut value = serde_json::to_value(profile()).unwrap();
        value.as_object_mut().unwrap().remove("protocol");
        let legacy: Profile = serde_json::from_value(value.clone()).unwrap();
        assert!(legacy.protocol == TunnelProtocol::Pptp);
        value["protocol"] = serde_json::json!("l2tp");
        let l2tp: Profile = serde_json::from_value(value.clone()).unwrap();
        assert!(l2tp.protocol == TunnelProtocol::L2tp);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pptp.json");
        let mut store = ProfileStore::open(path.clone()).unwrap();
        store.persist(vec![l2tp]).unwrap();
        let reopened = ProfileStore::open(path).unwrap();
        assert!(reopened.profiles[0].protocol == TunnelProtocol::L2tp);
        assert_eq!(
            serde_json::to_value(view(&reopened.profiles[0], ConnectionStatus::default())).unwrap()
                ["protocol"],
            "l2tp"
        );
        value["protocol"] = serde_json::json!("unsupported");
        assert!(serde_json::from_value::<Profile>(value).is_err());
    }
    #[test]
    fn ipsec_credentials_roundtrip_replacement_clear_and_protocol_change() {
        let dir = tempfile::tempdir().unwrap();
        let manager = PptpManager::open(dir.path().join("pptp.json")).unwrap();
        let lock =
            crate::workspace_lock::WorkspaceLock::open(dir.path().join("workspace-lock.json"))
                .unwrap();
        lock.configure(
            serde_json::from_value(
                serde_json::json!({"enabled":true,"currentPin":"","newPin":"1234","idleMinutes":5}),
            )
            .unwrap(),
        )
        .unwrap();
        let vault = NativeVault(lock);
        let backup = BackupState::new(dir.path().to_path_buf(), dir.path().to_path_buf());
        let request = |id, password: Option<&str>, psk: Option<&str>, clear_password| SaveRequest {
            protocol: TunnelProtocol::L2tpIpsec,
            id,
            name: "IPsec fixture".into(),
            server: "192.0.2.1".into(),
            username: "fixture".into(),
            folder: "".into(),
            notes: "".into(),
            password: password.map(|p| Zeroizing::new(p.into())),
            psk: psk.map(|p| Zeroizing::new(p.into())),
            clear_password,
        };
        assert!(
            save_profile(
                &manager,
                &vault,
                &backup,
                request(None, Some("fixture-password"), None, false)
            )
            .is_err()
        );
        let id = save_profile(
            &manager,
            &vault,
            &backup,
            request(None, Some("fixture-password"), Some("fixture-psk"), false),
        )
        .unwrap();
        let reference = manager.store.lock().unwrap().profiles[0]
            .credential_id
            .clone()
            .unwrap();
        let secret = vault
            .get(&CredentialId::new(&reference).unwrap())
            .unwrap()
            .into_zeroizing();
        let credentials: IpsecCredentials = serde_json::from_str(&secret).unwrap();
        assert_eq!(credentials.password.as_str(), "fixture-password");
        assert_eq!(credentials.psk.as_str(), "fixture-psk");
        let stored = std::fs::read_to_string(dir.path().join("pptp.json")).unwrap();
        assert!(!stored.contains("fixture-password"));
        assert!(!stored.contains("fixture-psk"));
        save_profile(
            &manager,
            &vault,
            &backup,
            request(Some(id), None, None, false),
        )
        .unwrap();
        assert_eq!(
            manager.store.lock().unwrap().profiles[0]
                .credential_id
                .as_deref(),
            Some(reference.as_str())
        );
        let mut change = request(Some(id), None, None, false);
        change.protocol = TunnelProtocol::L2tp;
        assert!(save_profile(&manager, &vault, &backup, change).is_err());
        save_profile(
            &manager,
            &vault,
            &backup,
            request(
                Some(id),
                Some("replacement-password"),
                Some("replacement-psk"),
                false,
            ),
        )
        .unwrap();
        assert!(vault.get(&CredentialId::new(reference).unwrap()).is_err());
        assert_eq!(vault.list_ids().unwrap().len(), 1);
        save_profile(
            &manager,
            &vault,
            &backup,
            request(Some(id), None, None, true),
        )
        .unwrap();
        assert!(vault.list_ids().unwrap().is_empty());
        assert!(
            pack_ipsec(
                Zeroizing::new("password".into()),
                Zeroizing::new("\n".into())
            )
            .is_err()
        );
    }
    fn simulated_tunnel(
        _: &Profile,
        _: Zeroizing<String>,
        cancel: &Arc<AtomicBool>,
        status: &Arc<Mutex<ConnectionStatus>>,
        _: &mut conxol_pptp::transport::TcpRouter,
    ) -> Result<(), String> {
        std::thread::sleep(std::time::Duration::from_millis(50));
        status.lock().unwrap().state = "connected".into();
        while !cancel.load(Ordering::Acquire) {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        Ok(())
    }
    fn failed_tunnel(
        _: &Profile,
        _: Zeroizing<String>,
        _: &Arc<AtomicBool>,
        _: &Arc<Mutex<ConnectionStatus>>,
        _: &mut conxol_pptp::transport::TcpRouter,
    ) -> Result<(), String> {
        Err("synthetic negotiation failure".into())
    }
    #[tokio::test]
    async fn pptp_auto_connect_shares_pending_and_connected_workers_and_honors_disconnect() {
        let dir = tempfile::tempdir().unwrap();
        let manager = PptpManager::open(dir.path().join("pptp.json")).unwrap();
        let lock =
            crate::workspace_lock::WorkspaceLock::open(dir.path().join("workspace-lock.json"))
                .unwrap();
        lock.configure(
            serde_json::from_value(
                serde_json::json!({"enabled":true,"currentPin":"","newPin":"1234","idleMinutes":5}),
            )
            .unwrap(),
        )
        .unwrap();
        let vault = NativeVault(lock);
        let mut p = profile();
        p.credential_id = Some("pptp-test-synthetic".into());
        vault
            .put(
                &CredentialId::new("pptp-test-synthetic").unwrap(),
                &SecretMaterial::new("synthetic-password"),
            )
            .unwrap();
        manager
            .store
            .lock()
            .unwrap()
            .persist(vec![p.clone()])
            .unwrap();
        let request = || ConnectRequest {
            id: p.id,
            password: None,
            psk: None,
        };
        let first = start_connection(&manager, &vault, request(), true, simulated_tunnel).unwrap();
        let second = start_connection(&manager, &vault, request(), true, simulated_tunnel).unwrap();
        assert!(Arc::ptr_eq(&first.status, &second.status));
        assert_eq!(manager.workers.lock().unwrap().len(), 1);
        let (first, second) = tokio::join!(first.ready(), second.ready());
        assert!(first.is_ok() && second.is_ok());
        assert_eq!(
            manager.ensure_connected(p.id, &vault).await.is_ok(),
            conxol_pptp::SUPPORTED
        );
        let pending =
            start_connection(&manager, &vault, request(), true, simulated_tunnel).unwrap();
        pending.cancel.store(true, Ordering::Release);
        assert!(pending.ready().await.err().unwrap().contains("cancelled"));
        manager.shutdown();
        assert!(start_connection(&manager, &vault, request(), true, simulated_tunnel).is_err());
    }
    #[tokio::test]
    async fn pptp_auto_connect_reports_missing_password_and_real_worker_failure() {
        let dir = tempfile::tempdir().unwrap();
        let manager = PptpManager::open(dir.path().join("pptp.json")).unwrap();
        let vault = NativeVault(
            crate::workspace_lock::WorkspaceLock::open(dir.path().join("workspace-lock.json"))
                .unwrap(),
        );
        let p = profile();
        manager
            .store
            .lock()
            .unwrap()
            .persist(vec![p.clone()])
            .unwrap();
        let error = start_connection(
            &manager,
            &vault,
            ConnectRequest {
                id: p.id,
                password: None,
                psk: None,
            },
            true,
            failed_tunnel,
        )
        .err()
        .unwrap();
        assert!(error.contains("Save a password"));
        assert!(manager.workers.lock().unwrap().is_empty());
        let pending = start_connection(
            &manager,
            &vault,
            ConnectRequest {
                id: p.id,
                password: Some(Zeroizing::new("synthetic-password".into())),
                psk: None,
            },
            true,
            failed_tunnel,
        )
        .unwrap();
        assert!(
            pending
                .ready()
                .await
                .err()
                .unwrap()
                .contains("synthetic negotiation failure")
        );
        manager.shutdown();
    }
    #[test]
    fn pptp_missing_pin_has_actionable_error_and_leaves_profile_unsaved() {
        let dir = tempfile::tempdir().unwrap();
        let manager = PptpManager::open(dir.path().join("pptp.json")).unwrap();
        let vault = NativeVault(
            crate::workspace_lock::WorkspaceLock::open(dir.path().join("workspace-lock.json"))
                .unwrap(),
        );
        let backup = BackupState::new(dir.path().to_path_buf(), dir.path().to_path_buf());
        let error = save_profile(
            &manager,
            &vault,
            &backup,
            SaveRequest {
                protocol: TunnelProtocol::Pptp,
                id: None,
                name: "Fixture".into(),
                server: "192.0.2.1".into(),
                username: "fixture".into(),
                folder: "".into(),
                notes: "".into(),
                password: Some(Zeroizing::new("synthetic-password".into())),
                psk: None,
                clear_password: false,
            },
        )
        .unwrap_err();
        assert!(error.contains("Settings > Security"));
        assert!(error.contains("without a password"));
        assert!(!error.contains("portable"));
        assert!(manager.store.lock().unwrap().profiles.is_empty());
        assert!(!dir.path().join("pptp.json").exists());
        assert!(
            !vault_message(VaultError::PortableStateUnavailable(
                "private-backend-detail".into()
            ))
            .contains("private-backend-detail")
        );
    }
    fn profile() -> Profile {
        Profile {
            protocol: TunnelProtocol::Pptp,
            id: Uuid::new_v4(),
            name: "Lab".into(),
            server: "192.0.2.1".into(),
            username: "fixture-user".into(),
            folder: "Testing".into(),
            notes: "Fixture".into(),
            credential_id: None,
        }
    }
    #[test]
    fn pptp_password_save_replace_clear_and_delete_use_pin_vault() {
        let dir = tempfile::tempdir().unwrap();
        let manager = PptpManager::open(dir.path().join("pptp.json")).unwrap();
        let lock =
            crate::workspace_lock::WorkspaceLock::open(dir.path().join("workspace-lock.json"))
                .unwrap();
        lock.configure(
            serde_json::from_value(
                serde_json::json!({"enabled":true,"currentPin":"","newPin":"1234","idleMinutes":5}),
            )
            .unwrap(),
        )
        .unwrap();
        let vault = NativeVault(lock);
        let backup = BackupState::new(dir.path().to_path_buf(), dir.path().to_path_buf());
        let request = |id, password: Option<&str>, clear| SaveRequest {
            protocol: TunnelProtocol::Pptp,
            id,
            name: "Test VPN".into(),
            server: "192.0.2.10".into(),
            username: "fixture-user".into(),
            folder: "Testing".into(),
            notes: "".into(),
            password: password.map(|s| Zeroizing::new(s.into())),
            psk: None,
            clear_password: clear,
        };
        let id = save_profile(
            &manager,
            &vault,
            &backup,
            request(None, Some("fixture-password-one"), false),
        )
        .unwrap();
        let old = manager.store.lock().unwrap().profiles[0]
            .credential_id
            .clone()
            .unwrap();
        assert_eq!(
            vault
                .get(&CredentialId::new(&old).unwrap())
                .unwrap()
                .as_str(),
            "fixture-password-one"
        );
        assert!(
            !String::from_utf8(std::fs::read(dir.path().join("pptp.json")).unwrap())
                .unwrap()
                .contains("fixture-password")
        );
        save_profile(
            &manager,
            &vault,
            &backup,
            request(Some(id), Some("fixture-password-two"), false),
        )
        .unwrap();
        assert!(vault.get(&CredentialId::new(old).unwrap()).is_err());
        assert_eq!(vault.list_ids().unwrap().len(), 1);
        save_profile(&manager, &vault, &backup, request(Some(id), None, true)).unwrap();
        assert!(vault.list_ids().unwrap().is_empty());
        delete_profile(&manager, &vault, &backup, id).unwrap();
        assert!(manager.store.lock().unwrap().profiles.is_empty());
        manager.store.lock().unwrap().path = dir.path().to_path_buf();
        assert!(
            save_profile(
                &manager,
                &vault,
                &backup,
                request(None, Some("fixture-password-rollback"), false)
            )
            .is_err()
        );
        assert!(vault.list_ids().unwrap().is_empty());
        manager.shutdown();
    }
    #[test]
    fn pptp_shutdown_cancels_and_joins_owned_workers() {
        let dir = tempfile::tempdir().unwrap();
        let manager = PptpManager::open(dir.path().join("pptp.json")).unwrap();
        let id = Uuid::new_v4();
        let cancel = Arc::new(AtomicBool::new(false));
        let observed = Arc::new(AtomicBool::new(false));
        let signal = cancel.clone();
        let finished = observed.clone();
        let thread = std::thread::spawn(move || {
            while !signal.load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            finished.store(true, Ordering::Release);
        });
        manager.workers.lock().unwrap().insert(
            id,
            Worker {
                connector: conxol_pptp::transport::TcpRouter::new().0,
                cancel,
                status: Arc::new(Mutex::new(ConnectionStatus::default())),
                thread,
            },
        );
        assert!(manager.editable(id).is_err());
        assert!(manager.connector(Uuid::new_v4()).is_err());
        assert!(manager.connector(id).is_err());
        manager
            .workers
            .lock()
            .unwrap()
            .get(&id)
            .unwrap()
            .status
            .lock()
            .unwrap()
            .state = "connected".into();
        assert!(manager.connector(id).is_ok());
        manager.shutdown();
        assert!(observed.load(Ordering::Acquire));
        assert!(manager.workers.lock().unwrap().is_empty());
        assert!(manager.editable(id).is_ok());
        assert!(manager.connector(id).is_err());
    }
    #[test]
    fn pptp_profile_roundtrip_bounds_corruption_and_failed_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pptp.json");
        let mut store = ProfileStore::open(path.clone()).unwrap();
        let p = profile();
        validate(&p).unwrap();
        store.persist(vec![p.clone()]).unwrap();
        assert_eq!(ProfileStore::open(path.clone()).unwrap().profiles.len(), 1);
        let mut invalid = p.clone();
        invalid.server = "example.com".into();
        assert!(validate(&invalid).is_err());
        invalid = p.clone();
        invalid.username = "name\n".into();
        assert!(validate(&invalid).is_err());
        assert!(
            !serde_json::to_string(&view(&p, ConnectionStatus::default()))
                .unwrap()
                .contains("credentialId")
        );
        std::fs::write(
            &path,
            serde_json::to_vec(&vec![p.clone(), p.clone()]).unwrap(),
        )
        .unwrap();
        assert!(ProfileStore::open(path.clone()).is_err());
        std::fs::write(&path, b"invalid-json").unwrap();
        assert!(ProfileStore::open(path).is_err());
        store.path = dir.path().to_path_buf();
        assert!(store.persist(Vec::new()).is_err());
        assert_eq!(store.profiles.len(), 1);
    }
}
