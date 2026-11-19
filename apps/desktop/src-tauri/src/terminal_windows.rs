//! Detached windows are views only. Existing managers and the main renderer keep
//! session lifetime, input queues and authentication; no connection is recreated.
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[derive(Default)]
pub struct TerminalWindows(Mutex<HashMap<String, String>>);
static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    workspace_id: String,
    message: Value,
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Only the workspace can detach sessions.".into())
    }
}

#[tauri::command]
pub async fn terminal_window_open(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, TerminalWindows>,
    workspace_id: String,
    title: String,
    at_cursor: Option<bool>,
) -> Result<String, String> {
    main_only(&window)?;
    if workspace_id.is_empty()
        || workspace_id.len() > 128
        || !workspace_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid terminal workspace ID.".into());
    }
    let label = format!("terminal-view-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    {
        let mut views = state
            .0
            .lock()
            .map_err(|_| "Terminal window state unavailable.")?;
        if views.len() >= 32 || views.values().any(|id| id == &workspace_id) {
            return Err("Session already detached or window limit reached.".into());
        }
        views.insert(label.clone(), workspace_id);
    }
    let position = if at_cursor == Some(true) {
        drop_position(&window)
    } else {
        None
    };
    let result = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App("index.html?terminal-view".into()),
    )
    .title(format!(
        "{} — Conxol",
        title
            .chars()
            .filter(|c| !c.is_control())
            .take(120)
            .collect::<String>()
    ))
    .inner_size(960.0, 640.0)
    .min_inner_size(400.0, 240.0)
    .visible(position.is_none())
    .build()
    .and_then(|view| {
        if let Some(position) = position {
            let _ = view.set_position(position);
            if let Err(error) = view.show() {
                let _ = view.destroy();
                return Err(error);
            }
            let _ = view.set_focus();
        }
        Ok(view)
    });
    if result.is_err() {
        state
            .0
            .lock()
            .map_err(|_| "Terminal window state unavailable.")?
            .remove(&label);
        return Err("Could not open the terminal window.".into());
    }
    Ok(label)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn drop_position(window: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    // Native screen coordinates stay in physical pixels across mixed-DPI monitors.
    let cursor = window.cursor_position().ok()?;
    let monitor = window.monitor_from_point(cursor.x, cursor.y).ok()??;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let left = area.position.x;
    let top = area.position.y;
    let max_x = left + (area.size.width as i32 - (960.0 * scale).ceil() as i32).max(0);
    let max_y = top + (area.size.height as i32 - (640.0 * scale).ceil() as i32).max(0);
    Some(PhysicalPosition::new(
        (cursor.x as i32).clamp(left, max_x),
        (cursor.y as i32).clamp(top, max_y),
    ))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn drop_position(_window: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    None
}

fn valid_message(message: &Value, from_main: bool) -> bool {
    let limit = if from_main {
        16 * 1024 * 1024
    } else {
        128 * 1024
    };
    if message.to_string().len() > limit {
        return false;
    }
    let kind = message
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if from_main {
        if kind == "font" {
            return matches!(
                message.get("data").and_then(Value::as_str),
                Some("default" | "original" | "slim")
            );
        }
        return matches!(kind, "snapshot" | "output" | "error");
    }
    match kind {
        "ready" | "return" | "close" => true,
        "input" | "paste" => message
            .get("data")
            .and_then(Value::as_str)
            .is_some_and(|s| s.len() <= 64 * 1024),
        "resize" => ["cols", "rows"].iter().all(|key| {
            message
                .get(key)
                .and_then(Value::as_u64)
                .is_some_and(|n| (2..=1000).contains(&n))
        }),
        _ => false,
    }
}

#[tauri::command]
pub fn terminal_window_message(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, TerminalWindows>,
    target: Option<String>,
    message: Value,
) -> Result<(), String> {
    let from_main = window.label() == "main";
    if !valid_message(&message, from_main) {
        return Err("Invalid terminal window message.".into());
    }
    let label = if from_main {
        target.as_deref().ok_or("Missing terminal window.")?
    } else {
        window.label()
    };
    let workspace_id = state
        .0
        .lock()
        .map_err(|_| "Terminal window state unavailable.")?
        .get(label)
        .cloned()
        .ok_or("Terminal window is no longer attached.")?;
    app.emit_to(
        if from_main { label } else { "main" },
        "terminal-window://message",
        Message {
            workspace_id,
            message,
        },
    )
    .map_err(|_| "Terminal window unavailable.".into())
}

#[tauri::command]
pub fn terminal_window_return(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, TerminalWindows>,
    workspace_id: Option<String>,
) -> Result<(), String> {
    let label = {
        let views = state
            .0
            .lock()
            .map_err(|_| "Terminal window state unavailable.")?;
        if window.label() == "main" {
            views
                .iter()
                .find(|(_, id)| Some(id.as_str()) == workspace_id.as_deref())
                .map(|(label, _)| label.clone())
        } else {
            views
                .contains_key(window.label())
                .then(|| window.label().to_owned())
        }
    };
    if let Some(label) = label {
        if let Some(view) = app.get_webview_window(&label) {
            view.close().map_err(|_| "Could not return the terminal.")?;
        }
    }
    Ok(())
}

pub fn returned(app: &AppHandle, label: &str) {
    if let Some(id) = app
        .state::<TerminalWindows>()
        .0
        .lock()
        .ok()
        .and_then(|mut views| views.remove(label))
    {
        let _ = app.emit_to("main", "terminal-window://returned", id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn messages_enforce_direction_and_bounds() {
        assert!(valid_message(
            &json!({"type":"font", "data":"original"}),
            true
        ));
        assert!(!valid_message(
            &json!({"type":"font", "data":"original"}),
            false
        ));
        assert!(!valid_message(
            &json!({"type":"font", "data":"arbitrary"}),
            true
        ));
        assert!(valid_message(
            &json!({"type":"input", "data":"hello"}),
            false
        ));
        assert!(!valid_message(
            &json!({"type":"input", "data":"x".repeat(65537)}),
            false
        ));
        assert!(!valid_message(
            &json!({"type":"snapshot", "data":"spoof"}),
            false
        ));
        assert!(!valid_message(
            &json!({"type":"input", "data":"spoof"}),
            true
        ));
        assert!(valid_message(
            &json!({"type":"resize", "cols":80, "rows":24}),
            false
        ));
        assert!(!valid_message(
            &json!({"type":"resize", "cols":0, "rows":24}),
            false
        ));
        assert!(!valid_message(
            &json!({"type":"resize", "cols":80, "rows":1001}),
            false
        ));
    }
}
