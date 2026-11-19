use serde::Serialize;
use std::{
    collections::HashMap,
    io::Read,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::State;

#[derive(Default)]
pub struct ExternalEditors(Mutex<Editors>);
#[derive(Default)]
struct Editors {
    executable: Option<PathBuf>,
    config: Option<PathBuf>,
    files: HashMap<String, LocalEdit>,
}

impl ExternalEditors {
    pub fn open(config: PathBuf) -> Result<Self, String> {
        let executable = match std::fs::File::open(&config) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(8193)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "Could not read editor preference")?;
                if bytes.len() > 8192 {
                    return Err("Editor preference is too large".into());
                }
                serde_json::from_slice::<PathBuf>(&bytes)
                    .ok()
                    .filter(|path| path.is_absolute() && path.is_file())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("Could not read editor preference".into()),
        };
        Ok(Self(Mutex::new(Editors {
            executable,
            config: Some(config),
            files: HashMap::new(),
        })))
    }
}

fn save_editor(config: &std::path::Path, executable: &std::path::Path) -> Result<(), String> {
    use std::io::Write;
    let parent = config.parent().ok_or("Invalid editor preference path")?;
    std::fs::create_dir_all(parent).map_err(|_| "Could not create editor preference directory")?;
    let bytes = serde_json::to_vec(executable).map_err(|_| "Could not encode editor preference")?;
    if bytes.len() > 8192 {
        return Err("Editor path is too long".into());
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Could not save editor preference")?;
    temporary
        .write_all(&bytes)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| "Could not save editor preference")?;
    temporary
        .persist(config)
        .map_err(|_| "Could not save editor preference")?;
    Ok(())
}
struct LocalEdit {
    _directory: tempfile::TempDir,
    path: PathBuf,
    closed: Arc<AtomicBool>,
}
#[derive(Serialize)]
pub struct EditSnapshot {
    content: String,
    closed: bool,
}

fn snapshot_edit(edit: &LocalEdit) -> Result<EditSnapshot, String> {
    // Sample exit before reading so a final save is included when reporting closure.
    let closed = edit.closed.load(Ordering::Acquire);
    Ok(EditSnapshot {
        content: read_edit(&edit.path)?,
        closed,
    })
}

