//! App-owned SSH fingerprints; never reads or writes personal known_hosts files.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrustFile {
    hosts: BTreeMap<String, String>,
}

pub struct SshTrustStore {
    path: PathBuf,
}
struct TrustLock(PathBuf);
impl Drop for TrustLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
impl SshTrustStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    fn key(host: &str, port: u16) -> Result<String, String> {
        if host.trim().is_empty()
            || host.len() > 253
            || host.chars().any(char::is_control)
            || port == 0
        {
            return Err("Invalid SSH trust endpoint".into());
        }
        Ok(format!("[{}]:{port}", host.trim().to_ascii_lowercase()))
    }
    fn read(&self) -> Result<TrustFile, String> {
        match fs::read(&self.path) {
            Ok(bytes) if bytes.len() <= 1024 * 1024 => serde_json::from_slice(&bytes)
                .map_err(|_| "SSH trust store is invalid; refusing to discard stored keys".into()),
            Ok(_) => Err("SSH trust store exceeds its size limit".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(TrustFile::default()),
            Err(e) => Err(format!("Cannot read SSH trust store: {e}")),
        }
    }
    pub fn lookup(&self, host: &str, port: u16) -> Result<Option<String>, String> {
        Ok(self.read()?.hosts.get(&Self::key(host, port)?).cloned())
    }
    pub fn accept(&self, host: &str, port: u16, fingerprint: &str) -> Result<(), String> {
        let suffix = fingerprint
            .strip_prefix("SHA256:")
            .ok_or("Invalid SHA-256 fingerprint")?;
        if suffix.len() != 43
            || !suffix
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/')
        {
            return Err("Invalid SHA-256 fingerprint".into());
        }
        let key = Self::key(host, port)?;
        let parent = self.path.parent().ok_or("Invalid trust store path")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let lock_path = self.path.with_extension("lock");
        let _lock_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
            .map_err(|_| "SSH trust store is busy; retry after the other approval completes")?;
        // Drop the open file before deleting its lock on Windows.
        let _lock_guard = TrustLock(lock_path);
        drop(_lock_file);
        let mut trust = self.read()?;
        if let Some(existing) = trust.hosts.get(&key) {
            return if existing == fingerprint {
                Ok(())
            } else {
                Err("SSH host key changed; stored trust was not replaced".into())
            };
        }
        if trust.hosts.len() >= 4096 {
            return Err("SSH trust store is full".into());
        }
        trust.hosts.insert(key, fingerprint.to_owned());
        let temp = parent.join(format!(".ssh-trust-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp)
                .map_err(|e| e.to_string())?;
            let bytes = serde_json::to_vec_pretty(&trust).map_err(|e| e.to_string())?;
            if bytes.len() > 1024 * 1024 {
                return Err("SSH trust store exceeds its size limit".into());
            }
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            fs::rename(&temp, &self.path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY: &str = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    #[test]
    fn approval_persists_is_endpoint_scoped_and_never_replaces_changed_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        let store = SshTrustStore::new(path.clone());
        assert_eq!(store.lookup("fixture.test", 22).unwrap(), None);
        assert!(!path.exists());
        store.accept("Fixture.Test", 22, KEY).unwrap();
        let reopened = SshTrustStore::new(path);
        assert_eq!(
            reopened.lookup("fixture.test", 22).unwrap().as_deref(),
            Some(KEY)
        );
        assert_eq!(reopened.lookup("fixture.test", 2222).unwrap(), None);
        assert_eq!(reopened.lookup("other.test", 22).unwrap(), None);
        assert!(
            reopened
                .accept("fixture.test", 22, &format!("SHA256:{}", "B".repeat(43)))
                .is_err()
        );
        assert_eq!(
            reopened.lookup("fixture.test", 22).unwrap().as_deref(),
            Some(KEY)
        );
        reopened.accept("other.test", 22, KEY).unwrap();
        assert_eq!(
            reopened.lookup("other.test", 22).unwrap().as_deref(),
            Some(KEY)
        );
    }
    #[test]
    fn corrupt_store_and_invalid_approval_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        let store = SshTrustStore::new(path.clone());
        assert!(store.accept("fixture.test", 22, "SHA256:bad").is_err());
        fs::write(&path, b"broken").unwrap();
        assert!(store.lookup("fixture.test", 22).is_err());
        assert!(store.accept("fixture.test", 22, KEY).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"broken");
    }
}
