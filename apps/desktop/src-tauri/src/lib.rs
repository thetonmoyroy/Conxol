mod backup;
mod logging;
mod store_updates;
use backup::{
    workspace_backup_cancel, workspace_backup_choose, workspace_backup_export,
    workspace_backup_inspect, workspace_backup_preferences, workspace_backup_restart,
    workspace_backup_restore,
};
mod clipboard;
mod notes;
mod pptp;
mod pptp_browser;
mod pptp_diagnostics;
use clipboard::{clipboard_read_text, clipboard_write_text};
mod workspace_lock;
use workspace_lock::{
    NativeVault, WorkspaceLock, workspace_activity, workspace_lock_configure, workspace_lock_now,
    workspace_lock_status, workspace_unlock,
};
mod tftp_server;
use tftp_server::{TftpServerManager, tftp_server_start, tftp_server_status, tftp_server_stop};
mod file_transfer;
use file_transfer::{FileTransferManager, file_transfer_cancel, file_transfer_run};
mod network;
mod output_batch;
mod serial;
mod ssh;
mod ssh_trust;
mod telnet;
mod terminal;

use conxol_core::{
    AppSettings, AuditEvent, AuditEventKind, AuthMethod, JumpHostRecord, Protocol, SerialProfile,
    SessionId, SessionRecord, TelnetProfile,
};
use conxol_network::{TcpCheckOptions, check_tcp_report, resolve_host};
use conxol_ssh::{SshFingerprintOptions, inspect_host_key};
use conxol_store::{
    AuditStore, MacroStore, OpenSshImportReport, SessionImportReport, SessionStore, SettingsStore,
    SnippetStore,
};
use conxol_vault::{CredentialId, CredentialLookup, PortableVault, SecretMaterial, VaultError};
use network::{NetworkManager, NetworkScanRequest};
use serde::Serialize;
use serial::{SerialConnectRequest, SerialManager};
use ssh::{
    SshAuthRequest, SshConnectRequest, SshDynamicForwardRequest, SshLocalForwardRequest,
    SshManager, SshRemoteForwardRequest, SshTransferRequest,
};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use telnet::{TelnetConnectRequest, TelnetManager};
use terminal::TerminalManager;
use zeroize::Zeroizing;

