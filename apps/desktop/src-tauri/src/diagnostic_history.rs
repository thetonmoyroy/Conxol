use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
};
use tauri::State;
use uuid::Uuid;

const MAX_FILE: usize = 8 * 1024 * 1024;
const MAX_CONTENT: usize = 256 * 1024;
const MAX_ENTRIES: usize = 50;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    id: Uuid,
    tool: String,
    target: String,
    route: String,
    state: String,
    saved_at: u64,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    id: Uuid,
    tool: String,
    target: String,
    route: String,
    state: String,
    content: String,
}

fn validate(entry: &Entry) -> Result<(), String> {
    if !matches!(
        entry.tool.as_str(),
        "scan" | "ping" | "mtr" | "dns" | "tcp" | "ssh"
    ) || !matches!(
        entry.state.as_str(),
        "running" | "ready" | "error" | "completed" | "cancelled" | "failed"
    ) || entry.target.len() > 1024
        || entry.route.len() > 256
        || entry.content.len() > MAX_CONTENT + 100
    {
        return Err("Invalid diagnostic log.".into());
    }
    Ok(())
}

pub struct HistoryStore {
    path: PathBuf,
}

impl HistoryStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn list(&self) -> Result<Vec<Entry>, String> {
        match std::fs::symlink_metadata(&self.path) {
            Ok(meta)
                if !meta.is_file()
                    || meta.file_type().is_symlink()
                    || meta.len() > MAX_FILE as u64 =>
            {
                return Err("Diagnostic log storage is invalid or too large.".into());
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err("Could not read diagnostic logs.".into()),
        }
        let file = match std::fs::File::open(&self.path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err("Could not read diagnostic logs.".into()),
        };
        let mut bytes = Vec::new();
        file.take((MAX_FILE + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read diagnostic logs.")?;
        if bytes.len() > MAX_FILE {
            return Err("Diagnostic log storage is too large.".into());
        }
        let entries: Vec<Entry> =
            serde_json::from_slice(&bytes).map_err(|_| "Diagnostic logs are invalid.")?;
        if entries.len() > MAX_ENTRIES {
            return Err("Too many diagnostic logs.".into());
        }
        let mut ids = std::collections::HashSet::new();
        for entry in &entries {
            validate(entry)?;
            if !ids.insert(entry.id) {
                return Err("Duplicate diagnostic log identifier.".into());
            }
        }
        Ok(entries)
    }

    fn persist(&self, entries: &[Entry]) -> Result<(), String> {
        let bytes = serde_json::to_vec(entries).map_err(|_| "Could not encode diagnostic logs.")?;
        if bytes.len() > MAX_FILE {
            return Err("Diagnostic log storage is full.".into());
        }
        let parent = self.path.parent().ok_or("Invalid diagnostic log path.")?;
        std::fs::create_dir_all(parent).map_err(|_| "Could not create diagnostic log storage.")?;
        let mut temp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Could not save diagnostic logs.")?;
        temp.write_all(&bytes)
            .map_err(|_| "Could not save diagnostic logs.")?;
        temp.as_file()
            .sync_all()
            .map_err(|_| "Could not save diagnostic logs.")?;
        temp.persist(&self.path)
            .map_err(|_| "Could not replace diagnostic logs.")?;
        Ok(())
    }

    fn save(&self, mut request: SaveRequest) -> Result<Vec<Entry>, String> {
        if request.content.len() > 16 * 1024 * 1024 {
            return Err("Diagnostic output exceeds 16 MiB.".into());
        }
        if request.content.len() > MAX_CONTENT {
            let mut end = MAX_CONTENT;
            while !request.content.is_char_boundary(end) {
                end -= 1;
            }
            request.content.truncate(end);
            request.content.push_str(
                "\n[Saved log truncated at 256 KiB. Export live output for the full report.]",
            );
        }
        let mut entries = self.list()?;
        let saved_at = entries
            .iter()
            .find(|entry| entry.id == request.id)
            .map(|entry| entry.saved_at)
            .unwrap_or_else(|| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64
            });
        let entry = Entry {
            id: request.id,
            tool: request.tool,
            target: request.target,
            route: request.route,
            state: request.state,
            saved_at,
            content: request.content,
        };
        validate(&entry)?;
        entries.retain(|old| old.id != entry.id);
        entries.insert(0, entry);
        entries.truncate(MAX_ENTRIES);
        while serde_json::to_vec(&entries)
            .map_err(|_| "Could not encode diagnostic logs.")?
            .len()
            > MAX_FILE
        {
            entries.pop();
        }
        self.persist(&entries)?;
        Ok(entries)
    }
}

#[tauri::command]
pub async fn network_diagnostic_history_list(
    store: State<'_, Mutex<HistoryStore>>,
) -> Result<Vec<Entry>, String> {
    store
        .lock()
        .map_err(|_| "Diagnostic logs are unavailable.")?
        .list()
}
#[tauri::command]
pub async fn network_diagnostic_history_save(
    store: State<'_, Mutex<HistoryStore>>,
    request: SaveRequest,
) -> Result<Vec<Entry>, String> {
    store
        .lock()
        .map_err(|_| "Diagnostic logs are unavailable.")?
        .save(request)
}
#[tauri::command]
pub async fn network_diagnostic_history_clear(
    store: State<'_, Mutex<HistoryStore>>,
) -> Result<(), String> {
    store
        .lock()
        .map_err(|_| "Diagnostic logs are unavailable.")?
        .persist(&[])
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(id: Uuid, content: &str) -> SaveRequest {
        SaveRequest {
            id,
            tool: "ping".into(),
            target: "192.0.2.1".into(),
            route: "Direct network".into(),
            state: "completed".into(),
            content: content.into(),
        }
    }
    #[test]
    fn history_survives_restart_updates_checkpoints_and_clears() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.json");
        let store = HistoryStore::new(path.clone());
        let id = Uuid::new_v4();
        let mut checkpoint = request(id, "Partial report");
        checkpoint.state = "running".into();
        let stamp = store.save(checkpoint).unwrap()[0].saved_at;
        store.save(request(id, "Final report")).unwrap();
        let reopened = HistoryStore::new(path);
        let entries = reopened.list().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].content, "Final report");
        assert_eq!(entries[0].saved_at, stamp);
        reopened.persist(&[]).unwrap();
        assert!(store.list().unwrap().is_empty());
    }
    #[test]
    fn history_retention_validation_and_utf8_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path().join("history.json"));
        for _ in 0..55 {
            store.save(request(Uuid::new_v4(), "Report")).unwrap();
        }
        assert_eq!(store.list().unwrap().len(), MAX_ENTRIES);
        let entries = store
            .save(request(Uuid::new_v4(), &"界".repeat(MAX_CONTENT)))
            .unwrap();
        assert!(entries[0].content.ends_with("full report.]"));
        let before = std::fs::read(&store.path).unwrap();
        let mut invalid = request(Uuid::new_v4(), "Invalid");
        invalid.tool = "shell".into();
        assert!(store.save(invalid).is_err());
        assert_eq!(std::fs::read(&store.path).unwrap(), before);
        std::fs::write(&store.path, b"invalid JSON").unwrap();
        assert!(store.save(request(Uuid::new_v4(), "Report")).is_err());
    }
}
