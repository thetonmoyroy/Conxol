use tauri_plugin_clipboard_manager::ClipboardExt;
use zeroize::Zeroizing;
const MAX_CLIPBOARD_TEXT_BYTES: usize = 16 * 1024 * 1024;

fn validate_size(text: &str) -> Result<(), String> {
    if text.len() > MAX_CLIPBOARD_TEXT_BYTES {
        return Err("Clipboard text exceeds the 16 MiB limit.".into());
    }
    Ok(())
}

// Access is explicit and text-only. The central workspace guard also blocks
// these commands while PIN-locked; the plugin gets no renderer permissions.
#[tauri::command]
pub async fn clipboard_read_text(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let text = app
            .clipboard()
            .read_text()
            .map_err(|_| "Could not read clipboard text. Copy text first and retry.".to_owned())?;
        validate_size(&text)?;
        Ok(text)
    })
    .await
    .map_err(|_| "Clipboard reader failed.".to_owned())?
}
#[tauri::command]
pub async fn clipboard_write_text(
    app: tauri::AppHandle,
    text: Zeroizing<String>,
) -> Result<(), String> {
    validate_size(&text)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.clipboard()
            .write_text(text.to_string())
            .map_err(|_| "Could not copy text to the clipboard.".to_owned())
    })
    .await
    .map_err(|_| "Clipboard writer failed.".to_owned())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clipboard_size_is_bounded_without_accessing_system_clipboard() {
        assert!(validate_size("").is_ok());
        assert!(validate_size("show interfaces\n").is_ok());
        assert!(validate_size(&"a".repeat(MAX_CLIPBOARD_TEXT_BYTES)).is_ok());
        assert!(validate_size(&"a".repeat(MAX_CLIPBOARD_TEXT_BYTES + 1)).is_err());
    }
}
