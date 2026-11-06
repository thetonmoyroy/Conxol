use serde::{Deserialize, Serialize};
use std::{io::{Read, Write}, path::PathBuf, sync::Mutex};
use tauri::State;
use uuid::Uuid;

const MAX_FILE: u64 = 8 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Note {
    id: Uuid,
    name: String,
    vendor: String,
    content: String,
}

fn validate(note: &Note) -> Result<(), String> {
    if note.name.trim().is_empty() || note.name.len() > 200 || note.vendor.len() > 100
        || note.content.trim().is_empty() || note.content.len() > 65536 {
        return Err("A note needs a name and command text (up to 64 KiB).".into());
    }
    Ok(())
}

pub struct NoteStore {
    path: PathBuf,
    notes: Vec<Note>,
}

impl NoteStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let notes: Vec<Note> = match std::fs::File::open(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(MAX_FILE + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
                if bytes.len() as u64 > MAX_FILE { return Err("Notes file is too large.".into()); }
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.to_string()),
        };
        let mut ids = std::collections::HashSet::new();
        for note in &notes {
            validate(note)?;
            if !ids.insert(note.id) { return Err("Duplicate note identifier.".into()); }
        }
        Ok(Self { path, notes })
    }

    fn persist(&mut self, notes: Vec<Note>) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(&notes).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_FILE { return Err("Notes storage is full (8 MiB).".into()); }
        let parent = self.path.parent().ok_or("Invalid notes path")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temp.write_all(&bytes).map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(&self.path).map_err(|e| e.to_string())?;
        self.notes = notes;
        Ok(())
    }

    fn save(&mut self, mut note: Note) -> Result<Note, String> {
        note.name = note.name.trim().into();
        note.vendor = note.vendor.trim().into();
        validate(&note)?;
        let mut notes = self.notes.clone();
        if let Some(existing) = notes.iter_mut().find(|item| item.id == note.id) {
            *existing = note.clone();
        } else { notes.push(note.clone()); }
        self.persist(notes)?;
        Ok(note)
    }

    fn delete(&mut self, id: Uuid) -> Result<(), String> {
        let notes = self.notes.iter().filter(|note| note.id != id).cloned().collect();
        self.persist(notes)
    }
}

#[tauri::command]
pub fn note_list(store: State<'_, Mutex<NoteStore>>) -> Result<Vec<Note>, String> {
    Ok(store.lock().map_err(|_| "Notes store lock poisoned")?.notes.clone())
}
#[tauri::command]
pub fn note_save(store: State<'_, Mutex<NoteStore>>, note: Note) -> Result<Note, String> {
    store.lock().map_err(|_| "Notes store lock poisoned")?.save(note)
}
#[tauri::command]
pub fn note_delete(store: State<'_, Mutex<NoteStore>>, id: Uuid) -> Result<(), String> {
    store.lock().map_err(|_| "Notes store lock poisoned")?.delete(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notes_roundtrip_update_delete_and_validation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.json");
        let mut store = NoteStore::open(path.clone()).unwrap();
        let note = Note { id: Uuid::new_v4(), name: " Show interfaces ".into(), vendor: "Cisco".into(), content: "show interfaces\nshow version".into() };
        let mut saved = store.save(note).unwrap();
        assert_eq!(saved.name, "Show interfaces");
        saved.content = "show interfaces status".into();
        store.save(saved.clone()).unwrap();
        let mut reopened = NoteStore::open(path).unwrap();
        assert_eq!(reopened.notes.len(), 1);
        assert_eq!(reopened.notes[0].content, saved.content);
        let mut invalid = saved.clone();
        invalid.name = " ".into();
        assert!(reopened.save(invalid).is_err());
        assert_eq!(reopened.notes.len(), 1);
        reopened.delete(saved.id).unwrap();
        assert!(NoteStore::open(reopened.path).unwrap().notes.is_empty());
    }
}
