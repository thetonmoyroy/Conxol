//! Encrypted, bounded workspace snapshots. Tests use only temporary files and a fake vault.
use crate::{PortableVaultState, WorkspaceLock};
use conxol_store::{AuditStore, MacroStore, SessionStore, SettingsStore, SnippetStore};
use conxol_vault::{
    CredentialId, MAX_BACKUP_BYTES, PlatformVault, SecretMaterial, decrypt_workspace_backup,
    encrypt_workspace_backup,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Manager, State};
use zeroize::{Zeroize, Zeroizing};

const FILES: &[&str] = &[
    "sessions.json",
    "settings.json",
    "snippets.json",
    "macros.json",
    "notes.json",
    "audit.json",
    "ssh-trust.json",
    "workspace-lock.json",
    "credential-index.json",
];
const PREFS: &[&str] = &[
    "conxol.sidebarWidth",
    "conxol.sessionFolders",
    "conxol.createdSessionFolders",
    "conxol.folderStyles",
    "conxol-theme",
];
const MAX_FILE: usize = 16 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Archive {
    version: u8,
    files: BTreeMap<String, Vec<u8>>,
    credentials: BTreeMap<String, Zeroizing<String>>,
    attachments: BTreeMap<String, Vec<u8>>,
    preferences: BTreeMap<String, String>,
}
impl Drop for Archive {
    fn drop(&mut self) {
        for bytes in self.files.values_mut().chain(self.attachments.values_mut()) {
            bytes.zeroize();
        }
        for value in self.preferences.values_mut() {
            value.zeroize();
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportRequest {
    password: Zeroizing<String>,
    preferences: BTreeMap<String, String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectRequest {
    password: Zeroizing<String>,
    selection_token: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    token: String,
    sessions: usize,
    notes: usize,
    shortcuts: usize,
    macros: usize,
    credentials: usize,
    key_files: usize,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    workspace_id: String,
    preferences: BTreeMap<String, String>,
}
struct Pending {
    token: String,
    archive: Archive,
}
struct Selection {
    token: String,
    path: PathBuf,
}
#[derive(Serialize)]
pub struct SelectedBackup {
    token: String,
    name: String,
}
pub struct BackupState {
    base: PathBuf,
    active: PathBuf,
    pending: Mutex<Option<Pending>>,
    selection: Mutex<Option<Selection>>,
    busy: AtomicBool,
    committed: AtomicBool,
}
pub(crate) struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl BackupState {
    pub fn new(base: PathBuf, active: PathBuf) -> Self {
        Self {
            base,
            active,
            pending: Mutex::new(None),
            selection: Mutex::new(None),
            busy: AtomicBool::new(false),
            committed: AtomicBool::new(false),
        }
    }
    pub(crate) fn operation(&self) -> Result<Busy<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "A backup operation is already in progress.")?;
        Ok(Busy(&self.busy))
    }
    fn selected_path(&self, token: &str) -> Result<PathBuf, String> {
        self.selection
            .lock()
            .map_err(|_| "Restore is busy.")?
            .as_ref()
            .filter(|selection| selection.token == token)
            .map(|selection| selection.path.clone())
            .ok_or_else(|| error("Choose a backup file first."))
    }
    pub fn track(&self, id: &str, remove: bool) -> Result<(), String> {
        track_credential(&self.active, id, remove)
    }
    pub fn allows(&self, command: &str) -> bool {
        !self.committed.load(Ordering::Acquire) || command == "workspace_backup_restart"
    }
}
fn error(message: &str) -> String {
    message.to_owned()
}
fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let meta =
        fs::symlink_metadata(path).map_err(|_| error("Could not read a required backup file."))?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit as u64 {
        return Err(error(
            "A backup file is too large or is not a regular file.",
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| error("Could not open a backup file."))?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| error("Could not read a backup file."))?;
    if bytes.len() > limit {
        return Err(error("Backup size limit exceeded."));
    }
    Ok(bytes)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid backup destination.")?;
    fs::create_dir_all(parent).map_err(|_| error("Could not create the backup destination."))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| error("Could not prepare the backup file."))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| error("Could not write the backup file."))?;
    temporary
        .persist(path)
        .map_err(|_| error("Could not save the backup file. Choose a writable destination."))?;
    Ok(())
}
/// Resolve only a fixed, validated child directory. A corrupt pointer fails closed.
pub fn resolve_workspace(base: &Path) -> Result<PathBuf, String> {
    let path = base.join("active-workspace.json");
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(base.to_path_buf()),
        Err(_) => return Err(error("Could not read workspace selection.")),
        Ok(_) => {}
    }
    let id: String = serde_json::from_slice(&read_bounded(&path, 1024)?)
        .map_err(|_| error("Workspace selection is invalid."))?;
    let uuid = id
        .strip_prefix("restored-")
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .ok_or("Workspace selection is invalid.")?;
    let child = base.join(format!("restored-{uuid}"));
    let meta =
        fs::symlink_metadata(&child).map_err(|_| error("The restored workspace is missing."))?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(error("Restored workspace path is unsafe."));
    }
    Ok(child)
}
fn validate_preferences(preferences: &BTreeMap<String, String>) -> Result<(), String> {
    if preferences.len() > PREFS.len()
        || preferences
            .iter()
            .any(|(key, value)| !PREFS.contains(&key.as_str()) || value.len() > 100000)
    {
        return Err(error("Backup layout preferences are invalid."));
    }
    Ok(())
}
fn validate_files(directory: &Path) -> Result<(), String> {
    SessionStore::open(directory.join("sessions.json"))
        .map_err(|_| error("Backup sessions are invalid."))?;
    SettingsStore::open(directory.join("settings.json"))
        .map_err(|_| error("Backup settings are invalid."))?;
    SnippetStore::open(directory.join("snippets.json"))
        .map_err(|_| error("Backup shortcuts are invalid."))?;
    MacroStore::open(directory.join("macros.json"))
        .map_err(|_| error("Backup macros are invalid."))?;
    AuditStore::open(directory.join("audit.json"))
        .map_err(|_| error("Backup audit data is invalid."))?;
    crate::notes::NoteStore::open(directory.join("notes.json"))
        .map_err(|_| error("Backup notes are invalid."))?;
    WorkspaceLock::open(directory.join("workspace-lock.json"))?;
    if directory.join("ssh-trust.json").exists() {
        crate::ssh_trust::SshTrustStore::new(directory.join("ssh-trust.json")).validate_backup()?;
    }
    Ok(())
}
fn stage_files(archive: &Archive, directory: &Path) -> Result<(), String> {
    if archive.version != 1
        || archive.files.len() > FILES.len()
        || archive.credentials.len() > 4096
        || archive.attachments.len() > 4096
    {
        return Err(error("Unsupported or oversized workspace backup."));
    }
    validate_preferences(&archive.preferences)?;
    for (name, bytes) in &archive.files {
        if !FILES.contains(&name.as_str()) || bytes.len() > MAX_FILE {
            return Err(error("Backup contains an invalid workspace file."));
        }
        atomic_write(&directory.join(name), bytes)?;
    }
    for (id, secret) in &archive.credentials {
        CredentialId::new(id.clone())
            .map_err(|_| error("Backup credential references are invalid."))?;
        if secret.len() > conxol_vault::MAX_SECRET_BYTES {
            return Err(error("Backup credential is too large."));
        }
    }
    for (id, bytes) in &archive.attachments {
        if uuid::Uuid::parse_str(id)
            .ok()
            .is_none_or(|uuid| uuid.to_string() != *id)
            || bytes.len() > 4 * 1024 * 1024
        {
            return Err(error("Backup key file is invalid or too large."));
        }
    }
    credential_index(directory)?;
    validate_files(directory)
}
fn visit_strings(
    value: &mut serde_json::Value,
    action: &mut impl FnMut(&str, &mut String) -> Result<(), String>,
) -> Result<(), String> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                if let serde_json::Value::String(text) = value {
                    action(key, text)?;
                } else {
                    visit_strings(value, action)?;
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                visit_strings(item, action)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn is_credential_field(key: &str) -> bool {
    matches!(key, "credentialRef" | "credential_ref")
}
fn is_key_field(key: &str) -> bool {
    matches!(key, "keyRef" | "key_ref" | "known_hosts_path")
}
fn credential_index(directory: &Path) -> Result<BTreeSet<String>, String> {
    let path = directory.join("credential-index.json");
    if !path.exists() {
        return Ok(BTreeSet::new());
    }
    let ids: BTreeSet<String> = serde_json::from_slice(&read_bounded(&path, 1024 * 1024)?)
        .map_err(|_| error("Credential index is invalid."))?;
    if ids.len() > 4096 || ids.iter().any(|id| CredentialId::new(id.clone()).is_err()) {
        return Err(error("Credential index is invalid."));
    }
    Ok(ids)
}
pub fn track_credential(directory: &Path, id: &str, remove: bool) -> Result<(), String> {
    let mut ids = credential_index(directory)?;
    if remove {
        ids.remove(id);
    } else {
        ids.insert(id.to_owned());
    }
    atomic_write(
        &directory.join("credential-index.json"),
        &serde_json::to_vec(&ids).map_err(|_| error("Could not save credential index."))?,
    )
}
fn check_budget(total: usize) -> Result<(), String> {
    // JSON encodes byte arrays as decimal numbers. Reserve for that expansion
    // before reading another attachment or serializing the complete snapshot.
    if total > (MAX_BACKUP_BYTES - 2 * 1024 * 1024) / 4 {
        return Err(error("Workspace backup exceeds its 64 MiB archive limit."));
    }
    Ok(())
}
fn snapshot(
    directory: &Path,
    preferences: BTreeMap<String, String>,
    ids: Vec<String>,
    mut get: impl FnMut(&str) -> Result<SecretMaterial, String>,
) -> Result<Archive, String> {
    validate_preferences(&preferences)?;
    validate_files(directory)?;
    let mut total = 0usize;
    let mut archive = Archive {
        version: 1,
        files: BTreeMap::new(),
        credentials: BTreeMap::new(),
        attachments: BTreeMap::new(),
        preferences,
    };
    for name in FILES {
        let path = directory.join(name);
        if path.exists() {
            let bytes = read_bounded(&path, MAX_FILE)?;
            total += bytes.len();
            check_budget(total)?;
            archive.files.insert((*name).to_owned(), bytes);
        }
    }
    let mut ids: BTreeSet<_> = ids.into_iter().collect();
    ids.extend(credential_index(directory)?);
    if let Some(bytes) = archive.files.get_mut("sessions.json") {
        let mut sessions: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|_| error("Could not read saved sessions."))?;
        let mut paths: BTreeMap<String, String> = BTreeMap::new();
        visit_strings(&mut sessions, &mut |key, text| {
            if is_credential_field(key) && !text.is_empty() {
                ids.insert(text.clone());
            }
            if is_key_field(key) && !text.is_empty() {
                let id = if let Some(id) = paths.get(text) {
                    id.clone()
                } else {
                    let id = uuid::Uuid::new_v4().to_string();
                    let data = read_bounded(Path::new(text), 4 * 1024 * 1024)?;
                    total += data.len();
                    check_budget(total)?;
                    archive.attachments.insert(id.clone(), data);
                    paths.insert(text.clone(), id.clone());
                    id
                };
                *text = format!("backup-file:{id}");
            }
            Ok(())
        })?;
        *bytes = serde_json::to_vec(&sessions)
            .map_err(|_| error("Could not encode backup sessions."))?;
    }
    if ids.len() > 4096 {
        return Err(error("Too many saved credentials for one backup."));
    }
    for id in ids {
        CredentialId::new(id.clone())
            .map_err(|_| error("A saved credential reference is invalid."))?;
        let secret = get(&id)?.into_zeroizing();
        total += secret.len();
        check_budget(total)?;
        archive.credentials.insert(id.clone(), secret);
    }
    Ok(archive)
}
fn preview(archive: &Archive, token: String) -> Preview {
    let count = |file: &str, key: Option<&str>| -> usize {
        archive
            .files
            .get(file)
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(bytes).ok())
            .and_then(|value| match key {
                Some(key) => value
                    .get(key)
                    .and_then(|items| items.as_array())
                    .map(Vec::len),
                None => value.as_array().map(Vec::len),
            })
            .unwrap_or(0)
    };
    Preview {
        token,
        sessions: count("sessions.json", Some("sessions")),
        notes: count("notes.json", None),
        shortcuts: count("snippets.json", Some("snippets")),
        macros: count("macros.json", Some("macros")),
        credentials: archive.credentials.len(),
        key_files: archive.attachments.len(),
    }
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn workspace_backup_export(
    app: tauri::AppHandle,
    request: ExportRequest,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BackupState>(); let _operation = state.operation()?;
        let path = rfd::FileDialog::new().set_title("Save encrypted workspace backup").add_filter("Conxol encrypted backup", &["cxb"]).set_file_name("conxol-workspace.cxb").save_file();
        let Some(path) = path else { return Ok(false); };
        if app.state::<WorkspaceLock>().is_locked() { return Err(error("Unlock the workspace before backing up.")); }
        if path.extension().is_none_or(|extension| !extension.eq_ignore_ascii_case("cxb")) { return Err(error("Use the .cxb extension for encrypted workspace backups.")); }
        fs::create_dir_all(&state.base).map_err(|_| error("Could not read workspace folder."))?;
        let parent = path.parent().and_then(|parent| parent.canonicalize().ok()).ok_or("Invalid backup destination.")?;
        if parent.starts_with(state.base.canonicalize().map_err(|_| error("Could not read workspace folder."))?) { return Err(error("Choose a backup destination outside the workspace data folder.")); }
        // Hold store mutation locks while taking the coherent workspace snapshot.
        let sessions = app.state::<Mutex<SessionStore>>(); let _sessions = sessions.lock().map_err(|_| "Sessions are busy.")?;
        let settings = app.state::<Mutex<SettingsStore>>(); let _settings = settings.lock().map_err(|_| "Settings are busy.")?;
        let snippets = app.state::<Mutex<SnippetStore>>(); let _snippets = snippets.lock().map_err(|_| "Shortcuts are busy.")?;
        let macros = app.state::<Mutex<MacroStore>>(); let _macros = macros.lock().map_err(|_| "Macros are busy.")?;
        let notes = app.state::<Mutex<crate::notes::NoteStore>>(); let _notes = notes.lock().map_err(|_| "Notes are busy.")?;
        let audit = app.state::<Mutex<AuditStore>>(); let _audit = audit.lock().map_err(|_| "Audit is busy.")?;
        let portable = app.state::<PortableVaultState>(); let portable = portable.vault.lock().map_err(|_| "Vault is busy.")?;
        if app.state::<PortableVaultState>().path.exists() && portable.is_none() { return Err(error("Unlock the encrypted vault before making a full backup.")); }
        let platform = app.state::<PlatformVault>();
        let mut ids = platform.list_ids().map_err(|_| error("Could not enumerate saved credentials. Backup was not created."))?;
        if let Some(vault) = portable.as_ref() { ids.extend(vault.list_ids()); }
        let archive = snapshot(&state.active, request.preferences, ids, |id| {
            let id = CredentialId::new(id).map_err(|_| error("Invalid credential reference."))?;
            if let Some(vault) = portable.as_ref() { match vault.get(&id) { Ok(secret) => return Ok(secret), Err(conxol_vault::VaultError::PortableCredentialMissing(_)) => {}, Err(_) => return Err(error("Could not read saved credentials. Backup was not created.")) } }
            platform.get(&id).map_err(|_| error("A saved password could not be read. Resolve missing or locked credentials before backing up."))
        })?;
        let plaintext = Zeroizing::new(serde_json::to_vec(&archive).map_err(|_| error("Could not encode workspace backup."))?);
        let password = SecretMaterial::from_zeroizing(request.password);
        let encrypted = encrypt_workspace_backup(&plaintext, &password).map_err(|_| error("Could not encrypt the backup. Use an 8–1024 byte password and a workspace under 64 MiB."))?;
        atomic_write(&path, &encrypted)?;
        Ok(true)
    }).await.map_err(|_| error("Backup task did not complete."))?
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn workspace_backup_choose(
    app: tauri::AppHandle,
) -> Result<Option<SelectedBackup>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BackupState>();
        let _operation = state.operation()?;
        let path = rfd::FileDialog::new()
            .set_title("Choose workspace backup file")
            .add_filter("Conxol encrypted backup", &["cxb"])
            .pick_file();
        let Some(path) = path else {
            return Ok(None);
        };
        let meta = fs::symlink_metadata(&path)
            .map_err(|_| error("Could not open the selected backup file."))?;
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.len() > (MAX_BACKUP_BYTES + 52) as u64
        {
            return Err(error("Choose a regular Conxol backup file under 64 MiB."));
        }
        let token = uuid::Uuid::new_v4().to_string();
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or("Invalid backup filename.")?;
        *state.pending.lock().map_err(|_| "Restore is busy.")? = None;
        *state.selection.lock().map_err(|_| "Restore is busy.")? = Some(Selection {
            token: token.clone(),
            path,
        });
        Ok(Some(SelectedBackup { token, name }))
    })
    .await
    .map_err(|_| error("Could not open the backup file chooser."))?
}
#[tauri::command]
pub async fn workspace_backup_inspect(
    app: tauri::AppHandle,
    request: InspectRequest,
) -> Result<Option<Preview>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BackupState>();
        let _operation = state.operation()?;
        *state.pending.lock().map_err(|_| "Restore is busy.")? = None;
        let path = state.selected_path(&request.selection_token)?;
        let encrypted = read_bounded(&path, MAX_BACKUP_BYTES + 52)?;
        let password = SecretMaterial::from_zeroizing(request.password);
        let plaintext = decrypt_workspace_backup(&encrypted, &password).map_err(|_| {
            error("Incorrect backup password, damaged file, or unsupported backup format.")
        })?;
        let archive: Archive = serde_json::from_slice(&plaintext)
            .map_err(|_| error("Workspace backup is invalid."))?;
        let stage =
            tempfile::tempdir().map_err(|_| error("Could not validate workspace backup."))?;
        stage_files(&archive, stage.path())?;
        let token = uuid::Uuid::new_v4().to_string();
        let result = preview(&archive, token.clone());
        *state.pending.lock().map_err(|_| "Restore is busy.")? = Some(Pending { token, archive });
        Ok(Some(result))
    })
    .await
    .map_err(|_| error("Restore preview did not complete."))?
}
#[tauri::command]
pub fn workspace_backup_cancel(state: State<'_, BackupState>) -> Result<(), String> {
    *state.pending.lock().map_err(|_| "Restore is busy.")? = None;
    *state.selection.lock().map_err(|_| "Restore is busy.")? = None;
    Ok(())
}