const MAX_NATIVE_PICKER_PATHS: usize = 16;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum LocalPickerKind {
    File,
    Files,
    Directory,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum LocalDownloadPickerKind {
    File,
    Directory,
}

fn native_picker_paths(paths: Vec<PathBuf>) -> Result<Vec<String>, String> {
    paths
        .into_iter()
        .take(MAX_NATIVE_PICKER_PATHS)
        .map(|path| {
            path.to_str()
                .map(str::to_owned)
                .ok_or_else(|| "selected path cannot be represented safely".to_owned())
        })
        .collect()
}

fn native_picker_file_name(suggested_name: &str) -> String {
    let candidate = suggested_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default();
    let filtered: String = candidate
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(*character, ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .take(128)
        .collect();
    if filtered.is_empty() || filtered == "." || filtered == ".." {
        "download.bin".to_owned()
    } else {
        filtered
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSnapshot {
    product: &'static str,
    version: &'static str,
    platform: &'static str,
    local_terminal_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticExport {
    schema_version: u32,
    product: &'static str,
    version: &'static str,
    platform: &'static str,
    architecture: &'static str,
    build_profile: &'static str,
    native_boundary: bool,
    local_terminal_available: bool,
    ssh: conxol_ssh::diagnostics::Snapshot,
    ssh_client_algorithms: conxol_ssh::SshAlgorithmPreferences,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveSshSessionRequest {
    name: String,
    #[serde(default)]
    folder: Option<String>,
    request: SshConnectRequest,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveSerialSessionRequest {
    name: String,
    request: SerialConnectRequest,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveTelnetSessionRequest {
    name: String,
    request: TelnetConnectRequest,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportOpenSshRequest {
    path: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportSessionRequest {
    json: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportSettingsRequest {
    json: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuditRecordRequest {
    kind: AuditEventKind,
    session_id: Option<SessionId>,
    protocol: Option<Protocol>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NetworkResolveRequest {
    host: String,
    timeout_ms: u64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NetworkTcpCheckRequest {
    #[serde(default)]
    pptp_profile_id: Option<uuid::Uuid>,
    host: String,
    port: u16,
    timeout_ms: u64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NetworkPingRequest {
    #[serde(default)]
    pptp_profile_id: Option<uuid::Uuid>,
    host: String,
    timeout_ms: u64,
    interval_ms: u64,
    packet_size: u16,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NetworkMtrRequest {
    #[serde(default)]
    pptp_profile_id: Option<uuid::Uuid>,
    host: String,
    timeout_ms: u64,
    max_hops: u8,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SshFingerprintRequest {
    #[serde(default)]
    pptp_profile_id: Option<uuid::Uuid>,
    #[serde(default)]
    legacy_rsa: bool,
    host: String,
    port: u16,
    timeout_ms: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultPutRequest {
    credential_id: String,
    secret: Zeroizing<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VaultCredentialRequest {
    credential_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortableVaultPassphraseRequest {
    passphrase: Zeroizing<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortableVaultPutRequest {
    credential_id: String,
    secret: Zeroizing<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PortableVaultStatus {
    enabled: bool,
    unlocked: bool,
    exists: bool,
    path: String,
}

#[derive(Clone)]
struct PortableVaultState {
    enabled: bool,
    path: PathBuf,
    vault: Arc<Mutex<Option<PortableVault>>>,
}

#[derive(Clone)]
struct CredentialResolver {
    native: NativeVault,
    portable: Arc<Mutex<Option<PortableVault>>>,
}

impl CredentialLookup for CredentialResolver {
    fn get(&self, credential_id: &CredentialId) -> Result<SecretMaterial, VaultError> {
        tracing::trace!(
            target: "conxol::security",
            operation = "credential_lookup",
            credential_ref = ?logging::REDACTED,
        );
        let portable = self.portable.lock().map_err(|_| {
            VaultError::PortableStateUnavailable("credential lookup lock poisoned".into())
        })?;
        if let Some(vault) = portable.as_ref() {
            match vault.get(credential_id) {
                Ok(secret) => return Ok(secret),
                Err(VaultError::PortableCredentialMissing(_)) => {}
                Err(error) => return Err(error),
            }
        }
        self.native.get(credential_id)
    }
}

fn diagnostic_timeout(timeout_ms: u64) -> Result<std::time::Duration, String> {
    if !(50..=60_000).contains(&timeout_ms) {
        return Err("diagnostic timeout must be between 50 and 60000 milliseconds".into());
    }
    Ok(std::time::Duration::from_millis(timeout_ms))
}

#[tauri::command]
fn app_snapshot() -> AppSnapshot {
    AppSnapshot {
        product: "Conxol",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        local_terminal_available: true,
    }
}

/// Return an explicit, sanitized diagnostic snapshot. This command has no
/// inputs and deliberately does not read sessions, environment variables,
/// general logs, paths, terminal output, or credential stores. Recent typed SSH
/// failures are collected separately with sensitive fields omitted.
#[tauri::command]
fn diagnostic_export() -> Result<String, String> {
    serde_json::to_string_pretty(&DiagnosticExport {
        schema_version: 2,
        product: "Conxol",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        native_boundary: true,
        local_terminal_available: true,
        ssh: conxol_ssh::diagnostics::snapshot(),
        ssh_client_algorithms: conxol_ssh::diagnostic_algorithm_preferences(),
    })
    .map_err(|_| "could not create sanitized diagnostic export".to_owned())
}

// No renderer-supplied report or path: export only our allowlisted snapshot to
// a destination explicitly chosen in the native Save dialog.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn diagnostic_export_save() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = rfd::FileDialog::new()
            .set_title("Save sanitized diagnostics")
            .add_filter("JSON report", &["json"])
            .set_file_name("conxol-diagnostics.json")
            .save_file();
        save_diagnostic_export(path)
    })
    .await
    .map_err(|_| "diagnostic export could not open the Save dialog".to_owned())?
}

fn save_diagnostic_export(path: Option<PathBuf>) -> Result<bool, String> {
    let Some(path) = path else {
        return Ok(false);
    };
    let report = diagnostic_export()?;
    std::fs::write(path, report.as_bytes())
        .map_err(|_| "could not save diagnostics; choose a writable destination".to_owned())?;
    Ok(true)
}

const MAX_NETWORK_OUTPUT_EXPORT_BYTES: usize = 16 * 1024 * 1024;

fn network_diagnostic_output_tool(tool: &str) -> Result<&'static str, String> {
    match tool {
        "scan" => Ok("scan"),
        "ping" => Ok("ping"),
        "mtr" => Ok("mtr"),
        "dns" => Ok("dns"),
        "tcp" => Ok("tcp"),
        "ssh" => Ok("ssh"),
        _ => Err("unknown diagnostic output tool".into()),
    }
}

// This exports the operator's displayed CLI report, separate from the sanitized
// support snapshot above. Only the native Save dialog supplies a destination.
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn network_diagnostic_output_export(tool: String, content: String) -> Result<bool, String> {
    let tool = network_diagnostic_output_tool(&tool)?;
    if content.len() > MAX_NETWORK_OUTPUT_EXPORT_BYTES {
        return Err("diagnostic text output exceeds 16 MiB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let path = rfd::FileDialog::new()
            .set_title("Export diagnostic text output")
            .add_filter("Text file", &["txt"])
            .set_file_name(format!("conxol-{tool}-{stamp}.txt"))
            .save_file();
        save_network_diagnostic_output(path, &content)
    })
    .await
    .map_err(|_| "could not open the diagnostic output Save dialog".to_owned())?
}

// Export only the rendered terminal snapshot; the destination is chosen natively.
#[tauri::command]
async fn terminal_output_export(content: String, file_name: String) -> Result<bool, String> {
    if file_name.is_empty() || file_name.len() > 1024
        || file_name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || !file_name.ends_with(".txt")
    {
        return Err("invalid terminal export filename".into());
    }
    if content.len() > MAX_NETWORK_OUTPUT_EXPORT_BYTES {
        return Err("terminal text output exceeds 16 MiB".into());
    }
    #[cfg(target_os = "android")]
    {
        Err("Android file export is not available in this preview. Copy the output instead.".into())
    }
    #[cfg(not(target_os = "android"))]
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_title("Export terminal output")
            .add_filter("Text file", &["txt"])
            .set_file_name(file_name)
            .save_file();
        let Some(path) = path else { return Ok(false); };
        std::fs::write(path, content.as_bytes())
            .map_err(|_| "could not save terminal output; choose a writable destination".to_owned())?;
        Ok(true)
    })
    .await
    .map_err(|_| "could not open the terminal output Save dialog".to_owned())?
}

fn save_network_diagnostic_output(path: Option<PathBuf>, content: &str) -> Result<bool, String> {
    if content.len() > MAX_NETWORK_OUTPUT_EXPORT_BYTES {
        return Err("diagnostic text output exceeds 16 MiB".into());
    }
    let Some(path) = path else {
        return Ok(false);
    };
    std::fs::write(path, content.as_bytes()).map_err(|_| {
        "could not save diagnostic text output; choose a writable destination".to_owned()
    })?;
    Ok(true)
}

#[tauri::command]
fn session_list(store: State<'_, Mutex<SessionStore>>) -> Result<Vec<SessionRecord>, String> {
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())
        .map(|store| store.list().to_vec())
}

fn validate_session_credential_references(session: &SessionRecord) -> Result<(), String> {
    fn validate_auth(auth: &AuthMethod) -> Result<(), String> {
        let references = match auth {
            AuthMethod::Password { credential_ref }
            | AuthMethod::KeyboardInteractive { credential_ref } => {
                vec![credential_ref.as_str()]
            }
            AuthMethod::PrivateKey {
                credential_ref: Some(credential_ref),
                ..
            } => vec![credential_ref.as_str()],
            AuthMethod::None
            | AuthMethod::Agent
            | AuthMethod::KeyboardInteractivePrompt
            | AuthMethod::PrivateKey { .. } => Vec::new(),
        };
        for reference in references {
            CredentialId::new(reference).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    validate_auth(&session.auth)?;
    for jump_host in &session.jump_host_profiles {
        validate_auth(&jump_host.auth)?;
    }
    Ok(())
}

#[tauri::command]
fn session_save(
    store: State<'_, Mutex<SessionStore>>,
    session: SessionRecord,
) -> Result<SessionRecord, String> {
    validate_session_credential_references(&session)?;
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .save(session)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_delete(
    store: State<'_, Mutex<SessionStore>>,
    session_id: SessionId,
) -> Result<bool, String> {
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .delete(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_import_openssh(
    store: State<'_, Mutex<SessionStore>>,
    payload: ImportOpenSshRequest,
) -> Result<OpenSshImportReport, String> {
    let path = payload
        .path
        .filter(|path| !path.trim().is_empty())
        .map(|path| expand_user_path(&path))
        .ok_or_else(|| {
            "an explicit OpenSSH config path is required; Conxol never reads ~/.ssh/config automatically".to_owned()
        })?;
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .import_openssh_config(path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_export(store: State<'_, Mutex<SessionStore>>) -> Result<String, String> {
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .export_json()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_import(
    store: State<'_, Mutex<SessionStore>>,
    payload: ImportSessionRequest,
) -> Result<SessionImportReport, String> {
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .import_json(&payload.json)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_set_favorite(
    store: State<'_, Mutex<SessionStore>>,
    session_id: SessionId,
    favorite: bool,
) -> Result<bool, String> {
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .set_favorite(session_id, favorite)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_touch(
    store: State<'_, Mutex<SessionStore>>,
    session_id: SessionId,
) -> Result<bool, String> {
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .touch(session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn settings_get(store: State<'_, Mutex<SettingsStore>>) -> Result<AppSettings, String> {
    store
        .lock()
        .map_err(|_| "settings store lock poisoned".to_owned())
        .map(|store| store.get().clone())
}

#[tauri::command]
fn settings_save(
    store: State<'_, Mutex<SettingsStore>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    store
        .lock()
        .map_err(|_| "settings store lock poisoned".to_owned())?
        .save(settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn settings_reset(store: State<'_, Mutex<SettingsStore>>) -> Result<AppSettings, String> {
    store
        .lock()
        .map_err(|_| "settings store lock poisoned".to_owned())?
        .reset()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn settings_export(store: State<'_, Mutex<SettingsStore>>) -> Result<String, String> {
    store
        .lock()
        .map_err(|_| "settings store lock poisoned".to_owned())?
        .export_json()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn settings_import(
    store: State<'_, Mutex<SettingsStore>>,
    payload: ImportSettingsRequest,
) -> Result<AppSettings, String> {
    store
        .lock()
        .map_err(|_| "settings store lock poisoned".to_owned())?
        .import_json(&payload.json)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn audit_list(store: State<'_, Mutex<AuditStore>>) -> Result<Vec<AuditEvent>, String> {
    store
        .lock()
        .map_err(|_| "audit store lock poisoned".to_owned())
        .map(|store| store.list().to_vec())
}

/// Append only a typed, secret-free lifecycle fact. The request intentionally
/// has no hostname, path, command, credential, or error-detail field.
#[tauri::command]
fn audit_record(
    store: State<'_, Mutex<AuditStore>>,
    payload: AuditRecordRequest,
) -> Result<AuditEvent, String> {
    store
        .lock()
        .map_err(|_| "audit store lock poisoned".to_owned())?
        .append(payload.kind, payload.session_id, payload.protocol)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn audit_clear(store: State<'_, Mutex<AuditStore>>) -> Result<(), String> {
    store
        .lock()
        .map_err(|_| "audit store lock poisoned".to_owned())?
        .clear()
        .map_err(|error| error.to_string())
}

/// Store a secret only after an explicit user action. The secret is never
/// returned to the renderer and is owned by a zeroizing native wrapper while
/// the encrypted credential write is in progress.
#[tauri::command]
fn vault_put(
    vault: State<'_, NativeVault>,
    backup: State<'_, backup::BackupState>,
    payload: VaultPutRequest,
) -> Result<String, String> {
    let _operation = backup.operation()?;
    let credential_id =
        CredentialId::new(payload.credential_id).map_err(|error| error.to_string())?;
    if payload.secret.is_empty() {
        return Err("vault secret cannot be empty".into());
    }
    let secret = SecretMaterial::from_zeroizing(payload.secret);
    vault
        .put(&credential_id, &secret)
        .map_err(|error| error.to_string())?;
    backup.track(&credential_id.to_string(), false)?;
    Ok(credential_id.to_string())
}

/// Delete is idempotent in the native vault and returns only the validated
/// opaque reference, never credential material.
#[tauri::command]
fn vault_delete(
    vault: State<'_, NativeVault>,
    backup: State<'_, backup::BackupState>,
    payload: VaultCredentialRequest,
) -> Result<String, String> {
    let _operation = backup.operation()?;
    let credential_id =
        CredentialId::new(payload.credential_id).map_err(|error| error.to_string())?;
    vault
        .delete(&credential_id)
        .map_err(|error| error.to_string())?;
    backup.track(&credential_id.to_string(), true)?;
    Ok(credential_id.to_string())
}

fn portable_vault_status_for(state: &PortableVaultState) -> Result<PortableVaultStatus, String> {
    let vault = state
        .vault
        .lock()
        .map_err(|_| "portable vault state lock poisoned".to_owned())?;
    Ok(PortableVaultStatus {
        enabled: state.enabled,
        unlocked: vault.is_some(),
        exists: state.path.is_file(),
        path: state.path.display().to_string(),
    })
}

#[tauri::command]
fn portable_vault_status(
    state: State<'_, PortableVaultState>,
) -> Result<PortableVaultStatus, String> {
    portable_vault_status_for(state.inner())
}

#[tauri::command]
fn portable_vault_create(
    state: State<'_, PortableVaultState>,
    payload: PortableVaultPassphraseRequest,
) -> Result<PortableVaultStatus, String> {
    if !state.enabled {
        return Err("portable mode is disabled; place portable.flag beside the executable".into());
    }
    let passphrase = SecretMaterial::from_zeroizing(payload.passphrase);
    let vault =
        PortableVault::create(&state.path, &passphrase).map_err(|error| error.to_string())?;
    let mut current = state
        .vault
        .lock()
        .map_err(|_| "portable vault state lock poisoned".to_owned())?;
    *current = Some(vault);
    drop(current);
    portable_vault_status_for(state.inner())
}

#[tauri::command]
fn portable_vault_unlock(
    state: State<'_, PortableVaultState>,
    payload: PortableVaultPassphraseRequest,
) -> Result<PortableVaultStatus, String> {
    if !state.enabled {
        return Err("portable mode is disabled; place portable.flag beside the executable".into());
    }
    let passphrase = SecretMaterial::from_zeroizing(payload.passphrase);
    let vault = PortableVault::open(&state.path, &passphrase).map_err(|error| error.to_string())?;
    let mut current = state
        .vault
        .lock()
        .map_err(|_| "portable vault state lock poisoned".to_owned())?;
    *current = Some(vault);
    drop(current);
    portable_vault_status_for(state.inner())
}

#[tauri::command]
fn portable_vault_lock(
    state: State<'_, PortableVaultState>,
) -> Result<PortableVaultStatus, String> {
    let mut current = state
        .vault
        .lock()
        .map_err(|_| "portable vault state lock poisoned".to_owned())?;
    current.take();
    drop(current);
    portable_vault_status_for(state.inner())
}

#[tauri::command]
fn portable_vault_list(state: State<'_, PortableVaultState>) -> Result<Vec<String>, String> {
    let current = state
        .vault
        .lock()
        .map_err(|_| "portable vault state lock poisoned".to_owned())?;
    current
        .as_ref()
        .map(PortableVault::list_ids)
        .ok_or_else(|| "portable vault is locked".to_owned())
}

#[tauri::command]
fn portable_vault_put(
    state: State<'_, PortableVaultState>,
    payload: PortableVaultPutRequest,
) -> Result<String, String> {
    let credential_id =
        CredentialId::new(payload.credential_id).map_err(|error| error.to_string())?;
    let secret = SecretMaterial::from_zeroizing(payload.secret);
    let mut current = state
        .vault
        .lock()
        .map_err(|_| "portable vault state lock poisoned".to_owned())?;
    let vault = current
        .as_mut()
        .ok_or_else(|| "portable vault is locked".to_owned())?;
    vault
        .put(&credential_id, secret)
        .map_err(|error| error.to_string())?;
    Ok(credential_id.to_string())
}

#[tauri::command]
fn portable_vault_delete(
    state: State<'_, PortableVaultState>,
    payload: VaultCredentialRequest,
) -> Result<String, String> {
    let credential_id =
        CredentialId::new(payload.credential_id).map_err(|error| error.to_string())?;
    let mut current = state
        .vault
        .lock()
        .map_err(|_| "portable vault state lock poisoned".to_owned())?;
    let vault = current
        .as_mut()
        .ok_or_else(|| "portable vault is locked".to_owned())?;
    vault
        .delete(&credential_id)
        .map_err(|error| error.to_string())?;
    Ok(credential_id.to_string())
}

#[tauri::command]
fn snippet_list(
    store: State<'_, Mutex<SnippetStore>>,
) -> Result<Vec<conxol_core::SnippetRecord>, String> {
    store
        .lock()
        .map_err(|_| "snippet store lock poisoned".to_owned())
        .map(|store| store.list().to_vec())
}

#[tauri::command]
fn snippet_save(
    store: State<'_, Mutex<SnippetStore>>,
    snippet: conxol_core::SnippetRecord,
) -> Result<conxol_core::SnippetRecord, String> {
    store
        .lock()
        .map_err(|_| "snippet store lock poisoned".to_owned())?
        .save(snippet)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn snippet_delete(
    store: State<'_, Mutex<SnippetStore>>,
    snippet_id: uuid::Uuid,
) -> Result<bool, String> {
    store
        .lock()
        .map_err(|_| "snippet store lock poisoned".to_owned())?
        .delete(snippet_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn macro_list(
    store: State<'_, Mutex<MacroStore>>,
) -> Result<Vec<conxol_core::MacroRecord>, String> {
    store
        .lock()
        .map_err(|_| "macro store lock poisoned".to_owned())
        .map(|store| store.list().to_vec())
}

#[tauri::command]
fn macro_save(
    store: State<'_, Mutex<MacroStore>>,
    record: conxol_core::MacroRecord,
) -> Result<conxol_core::MacroRecord, String> {
    store
        .lock()
        .map_err(|_| "macro store lock poisoned".to_owned())?
        .save(record)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn macro_delete(store: State<'_, Mutex<MacroStore>>, macro_id: uuid::Uuid) -> Result<bool, String> {
    store
        .lock()
        .map_err(|_| "macro store lock poisoned".to_owned())?
        .delete(macro_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_save_ssh(
    store: State<'_, Mutex<SessionStore>>,
    payload: SaveSshSessionRequest,
) -> Result<SessionRecord, String> {
    let SaveSshSessionRequest {
        name,
        folder,
        request,
    } = payload;
    ssh::validate_ssh_connection_policy(&request).map_err(|error| error.to_string())?;
    if let Some(x11) = &request.x11 {
        conxol_ssh::X11ForwardingOptions::parse(&x11.display, x11.single_connection)
            .map_err(|error| format!("invalid X11 configuration: {error}"))?;
    }
    let SshConnectRequest {
        pptp_profile_id,
        host,
        port,
        username,
        auth: request_auth,
        known_hosts_path,
        legacy_rsa,
        pinned_fingerprint,
        jump_hosts,
        x11,
        server_alive_interval,
        environment,
        startup_directory,
        startup_command,
        ..
    } = request;
    let auth = match request_auth {
        SshAuthRequest::Agent => AuthMethod::Agent,
        SshAuthRequest::KeyboardInteractivePrompt => AuthMethod::KeyboardInteractivePrompt,
        SshAuthRequest::Password { credential_id } if !credential_id.trim().is_empty() => {
            AuthMethod::Password {
                credential_ref: credential_id,
            }
        }
        SshAuthRequest::PrivateKey {
            path,
            passphrase_credential_id,
        } if !path.trim().is_empty() => AuthMethod::PrivateKey {
            key_ref: path,
            credential_ref: passphrase_credential_id,
        },
        SshAuthRequest::KeyboardInteractive { credential_id }
            if !credential_id.trim().is_empty() =>
        {
            AuthMethod::KeyboardInteractive {
                credential_ref: credential_id,
            }
        }
        _ => return Err("cannot save an SSH session with incomplete authentication".into()),
    };
    let session = SessionRecord {
        id: SessionId::new(),
        name,
        protocol: Protocol::Ssh,
        hostname: host,
        port,
        username: Some(username),
        auth,
        last_used_at: None,
        known_hosts_path,
        legacy_rsa,
        pinned_fingerprint,
        x11_display: x11.as_ref().map(|value| value.display.clone()),
        x11_single_connection: x11.as_ref().is_some_and(|value| value.single_connection),
        server_alive_interval,
        folder: folder.filter(|value| !value.trim().is_empty()),
        tags: Vec::new(),
        favorite: false,
        startup_directory,
        startup_command,
        environment,
        pptp_profile_id,
        jump_hosts: jump_hosts.iter().map(|jump| jump.host.clone()).collect(),
        jump_host_profiles: jump_hosts
            .into_iter()
            .map(|jump| {
                let auth = match jump.auth {
                    SshAuthRequest::Agent => Ok(AuthMethod::Agent),
                    SshAuthRequest::KeyboardInteractivePrompt => {
                        Ok(AuthMethod::KeyboardInteractivePrompt)
                    }
                    SshAuthRequest::Password { credential_id }
                        if !credential_id.trim().is_empty() =>
                    {
                        Ok(AuthMethod::Password {
                            credential_ref: credential_id,
                        })
                    }
                    SshAuthRequest::PrivateKey {
                        path,
                        passphrase_credential_id,
                    } if !path.trim().is_empty() => Ok(AuthMethod::PrivateKey {
                        key_ref: path,
                        credential_ref: passphrase_credential_id,
                    }),
                    SshAuthRequest::KeyboardInteractive { credential_id }
                        if !credential_id.trim().is_empty() =>
                    {
                        Ok(AuthMethod::KeyboardInteractive {
                            credential_ref: credential_id,
                        })
                    }
                    _ => Err("cannot save a jump host with incomplete authentication".to_owned()),
                }?;
                Ok(JumpHostRecord {
                    host: jump.host,
                    port: jump.port,
                    username: jump.username,
                    auth,
                    known_hosts_path: jump.known_hosts_path,
                    legacy_rsa: jump.legacy_rsa,
                    pinned_fingerprint: jump.pinned_fingerprint,
                    server_alive_interval: jump.server_alive_interval,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
        notes: None,
        serial_profile: None,
        telnet_profile: None,
        remote_desktop_profile: None,
    };
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .save(session)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_save_serial(
    store: State<'_, Mutex<SessionStore>>,
    payload: SaveSerialSessionRequest,
) -> Result<SessionRecord, String> {
    let SaveSerialSessionRequest { name, request } = payload;
    let session = SessionRecord {
        id: SessionId::new(),
        name,
        protocol: Protocol::Serial,
        hostname: request.device.clone(),
        port: 0,
        username: None,
        auth: AuthMethod::None,
        last_used_at: None,
        known_hosts_path: None,
        legacy_rsa: false,
        pinned_fingerprint: None,
        x11_display: None,
        x11_single_connection: false,
        server_alive_interval: None,
        folder: None,
        tags: vec!["serial".into()],
        favorite: false,
        startup_directory: None,
        startup_command: None,
        environment: Vec::new(),
        pptp_profile_id: None,
        jump_hosts: Vec::new(),
        jump_host_profiles: Vec::new(),
        notes: None,
        serial_profile: Some(SerialProfile {
            device: request.device,
            baud_rate: request.baud_rate,
            data_bits: format!("{:?}", request.data_bits).to_lowercase(),
            stop_bits: format!("{:?}", request.stop_bits).to_lowercase(),
            parity: format!("{:?}", request.parity).to_lowercase(),
            flow_control: format!("{:?}", request.flow_control).to_lowercase(),
            line_ending: match request.line_ending {
                conxol_serial::LineEnding::None => "none",
                conxol_serial::LineEnding::CrLf => "cr-lf",
                conxol_serial::LineEnding::Cr => "cr",
                conxol_serial::LineEnding::Lf => "lf",
            }
            .into(),
        }),
        telnet_profile: None,
        remote_desktop_profile: None,
    };
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .save(session)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn session_save_telnet(
    store: State<'_, Mutex<SessionStore>>,
    payload: SaveTelnetSessionRequest,
) -> Result<SessionRecord, String> {
    let SaveTelnetSessionRequest { name, request } = payload;
    let TelnetConnectRequest {
        pptp_profile_id,
        host,
        port,
        terminal,
        encoding,
        columns,
        rows,
        username,
        credential_id,
        ..
    } = request;
    let encoding = match encoding {
        conxol_telnet::TelnetEncoding::Utf8 => "utf-8",
        conxol_telnet::TelnetEncoding::Windows1252 => "windows-1252",
    };
    let session = SessionRecord {
        id: SessionId::new(),
        name,
        protocol: Protocol::Telnet,
        hostname: host,
        port,
        username,
        auth: credential_id
            .map(|credential_ref| AuthMethod::Password { credential_ref })
            .unwrap_or(AuthMethod::None),
        last_used_at: None,
        known_hosts_path: None,
        legacy_rsa: false,
        pinned_fingerprint: None,
        x11_display: None,
        x11_single_connection: false,
        server_alive_interval: None,
        folder: None,
        tags: vec!["telnet".into(), "plaintext".into()],
        favorite: false,
        startup_directory: None,
        startup_command: None,
        environment: Vec::new(),
        pptp_profile_id,
        jump_hosts: Vec::new(),
        jump_host_profiles: Vec::new(),
        notes: Some("Telnet is an unencrypted legacy protocol.".into()),
        serial_profile: None,
        telnet_profile: Some(TelnetProfile {
            terminal,
            encoding: encoding.into(),
            columns,
            rows,
        }),
        remote_desktop_profile: None,
    };
    store
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?
        .save(session)
        .map_err(|error| error.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NetworkDnsRequest {
    #[serde(default)]
    pptp_profile_id: Option<uuid::Uuid>,
    host: String,
    timeout_ms: u64,
    #[serde(default)]
    record_type: conxol_network::DnsRecordType,
    server: Option<String>,
}

#[tauri::command]
async fn network_dns_lookup(
    pptp: State<'_, pptp::PptpManager>,
    vault: State<'_, NativeVault>,
    request: NetworkDnsRequest,
) -> Result<conxol_network::DnsLookupResult, String> {
    let timeout = diagnostic_timeout(request.timeout_ms)?;
    if let Some(id) = request.pptp_profile_id {
        let server = request
            .server
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or("Enter an explicit IPv4 DNS server for PPTP diagnostics.")?;
        pptp_diagnostics::ipv4(server)?;
        let connector = pptp.ensure_connected(id, &vault).await?;
        return tokio::time::timeout(timeout, async {
            let stream = connector
                .connect(server, 53)
                .await
                .map_err(|e| e.to_string())?;
            conxol_network::lookup_dns_stream(
                &request.host,
                request.record_type,
                server,
                timeout,
                stream,
            )
            .await
            .map_err(|e| e.to_string())
        })
        .await
        .map_err(|_| "PPTP DNS lookup timed out.".to_string())?;
    }
    conxol_network::lookup_dns(
        &request.host,
        request.record_type,
        request.server.as_deref(),
        timeout,
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn network_resolve_host(request: NetworkResolveRequest) -> Result<Vec<String>, String> {
    let timeout = diagnostic_timeout(request.timeout_ms)?;
    resolve_host(request.host, timeout)
        .await
        .map(|addresses| {
            addresses
                .into_iter()
                .map(|address| address.to_string())
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn network_check_tcp(
    pptp: State<'_, pptp::PptpManager>,
    vault: State<'_, NativeVault>,
    request: NetworkTcpCheckRequest,
) -> Result<conxol_network::TcpConnectReport, String> {
    let timeout = diagnostic_timeout(request.timeout_ms)?;
    if let Some(id) = request.pptp_profile_id {
        pptp_diagnostics::ipv4(&request.host)?;
        let connector = pptp.ensure_connected(id, &vault).await?;
        return pptp_diagnostics::tcp_report(
            connector,
            TcpCheckOptions {
                host: request.host,
                port: request.port,
                timeout,
            },
        )
        .await;
    }
    check_tcp_report(TcpCheckOptions {
        host: request.host,
        port: request.port,
        timeout,
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_inspect_host_key(
    vault: State<'_, NativeVault>,
    pptp: State<'_, pptp::PptpManager>,
    request: SshFingerprintRequest,
) -> Result<conxol_ssh::SshHostKeyInspection, String> {
    let timeout = diagnostic_timeout(request.timeout_ms)?;
    let options = SshFingerprintOptions {
        legacy_rsa: request.legacy_rsa,
        host: request.host,
        port: request.port,
        timeout,
    };
    conxol_ssh::diagnostics::scope(
        conxol_ssh::diagnostics::Operation::HostKeyInspection,
        request.timeout_ms,
        0,
        async {
            if let Some(id) = request.pptp_profile_id {
                let connector = pptp.ensure_connected(id, &vault).await?;
                let stream =
                    tokio::time::timeout(timeout, connector.connect(&options.host, options.port))
                        .await
                        .map_err(|_| "PPTP TCP connection timed out.".to_string())?
                        .map_err(|e| e.to_string())?;
                conxol_ssh::inspect_host_key_stream(options, stream)
                    .await
                    .map_err(|e| e.to_string())
            } else {
                inspect_host_key(options).await.map_err(|e| e.to_string())
            }
        },
    )
    .await
}

#[tauri::command]
async fn network_scan_start(
    pptp: State<'_, pptp::PptpManager>,
    vault: State<'_, NativeVault>,
    app: tauri::AppHandle,
    manager: State<'_, NetworkManager>,
    request: NetworkScanRequest,
) -> Result<network::NetworkScanResponse, String> {
    conxol_network::PortScanOptions {
        host: request.host.clone(),
        start_port: request.start_port,
        end_port: request.end_port,
        concurrency: request.concurrency,
        timeout: diagnostic_timeout(request.timeout_ms)?,
    }
    .validate()
    .map_err(|e| e.to_string())?;
    let probe = if let Some(id) = request.pptp_profile_id {
        for host in conxol_network::scan_targets(&request.host).map_err(|e| e.to_string())? {
            pptp_diagnostics::ipv4(&host)?;
        }
        Some(pptp_diagnostics::scan_probe(
            pptp.ensure_connected(id, &vault).await?,
        ))
    } else {
        None
    };
    manager
        .start_scan(app, request, probe)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn network_ping_start(
    pptp: State<'_, pptp::PptpManager>,
    vault: State<'_, NativeVault>,
    app: tauri::AppHandle,
    manager: State<'_, NetworkManager>,
    request: NetworkPingRequest,
) -> Result<network::NetworkDiagnosticResponse, String> {
    conxol_network::LivePingOptions {
        host: request.host.clone(),
        timeout: diagnostic_timeout(request.timeout_ms)?,
        interval: std::time::Duration::from_millis(request.interval_ms),
        packet_size: request.packet_size,
    }
    .validate()
    .map_err(|e| e.to_string())?;
    if request.pptp_profile_id.is_some() && request.packet_size > 1332 {
        return Err("PPTP Ping payload must fit the tunnel MTU (at most 1332 bytes).".into());
    }
    let connector = if let Some(id) = request.pptp_profile_id {
        pptp_diagnostics::ipv4(&request.host)?;
        Some(pptp.ensure_connected(id, &vault).await?)
    } else {
        None
    };
    manager
        .start_ping(
            app,
            request.host,
            request.timeout_ms,
            request.interval_ms,
            request.packet_size,
            connector,
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn network_mtr_start(
    pptp: State<'_, pptp::PptpManager>,
    vault: State<'_, NativeVault>,
    app: tauri::AppHandle,
    manager: State<'_, NetworkManager>,
    request: NetworkMtrRequest,
) -> Result<network::NetworkDiagnosticResponse, String> {
    conxol_network::TracerouteOptions {
        host: request.host.clone(),
        timeout: diagnostic_timeout(request.timeout_ms)?,
        max_hops: request.max_hops,
    }
    .validate()
    .map_err(|e| e.to_string())?;
    let connector = if let Some(id) = request.pptp_profile_id {
        pptp_diagnostics::ipv4(&request.host)?;
        Some(pptp.ensure_connected(id, &vault).await?)
    } else {
        None
    };
    manager
        .start_mtr(
            app,
            request.host,
            request.timeout_ms,
            request.max_hops,
            connector,
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn network_diagnostic_cancel(
    manager: State<'_, NetworkManager>,
    operation_id: String,
) -> Result<bool, String> {
    manager
        .cancel_diagnostic(&operation_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn network_scan_cancel(
    manager: State<'_, NetworkManager>,
    scan_id: String,
) -> Result<bool, String> {
    manager
        .cancel_scan(&scan_id)
        .map_err(|error| error.to_string())
}

fn expand_user_path(path: &str) -> PathBuf {
    if path == "~" {
        return std::env::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(relative) = path.strip_prefix("~/")
        && let Some(home) = std::env::home_dir()
    {
        return home.join(relative);
    }
    PathBuf::from(path)
}

#[tauri::command]
fn ssh_trust_lookup(
    store: State<'_, Mutex<ssh_trust::SshTrustStore>>,
    host: String,
    port: u16,
) -> Result<Option<String>, String> {
    store
        .lock()
        .map_err(|_| "SSH trust store lock poisoned")?
        .lookup(&host, port)
}

#[tauri::command]
fn ssh_trust_accept(
    store: State<'_, Mutex<ssh_trust::SshTrustStore>>,
    host: String,
    port: u16,
    fingerprint: String,
) -> Result<(), String> {
    store
        .lock()
        .map_err(|_| "SSH trust store lock poisoned")?
        .accept(&host, port, &fingerprint)
}

#[tauri::command]
async fn ssh_branch(
    app: tauri::AppHandle,
    manager: State<'_, SshManager>,
    terminal_id: String,
    cols: u32,
    rows: u32,
) -> Result<ssh::SshBranchResponse, String> {
    manager
        .branch(app, &terminal_id, cols, rows)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_connect(
    app: tauri::AppHandle,
    manager: State<'_, SshManager>,
    vault: State<'_, CredentialResolver>,
    trust: State<'_, Mutex<ssh_trust::SshTrustStore>>,
    mut request: SshConnectRequest,
    auth_events: tauri::ipc::Channel<ssh::SshAuthEvent>,
) -> Result<ssh::SshConnectResponse, String> {
    {
        let trust = trust.lock().map_err(|_| "SSH trust store lock poisoned")?;
        if request.known_hosts_path.is_none() && request.pinned_fingerprint.is_none() {
            request.pinned_fingerprint = trust.lookup(&request.host, request.port)?;
        }
        for jump in &mut request.jump_hosts {
            if jump.known_hosts_path.is_none() && jump.pinned_fingerprint.is_none() {
                jump.pinned_fingerprint = trust.lookup(&jump.host, jump.port)?;
            }
        }
    }
    let vault: Arc<dyn CredentialLookup> = Arc::new(vault.inner().clone());
    manager
        .connect(app, vault, request, auth_events)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ssh_authentication_answer(
    manager: State<'_, SshManager>,
    request_id: String,
    responses: Option<Vec<String>>,
) -> Result<(), String> {
    manager
        .answer_authentication(&request_id, responses)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_write(
    manager: State<'_, SshManager>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    manager
        .write(&terminal_id, data)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_resize(
    manager: State<'_, SshManager>,
    terminal_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    manager
        .resize(&terminal_id, cols, rows)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_close(manager: State<'_, SshManager>, terminal_id: String) -> Result<(), String> {
    manager
        .close(&terminal_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ssh_attach(
    app: tauri::AppHandle,
    manager: State<'_, SshManager>,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .attach(&terminal_id, |data| {
            let _ = app.emit(
                "ssh://output",
                ssh::SshOutputEvent {
                    terminal_id: terminal_id.clone(),
                    data,
                },
            );
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_list_directory(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
) -> Result<Vec<conxol_ssh::RemoteEntry>, String> {
    manager
        .list_directory(&terminal_id, path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_open_remote_text_file(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
    encoding: Option<conxol_ssh::RemoteTextEncoding>,
) -> Result<conxol_ssh::RemoteTextDocument, String> {
    manager
        .open_remote_text_file(&terminal_id, path, encoding.unwrap_or_default())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_collect_remote_monitor(
    manager: State<'_, SshManager>,
    terminal_id: String,
) -> Result<conxol_ssh::RemoteMonitorSnapshot, String> {
    manager
        .collect_remote_monitor(&terminal_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_save_remote_text_file(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
    expected_revision: String,
    content: String,
    encoding: conxol_ssh::RemoteTextEncoding,
) -> Result<conxol_ssh::RemoteTextDocument, String> {
    manager
        .save_remote_text_file(&terminal_id, path, expected_revision, content, encoding)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_save_remote_text_file_as(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
    content: String,
    encoding: conxol_ssh::RemoteTextEncoding,
    overwrite: bool,
) -> Result<conxol_ssh::RemoteTextDocument, String> {
    manager
        .save_remote_text_file_as(&terminal_id, path, content, encoding, overwrite)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_rename_remote(
    manager: State<'_, SshManager>,
    terminal_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    manager
        .rename_remote(&terminal_id, from, to)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_delete_remote(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
) -> Result<(), String> {
    manager
        .delete_remote(&terminal_id, path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_create_remote_directory(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
) -> Result<(), String> {
    manager
        .create_remote_directory(&terminal_id, path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_set_remote_permissions(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
    permissions: u32,
) -> Result<(), String> {
    manager
        .set_remote_permissions(&terminal_id, path, permissions)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_download(
    app: tauri::AppHandle,
    manager: State<'_, SshManager>,
    terminal_id: String,
    request: SshTransferRequest,
) -> Result<ssh::SshTransferResponse, String> {
    manager
        .start_download(app, terminal_id, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_upload(
    app: tauri::AppHandle,
    manager: State<'_, SshManager>,
    terminal_id: String,
    request: SshTransferRequest,
) -> Result<ssh::SshTransferResponse, String> {
    manager
        .start_upload(app, terminal_id, request)
        .await
        .map_err(|error| error.to_string())
}

/// Open an OS destination picker only after an explicit download action.
///
/// The selected path is returned as metadata only. The transfer manager owns
/// all local file creation, temporary files, overwrite policy, and cleanup.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn local_pick_download_path(
    kind: LocalDownloadPickerKind,
    suggested_name: String,
) -> Result<Option<String>, String> {
    let path = match kind {
        LocalDownloadPickerKind::File => rfd::FileDialog::new()
            .set_title("Choose a local download destination")
            .set_file_name(native_picker_file_name(&suggested_name))
            .save_file(),
        LocalDownloadPickerKind::Directory => rfd::FileDialog::new()
            .set_title("Choose a local folder for the download")
            .pick_folder(),
    };
    path.map(|path| {
        path.to_str()
            .map(str::to_owned)
            .ok_or_else(|| "selected path cannot be represented safely".to_owned())
    })
    .transpose()
}

/// Open an OS file picker only after an explicit upload action in the UI.
///
/// This command returns selected path metadata only. It does not read file
/// contents; the native transfer manager opens the selected source later and
/// streams it with its existing validation and cancellation rules.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn local_pick_upload_paths(kind: LocalPickerKind) -> Result<Vec<String>, String> {
    let paths = match kind {
        LocalPickerKind::File => rfd::FileDialog::new()
            .set_title("Select a local file to upload")
            .pick_file()
            .into_iter()
            .collect(),
        LocalPickerKind::Files => rfd::FileDialog::new()
            .set_title("Select local files to upload")
            .pick_files()
            .unwrap_or_default(),
        LocalPickerKind::Directory => rfd::FileDialog::new()
            .set_title("Select a local folder to upload")
            .pick_folder()
            .into_iter()
            .collect(),
    };
    native_picker_paths(paths)
}

#[tauri::command]
fn ssh_cancel_transfer(
    manager: State<'_, SshManager>,
    transfer_id: String,
) -> Result<bool, String> {
    manager
        .cancel_transfer(&transfer_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_start_local_forward(
    app: tauri::AppHandle,
    manager: State<'_, SshManager>,
    terminal_id: String,
    request: SshLocalForwardRequest,
) -> Result<ssh::SshTunnelResponse, String> {
    manager
        .start_local_forward(app, terminal_id, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_start_dynamic_forward(
    app: tauri::AppHandle,
    manager: State<'_, SshManager>,
    terminal_id: String,
    request: SshDynamicForwardRequest,
) -> Result<ssh::SshTunnelResponse, String> {
    manager
        .start_dynamic_forward(app, terminal_id, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ssh_start_remote_forward(
    manager: State<'_, SshManager>,
    terminal_id: String,
    request: SshRemoteForwardRequest,
) -> Result<ssh::SshTunnelResponse, String> {
    manager
        .start_remote_forward(terminal_id, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ssh_cancel_tunnel(manager: State<'_, SshManager>, tunnel_id: String) -> Result<bool, String> {
    manager
        .cancel_tunnel(&tunnel_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn telnet_connect(
    app: tauri::AppHandle,
    manager: State<'_, TelnetManager>,
    request: TelnetConnectRequest,
) -> Result<telnet::TelnetConnectResponse, String> {
    manager
        .connect(app, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn telnet_write(
    manager: State<'_, TelnetManager>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    manager
        .write(&terminal_id, data)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn telnet_resize(
    manager: State<'_, TelnetManager>,
    terminal_id: String,
    columns: u16,
    rows: u16,
) -> Result<(), String> {
    manager
        .resize(&terminal_id, columns, rows)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn telnet_attach(
    app: tauri::AppHandle,
    manager: State<'_, TelnetManager>,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .attach(&terminal_id, |data| {
            let _ = app.emit(
                "telnet://output",
                telnet::TelnetOutputEvent {
                    terminal_id: terminal_id.clone(),
                    data,
                },
            );
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn telnet_close(
    manager: State<'_, TelnetManager>,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .close(&terminal_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn telnet_reconnect(
    manager: State<'_, TelnetManager>,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .reconnect(&terminal_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn serial_connect(
    app: tauri::AppHandle,
    manager: State<'_, SerialManager>,
    request: SerialConnectRequest,
) -> Result<serial::SerialConnectResponse, String> {
    manager
        .connect(app, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn serial_list_devices(
    manager: State<'_, SerialManager>,
) -> Result<Vec<conxol_serial::SerialDeviceInfo>, String> {
    manager
        .list_devices()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn serial_write(
    manager: State<'_, SerialManager>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    manager
        .write(&terminal_id, data)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn serial_attach(
    app: tauri::AppHandle,
    manager: State<'_, SerialManager>,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .attach(&terminal_id, |data| {
            let _ = app.emit(
                "serial://output",
                serial::SerialOutputEvent {
                    terminal_id: terminal_id.clone(),
                    data,
                },
            );
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn serial_close(
    manager: State<'_, SerialManager>,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .close(&terminal_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn serial_reconnect(
    manager: State<'_, SerialManager>,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .reconnect(&terminal_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_spawn(
    app: tauri::AppHandle,
    manager: State<'_, TerminalManager>,
    cols: u16,
    rows: u16,
    target: terminal::LocalTerminalTarget,
) -> Result<String, String> {
    let target_kind = match &target {
        terminal::LocalTerminalTarget::Default { .. } => "default",
        terminal::LocalTerminalTarget::Wsl { .. } => "wsl",
    };
    tracing::debug!(
        target: "conxol::terminal",
        operation = "spawn",
        target_kind,
        cols,
        rows,
    );
    manager
        .spawn(app, cols, rows, target)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn terminal_attach(
    manager: State<'_, TerminalManager>,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .attach(&terminal_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn terminal_list_wsl() -> Result<Vec<String>, String> {
    tracing::debug!(
        target: "conxol::terminal",
        operation = "wsl_discovery",
        platform = std::env::consts::OS,
    );
    terminal::list_wsl_distributions()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn terminal_write(
    manager: State<'_, TerminalManager>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    manager
        .write(&terminal_id, data.into_bytes())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_resize(
    manager: State<'_, TerminalManager>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager
        .resize(&terminal_id, cols, rows)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_close(manager: State<'_, TerminalManager>, terminal_id: String) -> Result<(), String> {
    manager
        .close(&terminal_id)
        .map_err(|error| error.to_string())
}

// Retain established user data on upgrade instead of silently creating an empty profile.
fn compatible_app_data_dir(current: PathBuf) -> PathBuf {
    // WebView may create the new identifier directory for cache before app data exists.
    if !current.join("sessions.json").exists()
        && let Some(parent) = current.parent()
    {
        for identifier in ["com.othmane.termix", "com.othmane.mobarust"] {
            let legacy = parent.join(identifier);
            if legacy.is_dir() {
                return legacy;
            }
        }
    }
    current
}

fn detect_portable_data_dir() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    portable_data_dir_for(&executable)
}

fn portable_data_dir_for(executable: &Path) -> Option<PathBuf> {
    let parent = executable.parent()?;
    let marker = parent.join("portable.flag");
    let metadata = std::fs::symlink_metadata(marker).ok()?;
    metadata
        .file_type()
        .is_file()
        .then(|| parent.join("portable-data"))
}

fn cli_message(argument: Option<&str>) -> Option<String> {
    match argument {
        Some("--version") => Some(format!("Conxol {}", env!("CARGO_PKG_VERSION"))),
        Some("--help") => {
            Some("Conxol desktop application\n  --version  Print the version and exit".to_owned())
        }
        _ => None,
    }
}

async fn finish_native_shutdown(
    ssh: SshManager,
    transfers: FileTransferManager,
    tftp_server: TftpServerManager,
    local: impl std::future::Future<Output = Result<(), terminal::TerminalError>>,
) {
    tftp_server.shutdown().await;
    transfers.shutdown().await;
    ssh.shutdown().await;
    if local.await.is_err() {
        tracing::warn!(event = "local_terminal_shutdown_incomplete");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Same-binary, app-session socket broker: never open Tauri, profiles or the
    // credential vault in the elevated process.
    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    if let Some(code) =
        conxol_pptp::elevation::broker_entry(&std::env::args().skip(1).collect::<Vec<_>>())
    {
        std::process::exit(code);
    }
    if let Some(message) = cli_message(std::env::args().nth(1).as_deref()) {
        println!("{message}");
        return;
    }
    logging::init();
    tracing::info!(
        target: "conxol::runtime",
        event = "runtime_start",
        platform = std::env::consts::OS,
    );
    let builder = tauri::Builder::default().plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|app| {
            let menu = tauri::menu::Menu::default(app)?;
            #[cfg(target_os = "macos")]
            {
                // Cocoa's predefined Quit calls terminate: directly and bypasses
                // ExitRequested. Keep the native menu, but route Quit through exit.
                let items = menu.items()?;
                let app_menu = items
                    .first()
                    .and_then(|item| item.as_submenu())
                    .ok_or_else(|| std::io::Error::other("application menu is missing"))?;
                let quit = app_menu
                    .items()?
                    .pop()
                    .ok_or_else(|| std::io::Error::other("application Quit item is missing"))?;
                let text = quit
                    .as_predefined_menuitem()
                    .ok_or_else(|| {
                        std::io::Error::other("application Quit item is not predefined")
                    })?
                    .text()?;
                if !text.starts_with("Quit ") {
                    return Err(std::io::Error::other("unexpected application Quit item").into());
                }
                app_menu.remove(&quit)?;
                app_menu.append(&tauri::menu::MenuItem::with_id(
                    app,
                    "conxol.quit",
                    text,
                    true,
                    Some("CmdOrCtrl+Q"),
                )?)?;
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "conxol.quit" {
                app.exit(0);
            }
        });
    let desktop = builder
        .manage(TerminalManager::default())
        .manage(SshManager::default())
        .manage(SerialManager::default())
        .manage(NetworkManager::default())
        .manage(FileTransferManager::default())
        .manage(TftpServerManager::default())
        .manage(TelnetManager::default())
        .setup(|app| {
            let portable_dir = detect_portable_data_dir();
            let (data_dir, portable_enabled) = match portable_dir {
                Some(path) => (path, true),
                None => (
                    compatible_app_data_dir(
                        app.path()
                            .app_local_data_dir()
                            .map_err(|error| error.to_string())?,
                    ),
                    false,
                ),
            };
            let base_dir = data_dir;
            let data_dir = backup::resolve_workspace(&base_dir)?;
            app.manage(backup::BackupState::new(base_dir, data_dir.clone()));
            app.manage(Mutex::new(ssh_trust::SshTrustStore::new(
                data_dir.join("ssh-trust.json"),
            )));
            let workspace_security = WorkspaceLock::open(data_dir.join("workspace-lock.json"))?;
            let native_vault = NativeVault(workspace_security.clone());
            let portable_vault = Arc::new(Mutex::new(None));
            app.manage(native_vault.clone());
            app.manage(CredentialResolver {
                native: native_vault,
                portable: Arc::clone(&portable_vault),
            });
            app.manage(PortableVaultState {
                enabled: portable_enabled,
                path: data_dir.join("vault.bin"),
                vault: portable_vault,
            });
            let store = SessionStore::open(data_dir.join("sessions.json"))
                .map_err(|error| error.to_string())?;
            let settings = SettingsStore::open(data_dir.join("settings.json"))
                .map_err(|error| error.to_string())?;
            let snippets = SnippetStore::open(data_dir.join("snippets.json"))
                .map_err(|error| error.to_string())?;
            app.manage(Mutex::new(notes::NoteStore::open(
                data_dir.join("notes.json"),
            )?));
            app.manage(pptp::PptpManager::open(data_dir.join("pptp.json"))?);
            app.manage(pptp_browser::BrowserManager::default());
            let macros = MacroStore::open(data_dir.join("macros.json"))
                .map_err(|error| error.to_string())?;
            let audit =
                AuditStore::open(data_dir.join("audit.json")).map_err(|error| error.to_string())?;
            app.manage(workspace_security);
            workspace_lock::start_idle_monitor(app.handle().clone());
            app.manage(Mutex::new(store));
            app.manage(Mutex::new(settings));
            app.manage(Mutex::new(snippets));
            app.manage(Mutex::new(macros));
            app.manage(Mutex::new(audit));
            Ok(())
        })
        .invoke_handler(|invoke| {
            let caller = invoke.message.webview_ref().label();
            if caller.starts_with("pptp-browser-")
                && (caller.contains("-content")
                    || !matches!(
                        invoke.message.command(),
                        "pptp_browser_navigate" | "pptp_browser_snapshot" | "pptp_browser_control"
                    ))
            {
                invoke
                    .resolver
                    .reject("Browser pages cannot access workspace commands.");
                return true;
            }
            let allowed = invoke
                .message
                .webview_ref()
                .try_state::<WorkspaceLock>()
                .is_some_and(|state| state.allows(invoke.message.command()));
            let backup_allowed = invoke
                .message
                .webview_ref()
                .try_state::<backup::BackupState>()
                .is_none_or(|state| state.allows(invoke.message.command()));
            if !backup_allowed {
                invoke
                    .resolver
                    .reject("Workspace restored. Restart Conxol to continue.");
                return true;
            }
            if !allowed {
                invoke
                    .resolver
                    .reject("Workspace is locked. Enter your PIN to continue.");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                workspace_lock_status,
                workspace_unlock,
                workspace_lock_now,
                workspace_activity,
                workspace_lock_configure,
                pptp::pptp_list,
                pptp::pptp_save,
                pptp::pptp_delete,
                pptp::pptp_connect,
                pptp::pptp_disconnect,
                pptp_browser::pptp_browser_open,
                pptp_browser::pptp_browser_navigate,
                pptp_browser::pptp_browser_snapshot,
                pptp_browser::pptp_browser_control,
                pptp_browser::session_open_web,
                clipboard_read_text,
                clipboard_write_text,
                file_transfer_run,
                file_transfer_cancel,
                tftp_server_start,
                tftp_server_stop,
                tftp_server_status,
                app_snapshot,
                store_updates::store_update_supported,
                store_updates::store_update,
                diagnostic_export,
                diagnostic_export_save,
                workspace_backup_export,
                workspace_backup_choose,
                workspace_backup_inspect,
                workspace_backup_restore,
                workspace_backup_cancel,
                workspace_backup_restart,
                workspace_backup_preferences,
                session_list,
                session_save,
                session_import_openssh,
                session_export,
                session_import,
                session_set_favorite,
                session_touch,
                settings_get,
                settings_save,
                settings_reset,
                settings_export,
                settings_import,
                audit_list,
                audit_record,
                audit_clear,
                vault_put,
                vault_delete,
                portable_vault_status,
                portable_vault_create,
                portable_vault_unlock,
                portable_vault_lock,
                portable_vault_list,
                portable_vault_put,
                portable_vault_delete,
                snippet_list,
                snippet_save,
                snippet_delete,
                notes::note_list,
                notes::note_save,
                notes::note_delete,
                macro_list,
                macro_save,
                macro_delete,
                session_save_ssh,
                session_save_serial,
                session_save_telnet,
                session_delete,
                network_resolve_host,
                network_dns_lookup,
                network_diagnostic_output_export,
                terminal_output_export,
                network_check_tcp,
                ssh_inspect_host_key,
                ssh_trust_lookup,
                ssh_trust_accept,
                network_ping_start,
                network_mtr_start,
                network_diagnostic_cancel,
                network_scan_start,
                network_scan_cancel,
                ssh_connect,
                ssh_branch,
                ssh_authentication_answer,
                ssh_write,
                ssh_resize,
                ssh_close,
                ssh_attach,
                ssh_list_directory,
                ssh_open_remote_text_file,
                ssh_collect_remote_monitor,
                ssh_save_remote_text_file,
                ssh_save_remote_text_file_as,
                ssh_rename_remote,
                ssh_delete_remote,
                ssh_create_remote_directory,
                ssh_set_remote_permissions,
                ssh_download,
                ssh_upload,
                local_pick_upload_paths,
                local_pick_download_path,
                ssh_cancel_transfer,
                ssh_start_local_forward,
                ssh_start_dynamic_forward,
                ssh_start_remote_forward,
                ssh_cancel_tunnel,
                telnet_connect,
                telnet_write,
                telnet_resize,
                telnet_attach,
                telnet_close,
                telnet_reconnect,
                serial_connect,
                serial_list_devices,
                serial_write,
                serial_attach,
                serial_close,
                serial_reconnect,
                terminal_spawn,
                terminal_attach,
                terminal_list_wsl,
                terminal_write,
                terminal_resize,
                terminal_close
            ];
            handler(invoke)
        })
        .build(tauri::generate_context!())
        .expect("error while building Conxol");
    let exit_ready = Arc::new(AtomicBool::new(false));
    let mut exit_pending = false;
    desktop.run(move |app, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" && !exit_ready.load(Ordering::Acquire) => {
            api.prevent_close();
            app.exit(0);
        }
        RunEvent::ExitRequested { api, code, .. } if !exit_ready.load(Ordering::Acquire) => {
            api.prevent_exit();
            if !exit_pending {
                exit_pending = true;
                let _ = app.emit("app://closing", ());
                let server = app.state::<TftpServerManager>().inner().clone();
                let transfers = app.state::<FileTransferManager>().inner().clone();
                transfers.cancel_all();
                let manager = app.state::<SshManager>().inner().clone();
                let pptp = app.state::<pptp::PptpManager>().inner().clone();
                let local_cleanup = app.state::<TerminalManager>().shutdown();
                let app = app.clone();
                let exit_ready = Arc::clone(&exit_ready);
                tauri::async_runtime::spawn(async move {
                    let _ = tokio::task::spawn_blocking(move || pptp.shutdown()).await;
                    finish_native_shutdown(manager, transfers, server, local_cleanup).await;
                    exit_ready.store(true, Ordering::Release);
                    app.exit(code.unwrap_or(0));
                });
            }
        }
        RunEvent::Exit if !exit_ready.load(Ordering::Acquire) => {
            // OS termination may bypass ExitRequested (for example, Dock Quit).
            // The event loop is ending, so finish native cleanup before returning.
            let server = app.state::<TftpServerManager>().inner().clone();
            let transfers = app.state::<FileTransferManager>().inner().clone();
            transfers.cancel_all();
            let manager = app.state::<SshManager>().inner().clone();
            app.state::<pptp::PptpManager>().shutdown();
            let local_cleanup = app.state::<TerminalManager>().shutdown();
            tauri::async_runtime::block_on(finish_native_shutdown(
                manager,
                transfers,
                server,
                local_cleanup,
            ));
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_NATIVE_PICKER_PATHS, cli_message, diagnostic_export, native_picker_file_name,
        native_picker_paths, portable_data_dir_for,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn native_picker_paths_are_bounded_without_opening_the_selected_paths() {
        let selected = (0..MAX_NATIVE_PICKER_PATHS + 4)
            .map(|index| PathBuf::from(format!("/tmp/conxol-picker-{index}")))
            .collect();

        let paths = native_picker_paths(selected).expect("fixture paths are UTF-8");

        assert_eq!(paths.len(), MAX_NATIVE_PICKER_PATHS);
        assert_eq!(
            paths.first().map(String::as_str),
            Some("/tmp/conxol-picker-0")
        );
        assert_eq!(
            paths.last().map(String::as_str),
            Some("/tmp/conxol-picker-15")
        );
    }

    #[test]
    fn network_diagnostic_text_export_preserves_cli_output_and_handles_cancel() {
        let root = tempfile::tempdir().unwrap();
        assert!(!super::save_network_diagnostic_output(None, "snapshot").unwrap());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        let path = root.path().join("scan.txt");
        let content = "PORT SCAN / TCP\n192.0.2.1    22 open\nUTF-8: café → ready\n";
        assert!(super::save_network_diagnostic_output(Some(path.clone()), content).unwrap());
        assert_eq!(std::fs::read_to_string(path).unwrap(), content);
        assert_eq!(
            super::save_network_diagnostic_output(
                Some(root.path().join("missing/report.txt")),
                content
            )
            .unwrap_err(),
            "could not save diagnostic text output; choose a writable destination"
        );
        for tool in ["scan", "ping", "mtr", "dns", "tcp", "ssh"] {
            assert!(super::network_diagnostic_output_tool(tool).is_ok());
        }
        assert!(super::network_diagnostic_output_tool("../report").is_err());
        let too_large = "x".repeat(super::MAX_NETWORK_OUTPUT_EXPORT_BYTES + 1);
        let path = root.path().join("too-large.txt");
        assert!(super::save_network_diagnostic_output(Some(path.clone()), &too_large).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn diagnostic_export_save_writes_only_the_generated_report_and_handles_cancel() {
        let root = tempfile::tempdir().expect("diagnostic fixture");
        assert!(!super::save_diagnostic_export(None).unwrap());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        let output = root.path().join("diagnostics.json");
        assert!(super::save_diagnostic_export(Some(output.clone())).unwrap());
        assert_eq!(
            std::fs::read_to_string(&output).unwrap(),
            diagnostic_export().unwrap()
        );
        // A failed write is visible and must not expose the selected path.
        let failure =
            super::save_diagnostic_export(Some(root.path().join("missing").join("report.json")))
                .unwrap_err();
        assert_eq!(
            failure,
            "could not save diagnostics; choose a writable destination"
        );
    }

    #[test]
    fn diagnostic_export_contains_sanitized_runtime_and_ssh_troubleshooting_data() {
        let report = diagnostic_export().expect("diagnostic export should serialize");
        let value: serde_json::Value =
            serde_json::from_str(&report).expect("diagnostic export should be valid JSON");

        assert_eq!(value["schemaVersion"], 2);
        assert!(value["ssh"]["failures"].is_array());
        assert_eq!(value["ssh"]["maximumFailures"], 64);
        assert!(
            value["sshClientAlgorithms"]["keyExchange"]
                .as_array()
                .is_some_and(|names| !names.is_empty())
        );
        assert_eq!(value["product"], "Conxol");
        assert_eq!(value["platform"], std::env::consts::OS);
        assert_eq!(value["architecture"], std::env::consts::ARCH);
        for forbidden in [
            "fixture-secret",
            "private-key",
            "sessions.json",
            "/Users/",
            "HOME",
            "terminal output",
        ] {
            assert!(
                !report.contains(forbidden),
                "diagnostic export leaked forbidden value: {forbidden}"
            );
        }
    }

    #[test]
    fn rename_preserves_existing_data_but_prefers_an_existing_conxol_directory() {
        let root = tempfile::tempdir().expect("temporary app data");
        let current = root.path().join("com.othmane.conxol");
        let legacy = root.path().join("com.othmane.mobarust");
        assert_eq!(super::compatible_app_data_dir(current.clone()), current);
        std::fs::create_dir(&legacy).unwrap();
        assert_eq!(super::compatible_app_data_dir(current.clone()), legacy);
        std::fs::create_dir(&current).unwrap();
        assert_eq!(super::compatible_app_data_dir(current.clone()), legacy);
        let termix = root.path().join("com.othmane.termix");
        std::fs::create_dir(&termix).unwrap();
        assert_eq!(super::compatible_app_data_dir(current.clone()), termix);
        std::fs::write(current.join("sessions.json"), "{}").unwrap();
        assert_eq!(super::compatible_app_data_dir(current.clone()), current);
    }

    #[test]
    fn cli_version_exits_before_initializing_the_desktop_runtime() {
        assert_eq!(
            cli_message(Some("--version")).as_deref(),
            Some(concat!("Conxol ", env!("CARGO_PKG_VERSION")))
        );
        assert!(cli_message(Some("--help")).is_some());
        assert_eq!(cli_message(Some("--unexpected")), None);
        assert_eq!(cli_message(None), None);
    }

    #[test]
    fn native_picker_suggested_name_is_a_bounded_filename_hint_only() {
        assert_eq!(
            native_picker_file_name("../../remote:name?.txt"),
            "remotename.txt"
        );
        assert_eq!(native_picker_file_name("\n\0"), "download.bin");
        assert!(native_picker_file_name(&"x".repeat(256)).len() <= 128);
    }

    #[test]
    fn portable_mode_requires_a_regular_marker_beside_the_executable() {
        let root = std::env::temp_dir().join(format!(
            "conxol-portable-marker-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create test directory");
        let executable = root.join("conxol");

        assert_eq!(portable_data_dir_for(&executable), None);
        fs::create_dir(root.join("portable.flag")).expect("create marker directory");
        assert_eq!(portable_data_dir_for(&executable), None);
        fs::remove_dir(root.join("portable.flag")).expect("remove marker directory");
        fs::write(root.join("portable.flag"), b"").expect("write marker");
        assert_eq!(
            portable_data_dir_for(&executable),
            Some(root.join("portable-data"))
        );

        fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn sensitive_ipc_payloads_reject_unknown_fields() {
        let vault_payload = serde_json::json!({
            "credentialId": "fixture-password",
            "secret": "fixture-secret",
            "extra": true
        });
        let error = match serde_json::from_value::<super::VaultPutRequest>(vault_payload) {
            Err(error) => error,
            Ok(_) => panic!("vault payload must reject unknown fields"),
        };
        assert!(error.to_string().contains("unknown field"));

        let import_open_ssh_payload = serde_json::json!({
            "path": "fixture-config",
            "extra": true
        });
        let error = serde_json::from_value::<super::ImportOpenSshRequest>(import_open_ssh_payload)
            .expect_err("OpenSSH import payload must reject unknown fields");
        assert!(error.to_string().contains("unknown field"));

        let import_session_payload = serde_json::json!({
            "json": "{}",
            "extra": true
        });
        let error = serde_json::from_value::<super::ImportSessionRequest>(import_session_payload)
            .expect_err("session import payload must reject unknown fields");
        assert!(error.to_string().contains("unknown field"));

        let import_settings_payload = serde_json::json!({
            "json": "{}",
            "extra": true
        });
        let error = serde_json::from_value::<super::ImportSettingsRequest>(import_settings_payload)
            .expect_err("settings import payload must reject unknown fields");
        assert!(error.to_string().contains("unknown field"));

        let audit_payload = serde_json::json!({
            "kind": "sessionOpened",
            "sessionId": null,
            "protocol": "SSH",
            "extra": true
        });
        let error = serde_json::from_value::<super::AuditRecordRequest>(audit_payload)
            .expect_err("audit payload must reject unknown fields");
        assert!(error.to_string().contains("unknown field"));

        let resolve_payload = serde_json::json!({
            "host": "127.0.0.1",
            "timeoutMs": 1000,
            "extra": true
        });
        let error = serde_json::from_value::<super::NetworkResolveRequest>(resolve_payload)
            .expect_err("network resolve payload must reject unknown fields");
        assert!(error.to_string().contains("unknown field"));

        let tcp_check_payload = serde_json::json!({
            "host": "127.0.0.1",
            "port": 22,
            "timeoutMs": 1000,
            "extra": true
        });
        let error = serde_json::from_value::<super::NetworkTcpCheckRequest>(tcp_check_payload)
            .expect_err("TCP check payload must reject unknown fields");
        assert!(error.to_string().contains("unknown field"));

        let traceroute_payload = serde_json::json!({
            "host": "127.0.0.1",
            "timeoutMs": 1000,
            "maxHops": 4,
            "extra": true
        });
        let error = serde_json::from_value::<super::NetworkMtrRequest>(traceroute_payload)
            .expect_err("traceroute payload must reject unknown fields");
        assert!(error.to_string().contains("unknown field"));

        let fingerprint_payload = serde_json::json!({
            "host": "127.0.0.1",
            "port": 22,
            "timeoutMs": 1000,
            "extra": true
        });
        let error = serde_json::from_value::<super::SshFingerprintRequest>(fingerprint_payload)
            .expect_err("fingerprint payload must reject unknown fields");
        assert!(error.to_string().contains("unknown field"));
    }
}

// Android SAF content URIs require a dedicated transfer bridge. Never treat
// them as local paths or silently grant broad shared-storage access.
#[cfg(target_os = "android")]
#[tauri::command]
async fn diagnostic_export_save() -> Result<bool, String> {
    Err("Saving diagnostics to Android shared storage is not available in this preview. Copy the diagnostic text instead.".into())
}
#[cfg(target_os = "android")]
#[tauri::command]
async fn network_diagnostic_output_export(tool: String, content: String) -> Result<bool, String> {
    let _ = (tool, content);
    Err("Android file export is not available in this preview. Copy the report instead.".into())
}
#[cfg(target_os = "android")]
#[tauri::command]
fn local_pick_download_path(
    kind: LocalDownloadPickerKind,
    suggested_name: String,
) -> Result<Option<String>, String> {
    let _ = (kind, suggested_name);
    Err("SFTP downloads to Android shared storage are not available in this preview.".into())
}
#[cfg(target_os = "android")]
#[tauri::command]
fn local_pick_upload_paths(kind: LocalPickerKind) -> Result<Vec<String>, String> {
    let _ = kind;
    Err("SFTP uploads from Android shared storage are not available in this preview.".into())
}
