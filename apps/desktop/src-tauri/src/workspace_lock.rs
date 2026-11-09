use argon2::{Algorithm, Argon2, Params, Version};
use conxol_vault::{
    CredentialId, CredentialLookup, EncryptedCredentials, SecretMaterial, VaultError,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
use tauri::{Emitter, Manager, State};
use zeroize::Zeroizing;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Policy {
    version: u8,
    salt: [u8; 16],
    hash: [u8; 32],
    idle_minutes: u32,
    failures: u32,
    retry_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    vault: Option<Vec<u8>>,
}
struct Inner {
    policy: Option<Policy>,
    last_activity: Instant,
    vault: Option<EncryptedCredentials>,
}
#[derive(Clone)]
pub struct WorkspaceLock {
    path: Arc<PathBuf>,
    inner: Arc<Mutex<Inner>>,
    operation: Arc<Mutex<()>>,
    locked: Arc<AtomicBool>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    enabled: bool,
    locked: bool,
    idle_minutes: u32,
    retry_after_seconds: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigureLock {
    enabled: bool,
    current_pin: Zeroizing<String>,
    new_pin: Zeroizing<String>,
    idle_minutes: u32,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn derive(pin: &str, salt: &[u8; 16]) -> Result<Zeroizing<[u8; 32]>, String> {
    if !(4..=12).contains(&pin.len()) || !pin.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Use a PIN containing 4–12 digits.".into());
    }
    let params =
        Params::new(65536, 3, 1, Some(32)).map_err(|_| "Could not prepare PIN verification.")?;
    let mut hash = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(pin.as_bytes(), salt, hash.as_mut())
        .map_err(|_| "Could not verify PIN.")?;
    Ok(hash)
}
impl WorkspaceLock {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let policy = match fs::symlink_metadata(&path) {
            Ok(meta) => {
                if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 40 * 1024 * 1024
                {
                    return Err("Workspace lock configuration is invalid.".into());
                }
                let mut bytes = Vec::new();
                fs::File::open(&path)
                    .map_err(|_| "Could not read workspace lock.")?
                    .take(40 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "Could not read workspace lock.")?;
                let policy: Option<Policy> = serde_json::from_slice(&bytes)
                    .map_err(|_| "Workspace lock configuration is invalid.")?;
                if policy
                    .as_ref()
                    .is_some_and(|p| p.version != 1 || p.idle_minutes > 1440)
                {
                    return Err("Workspace lock configuration is invalid.".into());
                }
                policy
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("Could not read workspace lock configuration.".into()),
        };
        let locked = policy.is_some();
        Ok(Self {
            path: Arc::new(path),
            inner: Arc::new(Mutex::new(Inner {
                policy,
                last_activity: Instant::now(),
                vault: None,
            })),
            operation: Arc::new(Mutex::new(())),
            locked: Arc::new(AtomicBool::new(locked)),
        })
    }
    fn persist(&self, policy: &Option<Policy>) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Invalid workspace lock path.")?;
        fs::create_dir_all(parent).map_err(|_| "Could not save workspace lock.")?;
        let mut temp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Could not save workspace lock.")?;
        temp.write_all(&serde_json::to_vec(policy).map_err(|_| "Could not save workspace lock.")?)
            .map_err(|_| "Could not save workspace lock.")?;
        temp.as_file()
            .sync_all()
            .map_err(|_| "Could not save workspace lock.")?;
        temp.persist(self.path.as_ref())
            .map_err(|_| "Could not save workspace lock.")?;
        Ok(())
    }
    pub fn is_locked(&self) -> bool {
        self.locked.load(Ordering::Acquire)
    }
    pub fn allows(&self, command: &str) -> bool {
        !self.is_locked()
            || matches!(
                command,
                "workspace_lock_status"
                    | "workspace_unlock"
                    | "workspace_lock_now"
                    | "workspace_activity"
                    | "workspace_backup_restart"
            )
    }
    fn status(&self) -> Result<LockStatus, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "Workspace lock unavailable.")?;
        Ok(LockStatus {
            enabled: inner.policy.is_some(),
            locked: self.is_locked(),
            idle_minutes: inner.policy.as_ref().map_or(5, |p| p.idle_minutes),
            retry_after_seconds: inner
                .policy
                .as_ref()
                .map_or(0, |p| p.retry_at.saturating_sub(now()).min(60)),
        })
    }
    fn verify(&self, pin: &str) -> Result<(), String> {
        let mut policy = self
            .inner
            .lock()
            .map_err(|_| "Workspace lock unavailable.")?
            .policy
            .clone()
            .ok_or("Workspace PIN is not configured.")?;
        if policy.retry_at > now() {
            return Err(format!(
                "Try again in {} seconds.",
                policy.retry_at.saturating_sub(now()).min(60)
            ));
        }
        let matches = derive(pin, &policy.salt)
            .map(|hash| bool::from(hash.as_ref().ct_eq(&policy.hash)))
            .unwrap_or(false);
        if !matches {
            policy.failures = policy.failures.saturating_add(1);
            policy.retry_at = now() + (1_u64 << policy.failures.saturating_sub(1).min(6)).min(60);
            self.persist(&Some(policy.clone()))?;
            self.inner
                .lock()
                .map_err(|_| "Workspace lock unavailable.")?
                .policy = Some(policy);
            return Err("Incorrect PIN. Please wait before trying again.".into());
        }
        policy.failures = 0;
        policy.retry_at = 0;
        self.persist(&Some(policy.clone()))?;
        self.inner
            .lock()
            .map_err(|_| "Workspace lock unavailable.")?
            .policy = Some(policy);
        Ok(())
    }
    fn unlock(&self, pin: &str) -> Result<LockStatus, String> {
        let _operation = self
            .operation
            .try_lock()
            .map_err(|_| "PIN verification is already in progress.")?;
        if self
            .inner
            .lock()
            .map_err(|_| "Workspace lock unavailable.")?
            .policy
            .is_some()
        {
            self.verify(pin)?;
        }
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Workspace lock unavailable.")?;
        if let Some(policy) = inner.policy.as_mut() {
            let secret = SecretMaterial::new(pin);
            let vault = match &policy.vault {
                Some(bytes) => EncryptedCredentials::open(bytes, &secret),
                None => EncryptedCredentials::create(&secret),
            }
            .map_err(|_| "Could not unlock encrypted credentials. Workspace remains locked.")?;
            if policy.vault.is_none() {
                policy.vault = Some(vault.seal().map_err(|_| "Could not encrypt credentials.")?);
                self.persist(&Some(policy.clone()))?;
            }
            inner.vault = Some(vault);
        }
        inner.last_activity = Instant::now();
        self.locked.store(false, Ordering::Release);
        drop(inner);
        self.status()
    }
    pub(crate) fn configure(&self, request: ConfigureLock) -> Result<LockStatus, String> {
        let _operation = self
            .operation
            .try_lock()
            .map_err(|_| "A lock update is already in progress.")?;
        if self.is_locked() {
            return Err("Unlock the workspace first.".into());
        }
        if request.idle_minutes > 1440 {
            return Err("Idle timeout must be between 0 and 1440 minutes.".into());
        }
        let old = self
            .inner
            .lock()
            .map_err(|_| "Workspace lock unavailable.")?
            .policy
            .clone();
        if old.is_some() {
            self.verify(&request.current_pin)?;
        }
        let policy = if request.enabled {
            if request.new_pin.is_empty() {
                let mut policy = old.ok_or("Enter a new PIN.")?;
                policy.idle_minutes = request.idle_minutes;
                policy.failures = 0;
                policy.retry_at = 0;
                Some(policy)
            } else {
                let mut salt = [0; 16];
                getrandom::fill(&mut salt).map_err(|_| "Could not generate a PIN salt.")?;
                let hash = derive(&request.new_pin, &salt)?;
                Some(Policy {
                    version: 1,
                    salt,
                    hash: *hash,
                    idle_minutes: request.idle_minutes,
                    failures: 0,
                    retry_at: 0,
                    vault: None,
                })
            }
        } else {
            None
        };
        let mut policy = policy;
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Workspace lock unavailable.")?;
        if policy.is_none()
            && inner
                .vault
                .as_ref()
                .is_some_and(|v| !v.list_ids().is_empty())
        {
            return Err("Delete saved credentials before turning off the PIN lock. The PIN protects their encryption.".into());
        }
        let next_vault = if policy.is_some() {
            let pin = SecretMaterial::new(if request.new_pin.is_empty() {
                &*request.current_pin
            } else {
                &*request.new_pin
            });
            let vault = match &inner.vault {
                Some(vault) => vault.with_pin(&pin),
                None => EncryptedCredentials::create(&pin),
            }
            .map_err(|_| "Could not prepare encrypted credentials.")?;
            policy.as_mut().unwrap().vault =
                Some(vault.seal().map_err(|_| "Could not encrypt credentials.")?);
            Some(vault)
        } else {
            None
        };
        self.persist(&policy)?;
        inner.vault = next_vault;
        inner.policy = policy;
        inner.last_activity = Instant::now();
        drop(inner);
        self.status()
    }
    fn activity(&self) {
        if !self.is_locked()
            && let Ok(mut inner) = self.inner.lock()
        {
            inner.last_activity = Instant::now();
        }
    }
    fn lock_now(&self) -> bool {
        let Ok(_operation) = self.operation.lock() else {
            return false;
        };
        if let Ok(mut inner) = self.inner.lock()
            && inner.policy.is_some()
        {
            inner.vault = None;
            return !self.locked.swap(true, Ordering::AcqRel);
        }
        false
    }
    fn lock_if_idle(&self) -> bool {
        let Ok(_operation) = self.operation.try_lock() else {
            return false;
        };
        if self.is_locked() {
            return false;
        }
        if let Ok(mut inner) = self.inner.lock()
            && let Some(policy) = &inner.policy
            && policy.idle_minutes > 0
            && inner.last_activity.elapsed()
                >= Duration::from_secs(u64::from(policy.idle_minutes) * 60)
        {
            inner.vault = None;
            return !self.locked.swap(true, Ordering::AcqRel);
        }
        false
    }
}
/// App-owned credential store, sharing the screen-lock lifecycle.
#[derive(Clone)]
pub struct NativeVault(pub WorkspaceLock);
impl NativeVault {
    fn access(&self) -> Result<std::sync::MutexGuard<'_, Inner>, VaultError> {
        let inner = self.0.inner.lock().map_err(|_| {
            VaultError::PortableStateUnavailable("Workspace security unavailable.".into())
        })?;
        if self.0.is_locked() || inner.vault.is_none() {
            return Err(VaultError::PortableStateUnavailable(
                "Set up or unlock the workspace PIN in Settings > Security to use saved passwords."
                    .into(),
            ));
        }
        Ok(inner)
    }
    pub fn get(&self, id: &CredentialId) -> Result<SecretMaterial, VaultError> {
        self.access()?.vault.as_ref().unwrap().get(id)
    }
    pub fn list_ids(&self) -> Result<Vec<String>, VaultError> {
        let inner = self.0.inner.lock().map_err(|_| {
            VaultError::PortableStateUnavailable("Workspace security unavailable.".into())
        })?;
        if inner.policy.is_none() {
            return Ok(Vec::new());
        }
        if self.0.is_locked() {
            return Err(VaultError::PortableStateUnavailable(
                "Unlock the workspace first.".into(),
            ));
        }
        Ok(inner
            .vault
            .as_ref()
            .map_or_else(Vec::new, EncryptedCredentials::list_ids))
    }
    pub fn put(&self, id: &CredentialId, secret: &SecretMaterial) -> Result<(), VaultError> {
        self.update(id, Some(SecretMaterial::new(secret.as_str())))
    }
    pub fn delete(&self, id: &CredentialId) -> Result<(), VaultError> {
        self.update(id, None)
    }
    fn update(&self, id: &CredentialId, secret: Option<SecretMaterial>) -> Result<(), VaultError> {
        let _operation = self.0.operation.lock().map_err(|_| {
            VaultError::PortableStateUnavailable("Workspace security unavailable.".into())
        })?;
        let mut inner = self.access()?;
        let vault = inner.vault.as_mut().unwrap();
        let previous = match vault.get(id) {
            Ok(value) => Some(value),
            Err(VaultError::PortableCredentialMissing(_)) => None,
            Err(error) => return Err(error),
        };
        match secret {
            Some(secret) => vault.put(id, secret)?,
            None => vault.delete(id),
        }
        let sealed = vault.seal();
        let result = (|| {
            let bytes = sealed?;
            let mut policy = inner.policy.clone().unwrap();
            policy.vault = Some(bytes);
            self.0
                .persist(&Some(policy.clone()))
                .map_err(VaultError::PortableStateUnavailable)?;
            inner.policy = Some(policy);
            Ok(())
        })();
        if result.is_err() {
            let vault = inner.vault.as_mut().unwrap();
            match previous {
                Some(secret) => {
                    vault.put(id, secret)?;
                }
                None => vault.delete(id),
            }
        }
        result
    }
    pub fn stage_policy(&self, directory: &std::path::Path, ids: &[String]) -> Result<(), String> {
        let inner = self.access().map_err(|e| e.to_string())?;
        let target = WorkspaceLock::open(directory.join("workspace-lock.json"))?;
        let mut policy = inner
            .policy
            .clone()
            .ok_or("Set up the workspace PIN first.")?;
        policy.vault = Some(
            inner
                .vault
                .as_ref()
                .unwrap()
                .subset(ids)
                .and_then(|v| v.seal())
                .map_err(|_| "Could not encrypt restored passwords.")?,
        );
        target.persist(&Some(policy))
    }
}
impl CredentialLookup for NativeVault {
    fn get(&self, id: &CredentialId) -> Result<SecretMaterial, VaultError> {
        self.get(id)
    }
}