trait RestoreVault {
    fn put(&self, id: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, id: &str);
}
impl RestoreVault for PlatformVault {
    fn put(&self, id: &str, secret: &str) -> Result<(), String> {
        self.put(
            &CredentialId::new(id).map_err(|_| error("Invalid restored credential reference."))?,
            &SecretMaterial::new(secret),
        )
        .map_err(|_| error("Could not restore a saved password to the system vault."))
    }
    fn delete(&self, id: &str) {
        if let Ok(id) = CredentialId::new(id) {
            let _ = self.delete(&id);
        }
    }
}
fn apply_archive(
    base: &Path,
    archive: &Archive,
    vault: &impl RestoreVault,
) -> Result<Preferences, String> {
    fs::create_dir_all(base).map_err(|_| error("Could not prepare restored workspace."))?;
    let stage = tempfile::Builder::new()
        .prefix(".workspace-restore-")
        .tempdir_in(base)
        .map_err(|_| error("Could not prepare restored workspace."))?;
    stage_files(archive, stage.path())?;
    let workspace_id = format!("restored-{}", uuid::Uuid::new_v4());
    let final_path = base.join(&workspace_id);
    let mut remap = BTreeMap::new();
    for id in archive.credentials.keys() {
        remap.insert(id.clone(), format!("restored-{}", uuid::Uuid::new_v4()));
    }
    let keys = stage.path().join("keys");
    for (id, bytes) in &archive.attachments {
        atomic_write(&keys.join(id), bytes)?;
    }
    let sessions_path = stage.path().join("sessions.json");
    if sessions_path.exists() {
        let mut sessions: serde_json::Value =
            serde_json::from_slice(&read_bounded(&sessions_path, MAX_FILE)?)
                .map_err(|_| error("Restored sessions are invalid."))?;
        visit_strings(&mut sessions, &mut |key, text| {
            if is_credential_field(key) && !text.is_empty() {
                *text = remap
                    .get(text)
                    .ok_or("Backup is missing a saved password.")?
                    .clone();
            }
            if is_key_field(key) && !text.is_empty() {
                let id = text
                    .strip_prefix("backup-file:")
                    .ok_or("Backup key file reference is invalid.")?;
                if !archive.attachments.contains_key(id) {
                    return Err(error("Backup is missing a key file."));
                }
                *text = final_path
                    .join("keys")
                    .join(id)
                    .to_str()
                    .ok_or("Restored key path is invalid.")?
                    .to_owned();
            }
            Ok(())
        })?;
        atomic_write(
            &sessions_path,
            &serde_json::to_vec(&sessions).map_err(|_| error("Could not restore sessions."))?,
        )?;
    }
    atomic_write(
        &stage.path().join("credential-index.json"),
        &serde_json::to_vec(&remap.values().collect::<Vec<_>>())
            .map_err(|_| error("Could not restore credentials."))?,
    )?;
    let preferences = Preferences {
        workspace_id: workspace_id.clone(),
        preferences: archive.preferences.clone(),
    };
    atomic_write(
        &stage.path().join("ui-preferences.json"),
        &serde_json::to_vec(&preferences)
            .map_err(|_| error("Could not restore layout preferences."))?,
    )?;
    validate_files(stage.path())?;
    let mut created = Vec::new();
    let result = (|| {
        for (old, new) in &remap {
            vault.put(new, &archive.credentials[old])?;
            created.push(new.clone());
        }
        fs::rename(stage.path(), &final_path)
            .map_err(|_| error("Could not finish restored workspace."))?;
        atomic_write(
            &base.join("active-workspace.json"),
            &serde_json::to_vec(&workspace_id)
                .map_err(|_| error("Could not activate restored workspace."))?,
        )?;
        Ok(preferences)
    })();
    if result.is_err() {
        for id in &created {
            vault.delete(id);
        }
        // This path is generated here, never taken from archive contents.
        if final_path.parent() == Some(base)
            && final_path.file_name().and_then(|name| name.to_str()) == Some(workspace_id.as_str())
        {
            let _ = fs::remove_dir_all(&final_path);
        }
    }
    result
}
#[tauri::command]
pub async fn workspace_backup_restore(
    app: tauri::AppHandle,
    token: String,
) -> Result<Preferences, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BackupState>();
        let _operation = state.operation()?;
        if app.state::<WorkspaceLock>().is_locked() {
            return Err(error("Unlock the workspace before restoring."));
        }
        let mut pending = state.pending.lock().map_err(|_| "Restore is busy.")?;
        let candidate = pending
            .as_ref()
            .filter(|item| item.token == token)
            .ok_or("Restore preview expired. Open the backup again.")?;
        let preferences = apply_archive(
            &state.base,
            &candidate.archive,
            app.state::<PlatformVault>().inner(),
        )?;
        *pending = None;
        state.committed.store(true, Ordering::Release);
        Ok(preferences)
    })
    .await
    .map_err(|_| error("Workspace restore did not complete."))?
}
#[tauri::command]
pub fn workspace_backup_restart(
    app: tauri::AppHandle,
    state: State<'_, BackupState>,
) -> Result<(), String> {
    if !state.committed.load(Ordering::Acquire) {
        return Err(error(
            "No completed workspace restore is waiting to restart.",
        ));
    }
    app.restart();
}
#[tauri::command]
pub fn workspace_backup_preferences(
    state: State<'_, BackupState>,
) -> Result<Option<Preferences>, String> {
    let path = state.active.join("ui-preferences.json");
    if !path.exists() {
        return Ok(None);
    }
    let preferences: Preferences = serde_json::from_slice(&read_bounded(&path, 1024 * 1024)?)
        .map_err(|_| error("Restored layout preferences are invalid."))?;
    validate_preferences(&preferences.preferences)?;
    Ok(Some(preferences))
}