fn editor_arguments(executable: &std::path::Path) -> &'static [&'static str] {
    if executable
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("notepad++.exe"))
    {
        &["-multiInst", "-nosession"]
    } else {
        &[]
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedEdit {
    token: String,
    local_path: String,
}

fn read_edit(path: &std::path::Path) -> Result<String, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "Local file is unavailable")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Local edit must be a regular file".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options
        .open(path)
        .map_err(|_| "Could not read local edit")?;
    let opened_metadata = file
        .metadata()
        .map_err(|_| "Could not inspect local edit")?;
    if !opened_metadata.is_file() {
        return Err("Local edit must be a regular file".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if opened_metadata.file_attributes() & 0x400 != 0 {
            return Err("Local edit cannot be a reparse point".into());
        }
    }
    let mut bytes = Vec::new();
    file.take(conxol_ssh::MAX_REMOTE_EDITOR_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read local edit")?;
    if bytes.len() > conxol_ssh::MAX_REMOTE_EDITOR_BYTES {
        return Err("Local edit exceeds 4 MiB".into());
    }
    let content =
        String::from_utf8(bytes).map_err(|_| "Save the local file as UTF-8 before uploading")?;
    if content.contains('\0') {
        return Err("Binary files cannot be edited as text".into());
    }
    Ok(content)
}

#[tauri::command]
pub async fn external_editor_open(
    state: State<'_, ExternalEditors>,
    lock: State<'_, crate::workspace_lock::WorkspaceLock>,
    content: String,
    filename: String,
    choose_editor: bool,
) -> Result<Option<OpenedEdit>, String> {
    if content.len() > conxol_ssh::MAX_REMOTE_EDITOR_BYTES || content.contains('\0') {
        return Err("External editing requires a text file no larger than 4 MiB".into());
    }
    #[cfg(target_os = "android")]
    {
        let _ = (state, lock, filename, choose_editor);
        Err("External editors are available on desktop only".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let remembered = state
            .0
            .lock()
            .map_err(|_| "Editor state unavailable")?
            .executable
            .clone();
        let remembered = remembered.filter(|path| path.is_file());
        let executable = if choose_editor || remembered.is_none() {
            let picker = rfd::AsyncFileDialog::new()
                .set_title("Choose a text editor executable (for example, notepad++.exe)");
            #[cfg(windows)]
            let picker = picker.add_filter("Applications", &["exe"]);
            let Some(file) = picker.pick_file().await else {
                return Ok(None);
            };
            std::fs::canonicalize(file.path()).map_err(|_| "Editor executable is unavailable")?
        } else {
            remembered.unwrap()
        };
        if lock.is_locked() {
            return Err("Unlock the workspace before opening an editor".into());
        }
        let mut editors = state.0.lock().map_err(|_| "Editor state unavailable")?;
        if editors.files.len() >= 8 {
            return Err("Close an external edit before opening another".into());
        }
        if let Some(config) = &editors.config {
            save_editor(config, &executable)?;
        }
        let directory = tempfile::Builder::new()
            .prefix("conxol-edit-")
            .tempdir()
            .map_err(|_| "Could not create temporary edit directory")?;
        // Keep only a safe extension; remote filenames never become paths or process options.
        let extension = filename.rsplit_once('.').map(|(_, ext)| ext).filter(|ext| {
            !ext.is_empty() && ext.len() <= 16 && ext.bytes().all(|b| b.is_ascii_alphanumeric())
        });
        let name = extension.map_or_else(
            || "remote-file.txt".to_string(),
            |ext| format!("remote-file.{ext}"),
        );
        let path = directory.path().join(name);
        std::fs::write(&path, content).map_err(|_| "Could not write temporary edit file")?;
        let arguments = editor_arguments(&executable);
        let track_exit = !arguments.is_empty();
        let closed = Arc::new(AtomicBool::new(false));
        let child_closed = closed.clone();
        let mut child = std::process::Command::new(&executable)
            .args(arguments)
            .arg(&path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|_| "Could not launch the selected editor")?;
        std::thread::spawn(move || {
            if child.wait().is_ok() && track_exit {
                child_closed.store(true, Ordering::Release);
            }
        });
        editors.executable = Some(executable);
        let token = uuid::Uuid::new_v4().to_string();
        let opened = OpenedEdit {
            token: token.clone(),
            local_path: path.to_string_lossy().into_owned(),
        };
        editors.files.insert(
            token,
            LocalEdit {
                _directory: directory,
                path,
                closed,
            },
        );
        Ok(Some(opened))
    }
}

#[tauri::command]
pub fn external_editor_read(
    state: State<'_, ExternalEditors>,
    token: String,
) -> Result<EditSnapshot, String> {
    let editors = state.0.lock().map_err(|_| "Editor state unavailable")?;
    let edit = editors.files.get(&token).ok_or("External edit is closed")?;
    snapshot_edit(edit)
}

#[tauri::command]
pub fn external_editor_close(
    state: State<'_, ExternalEditors>,
    token: String,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "Editor state unavailable")?
        .files
        .remove(&token);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editor_choice_survives_restart_and_missing_editor_prompts_again() {
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("editor.json");
        let executable = directory.path().join("fixture-editor.exe");
        std::fs::write(&executable, b"fixture, never executed").unwrap();
        assert!(
            ExternalEditors::open(config.clone())
                .unwrap()
                .0
                .lock()
                .unwrap()
                .executable
                .is_none()
        );
        save_editor(&config, &executable).unwrap();
        assert_eq!(
            ExternalEditors::open(config.clone())
                .unwrap()
                .0
                .lock()
                .unwrap()
                .executable
                .as_ref(),
            Some(&executable)
        );
        // Replacing the preference is atomic and works when a previous choice exists.
        save_editor(&config, &executable).unwrap();
        std::fs::remove_file(&executable).unwrap();
        assert!(
            ExternalEditors::open(config)
                .unwrap()
                .0
                .lock()
                .unwrap()
                .executable
                .is_none()
        );
    }
    #[test]
    fn closure_snapshot_keeps_final_save_until_cleanup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture.txt");
        let closed = Arc::new(AtomicBool::new(false));
        let edit = LocalEdit {
            _directory: directory,
            path: path.clone(),
            closed: closed.clone(),
        };
        std::fs::write(&path, "initial").unwrap();
        assert!(!snapshot_edit(&edit).unwrap().closed);
        std::fs::write(&path, "final save").unwrap();
        closed.store(true, Ordering::Release);
        let snapshot = snapshot_edit(&edit).unwrap();
        assert!(snapshot.closed);
        assert_eq!(snapshot.content, "final save");
        assert!(path.exists());
        drop(edit);
        assert!(!path.exists());
    }
    #[test]
    fn dedicated_notepad_process_can_be_tracked_without_assuming_other_editors_wait() {
        assert_eq!(
            editor_arguments(std::path::Path::new("Notepad++.exe")),
            &["-multiInst", "-nosession"]
        );
        assert!(editor_arguments(std::path::Path::new("other-editor.exe")).is_empty());
    }
    #[test]
    fn local_edits_are_bounded_utf8_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.txt");
        std::fs::write(&path, "edited\r\ntext").unwrap();
        assert_eq!(read_edit(&path).unwrap(), "edited\r\ntext");
        std::fs::write(&path, [0xff]).unwrap();
        assert!(read_edit(&path).is_err());
        std::fs::write(&path, [0]).unwrap();
        assert!(read_edit(&path).is_err());
        std::fs::write(&path, vec![b'a'; conxol_ssh::MAX_REMOTE_EDITOR_BYTES + 1]).unwrap();
        assert!(read_edit(&path).is_err());
        assert!(read_edit(dir.path()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn local_edits_reject_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.txt");
        let link = dir.path().join("link.txt");
        std::fs::write(&target, "fixture").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(read_edit(&link).is_err());
    }
}