#[tauri::command]
pub fn workspace_lock_status(state: State<'_, WorkspaceLock>) -> Result<LockStatus, String> {
    state.status()
}
#[tauri::command]
pub fn workspace_activity(state: State<'_, WorkspaceLock>) {
    state.activity();
}
#[tauri::command]
pub fn workspace_lock_now(
    app: tauri::AppHandle,
    state: State<'_, WorkspaceLock>,
) -> Result<LockStatus, String> {
    if state.lock_now() {
        let _ = app.emit("workspace://locked", ());
    }
    state.status()
}
#[tauri::command]
pub async fn workspace_unlock(
    state: State<'_, WorkspaceLock>,
    pin: Zeroizing<String>,
) -> Result<LockStatus, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.unlock(&pin))
        .await
        .map_err(|_| "PIN verification failed.".to_owned())?
}
#[tauri::command]
pub async fn workspace_lock_configure(
    state: State<'_, WorkspaceLock>,
    request: ConfigureLock,
) -> Result<LockStatus, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.configure(request))
        .await
        .map_err(|_| "Could not update workspace lock.".to_owned())?
}
pub fn start_idle_monitor(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if app.state::<WorkspaceLock>().lock_if_idle() {
                let _ = app.emit("workspace://locked", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn configure(enabled: bool, current: &str, new: &str, idle_minutes: u32) -> ConfigureLock {
        ConfigureLock {
            enabled,
            current_pin: Zeroizing::new(current.into()),
            new_pin: Zeroizing::new(new.into()),
            idle_minutes,
        }
    }
    #[test]
    fn pin_lock_cold_start_idle_and_command_gate() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("lock.json");
        let state = WorkspaceLock::open(path.clone()).unwrap();
        assert!(!state.status().unwrap().enabled);
        assert!(state.configure(configure(true, "", "123", 5)).is_err());
        assert!(state.configure(configure(true, "", "abcdef", 5)).is_err());
        assert!(
            state
                .configure(configure(true, "", "1234567890123", 5))
                .is_err()
        );
        state.configure(configure(true, "", "8392", 1)).unwrap();
        assert!(!state.is_locked());
        let stored = fs::read_to_string(&path).unwrap();
        assert!(!stored.contains("8392"));
        let cold = WorkspaceLock::open(path).unwrap();
        assert!(cold.is_locked());
        for command in [
            "session_list",
            "vault_put",
            "clipboard_read_text",
            "clipboard_write_text",
            "ssh_write",
            "terminal_spawn",
            "workspace_lock_configure",
        ] {
            assert!(!cold.allows(command));
        }
        assert!(cold.allows("workspace_unlock"));
        assert!(cold.allows("workspace_lock_status"));
        assert!(cold.configure(configure(false, "8392", "", 0)).is_err());
        assert!(cold.unlock("111111").is_err());
        assert!(cold.status().unwrap().retry_after_seconds > 0);
        assert!(
            WorkspaceLock::open(root.path().join("lock.json"))
                .unwrap()
                .status()
                .unwrap()
                .retry_after_seconds
                > 0
        );
        assert!(cold.unlock("8392").is_err());
        {
            let mut inner = cold.inner.lock().unwrap();
            inner.policy.as_mut().unwrap().retry_at = 0;
        }
        cold.unlock("8392").unwrap();
        assert!(cold.allows("session_list"));
        cold.inner.lock().unwrap().last_activity = Instant::now() - Duration::from_secs(61);
        assert!(cold.lock_if_idle());
        assert!(!cold.lock_if_idle());
        cold.unlock("8392").unwrap();
        cold.configure(configure(true, "8392", "927183045612", 0))
            .unwrap();
        cold.inner.lock().unwrap().last_activity = Instant::now() - Duration::from_secs(10000);
        assert!(!cold.lock_if_idle());
        cold.configure(configure(false, "927183045612", "", 0))
            .unwrap();
        assert!(!cold.status().unwrap().enabled);
        assert!(
            !WorkspaceLock::open(root.path().join("lock.json"))
                .unwrap()
                .is_locked()
        );
    }
    #[test]
    fn native_credentials_follow_screen_lock_and_pin_changes() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("lock.json");
        let state = WorkspaceLock::open(path.clone()).unwrap();
        let vault = NativeVault(state.clone());
        let id = CredentialId::new("fixture-password").unwrap();
        assert!(
            vault
                .put(&id, &SecretMaterial::new("fixture-only-secret"))
                .is_err()
        );
        state.configure(configure(true, "", "1234", 1)).unwrap();
        vault
            .put(&id, &SecretMaterial::new("fixture-only-secret"))
            .unwrap();
        assert_eq!(vault.list_ids().unwrap(), vec!["fixture-password"]);
        assert!(
            !fs::read_to_string(&path)
                .unwrap()
                .contains("fixture-only-secret")
        );
        assert!(state.configure(configure(false, "1234", "", 1)).is_err());
        state
            .configure(configure(true, "1234", "123456789012", 1))
            .unwrap();
        assert_eq!(vault.get(&id).unwrap().as_str(), "fixture-only-secret");
        let cold = WorkspaceLock::open(path.clone()).unwrap();
        assert!(NativeVault(cold.clone()).get(&id).is_err());
        cold.unlock("123456789012").unwrap();
        assert_eq!(
            NativeVault(cold.clone()).get(&id).unwrap().as_str(),
            "fixture-only-secret"
        );
        assert!(state.lock_now());
        assert!(state.inner.lock().unwrap().vault.is_none());
        assert!(vault.get(&id).is_err());
        state.unlock("123456789012").unwrap();
        state.inner.lock().unwrap().last_activity = Instant::now() - Duration::from_secs(61);
        assert!(state.lock_if_idle());
        assert!(state.inner.lock().unwrap().vault.is_none());
        state.unlock("123456789012").unwrap();
        vault.delete(&id).unwrap();
        assert!(vault.get(&id).is_err());
        state
            .configure(configure(false, "123456789012", "", 1))
            .unwrap();
    }
    #[test]
    fn native_credentials_tampering_fails_closed_and_rekey_is_atomic() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("lock.json");
        let state = WorkspaceLock::open(path.clone()).unwrap();
        state.configure(configure(true, "", "1234", 0)).unwrap();
        let vault = NativeVault(state.clone());
        let id = CredentialId::new("fixture").unwrap();
        vault
            .put(&id, &SecretMaterial::new("synthetic-value"))
            .unwrap();
        // Force persistence failure without touching any real credential store.
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(vault.put(&id, &SecretMaterial::new("replacement")).is_err());
        assert_eq!(vault.get(&id).unwrap().as_str(), "synthetic-value");
        assert!(state.configure(configure(true, "1234", "5678", 0)).is_err());
        assert_eq!(vault.get(&id).unwrap().as_str(), "synthetic-value");
        fs::remove_dir(&path).unwrap();
        state.persist(&state.inner.lock().unwrap().policy).unwrap();
        let mut policy = state.inner.lock().unwrap().policy.clone().unwrap();
        let encrypted = policy.vault.as_mut().unwrap();
        *encrypted.last_mut().unwrap() ^= 1;
        state.persist(&Some(policy)).unwrap();
        let cold = WorkspaceLock::open(path).unwrap();
        assert!(cold.unlock("1234").is_err());
        assert!(cold.is_locked());
        assert!(cold.inner.lock().unwrap().vault.is_none());
    }
    #[test]
    fn restored_native_policy_preserves_encrypted_passwords() {
        let root = tempfile::tempdir().unwrap();
        let state = WorkspaceLock::open(root.path().join("lock.json")).unwrap();
        state.configure(configure(true, "", "4567", 0)).unwrap();
        let vault = NativeVault(state);
        let id = CredentialId::new("restored-synthetic").unwrap();
        vault
            .put(&id, &SecretMaterial::new("fixture-secret"))
            .unwrap();
        let stage = root.path().join("staged");
        vault.stage_policy(&stage, &[id.to_string()]).unwrap();
        let restored = WorkspaceLock::open(stage.join("workspace-lock.json")).unwrap();
        restored.unlock("4567").unwrap();
        assert_eq!(
            NativeVault(restored).get(&id).unwrap().as_str(),
            "fixture-secret"
        );
    }
    #[test]
    #[ignore = "Creates a disposable portable PIN preview only when explicitly requested"]
    fn create_visual_fixture() {
        let root = PathBuf::from(
            std::env::var_os("CONXOL_PIN_UI_FIXTURE").expect("explicit temp fixture path"),
        );
        let temp = std::env::temp_dir().canonicalize().unwrap();
        assert!(root.canonicalize().unwrap().starts_with(temp));
        let state = WorkspaceLock::open(root.join("portable-data/workspace-lock.json")).unwrap();
        state.configure(configure(true, "", "839271", 1)).unwrap();
    }
    #[test]
    fn corrupt_configuration_fails_closed_and_write_failure_keeps_policy() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("lock.json");
        fs::write(&path, b"invalid").unwrap();
        assert!(WorkspaceLock::open(path.clone()).is_err());
        fs::remove_file(&path).unwrap();
        let state = WorkspaceLock::open(path.clone()).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(state.configure(configure(true, "", "839271", 5)).is_err());
        assert!(!state.status().unwrap().enabled);
    }
}