#[cfg(test)]
mod tests {
    use super::*;
    use conxol_core::{MacroAction, MacroRecord, SessionRecord, SnippetRecord};
    use std::sync::atomic::AtomicUsize;
    #[derive(Default)]
    struct FakeVault {
        entries: Mutex<BTreeMap<String, String>>,
        writes: AtomicUsize,
        fail_at: Option<usize>,
    }
    impl RestoreVault for FakeVault {
        fn put(&self, id: &str, secret: &str) -> Result<(), String> {
            let index = self.writes.fetch_add(1, Ordering::SeqCst) + 1;
            if self.fail_at == Some(index) {
                return Err("Synthetic vault failure".into());
            }
            self.entries
                .lock()
                .unwrap()
                .insert(id.to_owned(), secret.to_owned());
            Ok(())
        }
        fn delete(&self, id: &str) {
            self.entries.lock().unwrap().remove(id);
        }
    }
    fn source(root: &Path) {
        let key = root.join("fixture-key");
        fs::write(&key, b"synthetic-key-file-not-a-real-key").unwrap();
        let hosts = root.join("fixture-known-hosts");
        fs::write(&hosts, b"synthetic-known-hosts-fixture").unwrap();
        let session: SessionRecord = serde_json::from_value(serde_json::json!({
            "id": uuid::Uuid::new_v4(), "name": "Fixture switch", "protocol": "SSH", "hostname": "fixture.example.test", "port": 22, "username": "fixture-user",
            "auth": { "kind": "privateKey", "keyRef": key.to_str().unwrap(), "credentialRef": "key-passphrase" },
            "folder": "Lab", "tags": ["test"], "favorite": true, "jump_hosts": [], "notes": "fixture session note", "known_hosts_path": hosts.to_str().unwrap(),
            "jump_host_profiles": [{ "host": "jump.example.test", "port": 22, "username": "fixture", "auth": { "kind": "password", "credentialRef": "jump-password" } }]
        })).unwrap();
        SessionStore::open(root.join("sessions.json"))
            .unwrap()
            .save(session)
            .unwrap();
        SettingsStore::open(root.join("settings.json"))
            .unwrap()
            .save(conxol_core::AppSettings::default())
            .unwrap();
        let mut snippet = SnippetRecord::new("Fixture shortcut", "show interfaces");
        snippet.tags = vec!["conxol:shortcut".into()];
        SnippetStore::open(root.join("snippets.json"))
            .unwrap()
            .save(snippet)
            .unwrap();
        let mut record = MacroRecord::new("Fixture macro");
        record.actions.push(MacroAction::SendText {
            text: "show version".into(),
        });
        MacroStore::open(root.join("macros.json"))
            .unwrap()
            .save(record)
            .unwrap();
        fs::write(root.join("notes.json"), serde_json::to_vec(&serde_json::json!([{ "id": uuid::Uuid::new_v4(), "name": "Fixture note", "vendor": "Lab", "content": "fixture-note-text" }])).unwrap()).unwrap();
        fs::write(root.join("ssh-trust.json"), br#"{"hosts":{"[fixture.example.test]:22":"SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}"#).unwrap();
        fs::write(root.join("workspace-lock.json"), b"null").unwrap();
        track_credential(root, "orphan-password", false).unwrap();
    }
    fn make_archive(root: &Path) -> Archive {
        snapshot(
            root,
            BTreeMap::from([("conxol.folderStyles".into(), "{}".into())]),
            vec!["vault-only-password".into()],
            |id| Ok(SecretMaterial::new(format!("synthetic-secret-{id}"))),
        )
        .unwrap()
    }
    #[test]
    fn encrypted_full_workspace_roundtrip_preserves_data_and_password_bindings() {
        let src = tempfile::tempdir().unwrap();
        source(src.path());
        let archive = make_archive(src.path());
        let password = SecretMaterial::new("fixture-backup-password");
        let plain = Zeroizing::new(serde_json::to_vec(&archive).unwrap());
        let encrypted = encrypt_workspace_backup(&plain, &password).unwrap();
        for forbidden in [
            "synthetic-secret",
            "fixture-note-text",
            "fixture.example.test",
            "synthetic-key-file",
        ] {
            assert!(
                !encrypted
                    .windows(forbidden.len())
                    .any(|window| window == forbidden.as_bytes())
            );
        }
        let decrypted = decrypt_workspace_backup(&encrypted, &password).unwrap();
        let decoded: Archive = serde_json::from_slice(&decrypted).unwrap();
        let overview = preview(&decoded, "fixture".into());
        assert_eq!(
            (
                overview.sessions,
                overview.notes,
                overview.shortcuts,
                overview.macros,
                overview.credentials,
                overview.key_files
            ),
            (1, 1, 1, 1, 4, 2)
        );
        let dst = tempfile::tempdir().unwrap();
        fs::write(dst.path().join("old-note.txt"), b"keep-current-workspace").unwrap();
        let vault = FakeVault::default();
        let preferences = apply_archive(dst.path(), &decoded, &vault).unwrap();
        let active = resolve_workspace(dst.path()).unwrap();
        assert_ne!(active, dst.path());
        assert_eq!(
            active.file_name().unwrap().to_str().unwrap(),
            preferences.workspace_id
        );
        assert_eq!(
            fs::read(dst.path().join("old-note.txt")).unwrap(),
            b"keep-current-workspace"
        );
        let restored = SessionStore::open(active.join("sessions.json")).unwrap();
        let session = &restored.list()[0];
        let conxol_core::AuthMethod::PrivateKey {
            key_ref,
            credential_ref: Some(reference),
        } = &session.auth
        else {
            panic!("lost auth method");
        };
        assert!(Path::new(key_ref).starts_with(&active));
        assert_eq!(
            fs::read(key_ref).unwrap(),
            b"synthetic-key-file-not-a-real-key"
        );
        assert_eq!(
            vault.entries.lock().unwrap().get(reference).unwrap(),
            "synthetic-secret-key-passphrase"
        );
        assert_eq!(
            fs::read(session.known_hosts_path.as_ref().unwrap()).unwrap(),
            b"synthetic-known-hosts-fixture"
        );
        assert_eq!(
            fs::read(active.join("notes.json")).unwrap(),
            fs::read(src.path().join("notes.json")).unwrap()
        );
        assert_eq!(
            SnippetStore::open(active.join("snippets.json"))
                .unwrap()
                .list()
                .len(),
            1
        );
        assert_eq!(
            MacroStore::open(active.join("macros.json"))
                .unwrap()
                .list()
                .len(),
            1
        );
        assert_eq!(credential_index(&active).unwrap().len(), 4);
    }
    #[test]
    fn wrong_password_tamper_truncation_and_format_are_rejected() {
        let password = SecretMaterial::new("fixture-backup-password");
        let encrypted = encrypt_workspace_backup(b"fixture", &password).unwrap();
        assert!(
            decrypt_workspace_backup(&encrypted, &SecretMaterial::new("wrong-password")).is_err()
        );
        for index in [0, 8, 24, 36, encrypted.len() - 1] {
            let mut changed = encrypted.clone();
            changed[index] ^= 1;
            assert!(decrypt_workspace_backup(&changed, &password).is_err());
        }
        for length in [0, 8, 35, 51] {
            assert!(decrypt_workspace_backup(&encrypted[..length], &password).is_err());
        }
        assert_ne!(
            encrypted,
            encrypt_workspace_backup(b"fixture", &password).unwrap(),
            "every backup needs fresh salt and nonce"
        );
        assert!(encrypt_workspace_backup(b"fixture", &SecretMaterial::new("short")).is_err());
    }
    #[test]
    fn archive_paths_versions_and_preferences_are_validated_before_any_vault_write() {
        let src = tempfile::tempdir().unwrap();
        source(src.path());
        let mut archive = make_archive(src.path());
        let dst = tempfile::tempdir().unwrap();
        let vault = FakeVault::default();
        archive.files.insert("../escape.json".into(), vec![]);
        assert!(apply_archive(dst.path(), &archive, &vault).is_err());
        archive.files.remove("../escape.json");
        archive.version = 99;
        assert!(apply_archive(dst.path(), &archive, &vault).is_err());
        archive.version = 1;
        archive
            .preferences
            .insert("arbitrary-local-storage".into(), "secret".into());
        assert!(apply_archive(dst.path(), &archive, &vault).is_err());
        archive.preferences.remove("arbitrary-local-storage");
        archive.attachments.insert("../key".into(), vec![]);
        assert!(apply_archive(dst.path(), &archive, &vault).is_err());
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
        assert!(!dst.path().join("active-workspace.json").exists());
    }
    #[test]
    fn invalid_notes_sessions_and_missing_attachments_leave_workspace_unchanged() {
        let src = tempfile::tempdir().unwrap();
        source(src.path());
        let mut archive = make_archive(src.path());
        let dst = tempfile::tempdir().unwrap();
        let vault = FakeVault::default();
        let original = archive.files["notes.json"].clone();
        archive
            .files
            .insert("notes.json".into(), b"not-json".to_vec());
        assert!(apply_archive(dst.path(), &archive, &vault).is_err());
        archive.files.insert("notes.json".into(), original);
        let original = archive.files["sessions.json"].clone();
        archive.files.insert("sessions.json".into(), b"{}".to_vec());
        assert!(apply_archive(dst.path(), &archive, &vault).is_err());
        archive.files.insert("sessions.json".into(), original);
        archive.attachments.clear();
        assert!(apply_archive(dst.path(), &archive, &vault).is_err());
        assert_eq!(vault.writes.load(Ordering::SeqCst), 0);
        assert_eq!(resolve_workspace(dst.path()).unwrap(), dst.path());
    }
    #[test]
    fn vault_failure_rolls_back_new_secrets_and_keeps_the_original_workspace() {
        let src = tempfile::tempdir().unwrap();
        source(src.path());
        let archive = make_archive(src.path());
        let dst = tempfile::tempdir().unwrap();
        let vault = FakeVault {
            fail_at: Some(2),
            ..Default::default()
        };
        vault
            .entries
            .lock()
            .unwrap()
            .insert("existing".into(), "keep-existing".into());
        assert!(apply_archive(dst.path(), &archive, &vault).is_err());
        assert_eq!(vault.entries.lock().unwrap().len(), 1);
        assert_eq!(resolve_workspace(dst.path()).unwrap(), dst.path());
    }
    #[test]
    fn activation_write_failure_rolls_back_new_secrets() {
        let src = tempfile::tempdir().unwrap();
        source(src.path());
        let archive = make_archive(src.path());
        let dst = tempfile::tempdir().unwrap();
        let vault = FakeVault::default();
        fs::create_dir(dst.path().join("active-workspace.json")).unwrap();
        assert!(apply_archive(dst.path(), &archive, &vault).is_err());
        assert!(vault.entries.lock().unwrap().is_empty());
    }
    #[test]
    fn missing_saved_passwords_fail_backup_instead_of_silently_omitting_them() {
        let src = tempfile::tempdir().unwrap();
        source(src.path());
        assert!(
            snapshot(src.path(), BTreeMap::new(), vec![], |_| Err(
                "Fixture password unavailable".into()
            ))
            .is_err()
        );
    }
    #[test]
    fn workspace_selector_rejects_escapes_and_unknown_layout_data() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(resolve_workspace(root.path()).unwrap(), root.path());
        for value in ["../outside", "C:\\outside", "restored-invalid"] {
            fs::write(
                root.path().join("active-workspace.json"),
                serde_json::to_vec(value).unwrap(),
            )
            .unwrap();
            assert!(resolve_workspace(root.path()).is_err());
        }
        assert!(
            validate_preferences(&BTreeMap::from([(
                "conxol.sidebarWidth".into(),
                "x".repeat(100001)
            )]))
            .is_err()
        );
        assert!(check_budget(MAX_BACKUP_BYTES).is_err());
    }
    #[test]
    fn file_choice_is_bound_to_native_selection_and_rejects_stale_tokens() {
        let root = tempfile::tempdir().unwrap();
        let state = BackupState::new(root.path().into(), root.path().into());
        assert!(state.selected_path("missing").is_err());
        let path = root.path().join("fixture.cxb");
        *state.selection.lock().unwrap() = Some(Selection {
            token: "native-selection".into(),
            path: path.clone(),
        });
        assert_eq!(state.selected_path("native-selection").unwrap(), path);
        assert!(state.selected_path("stale-selection").is_err());
        let request = serde_json::json!({ "password": "fixture-password", "selectionToken": "native-selection", "path": "arbitrary-file" });
        assert!(
            serde_json::from_value::<InspectRequest>(request).is_err(),
            "renderer must not choose an arbitrary native read path"
        );
        let request = serde_json::json!({ "password": "fixture-password", "selectionToken": "native-selection" });
        assert!(serde_json::from_value::<InspectRequest>(request).is_ok());
    }

    #[test]
    fn completed_restore_blocks_old_workspace_mutations_until_restart() {
        let root = tempfile::tempdir().unwrap();
        let state = BackupState::new(root.path().into(), root.path().into());
        assert!(state.allows("session_save"));
        state.committed.store(true, Ordering::Release);
        assert!(!state.allows("session_save"));
        assert!(!state.allows("vault_put"));
        assert!(state.allows("workspace_backup_restart"));
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn workspace_backup_export(app: tauri::AppHandle, request: ExportRequest) -> Result<bool, String> {
    let _ = (app, request);
    Err("Android workspace backup export is not available in this preview.".into())
}
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn workspace_backup_choose(app: tauri::AppHandle) -> Result<Option<SelectedBackup>, String> {
    let _ = app;
    Err("Android workspace backup import is not available in this preview.".into())
}
