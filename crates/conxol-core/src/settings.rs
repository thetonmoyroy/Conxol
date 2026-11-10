use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    #[default]
    Dark,
    Light,
    System,
    Dracula,
    Nord,
    Gruvbox,
    #[serde(rename = "tokyoNight")]
    TokyoNight,
    Catppuccin,
    #[serde(rename = "oneDark")]
    OneDark,
    #[serde(rename = "solarizedDark")]
    SolarizedDark,
    #[serde(rename = "solarizedLight")]
    SolarizedLight,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeneralSettings {
    #[serde(default)]
    pub theme: ThemePreference,
    #[serde(default = "default_true")]
    pub confirm_multiline_paste: bool,
    #[serde(default = "default_true")]
    pub paste_preview: bool,
    #[serde(default)]
    pub always_show_terminal_search: bool,
    #[serde(default)]
    pub right_click_to_paste: bool,
    #[serde(default)]
    pub tab_plus_saved_sessions: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            theme: ThemePreference::default(),
            confirm_multiline_paste: true,
            paste_preview: true,
            always_show_terminal_search: false,
            right_click_to_paste: false,
            tab_plus_saved_sessions: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppearanceSettings {
    #[serde(default = "default_font_size")]
    pub font_size: u16,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            font_size: default_font_size(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalSettings {
    #[serde(default = "default_scrollback")]
    pub scrollback_lines: u32,
    #[serde(default = "default_true")]
    pub cursor_blink: bool,
    #[serde(default)]
    pub copy_on_select: bool,
    #[serde(default)]
    pub color_theme: String,
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub foreground: String,
    // Read and discard settings from the removed transparency experiment.
    #[serde(default, skip_serializing, rename = "backgroundOpacity")]
    legacy_background_opacity: Option<u8>,
    #[serde(default, skip_serializing, rename = "blurredTransparency")]
    legacy_blurred_transparency: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyboardSettings {
    #[serde(default = "default_shortcut_new_terminal")]
    pub new_terminal: String,
    #[serde(default = "default_shortcut_quick_connect")]
    pub quick_connect: String,
    #[serde(default = "default_shortcut_command_palette")]
    pub command_palette: String,
    #[serde(default = "default_shortcut_close_tab")]
    pub close_tab: String,
    #[serde(default = "default_shortcut_next_tab")]
    pub next_tab: String,
    #[serde(default = "default_shortcut_previous_tab")]
    pub previous_tab: String,
    #[serde(default = "default_shortcut_split_right")]
    pub split_right: String,
    #[serde(default = "default_shortcut_split_down")]
    pub split_down: String,
    #[serde(default = "default_shortcut_focus_pane")]
    pub focus_pane: String,
    #[serde(default = "default_shortcut_search_terminal")]
    pub search_terminal: String,
    #[serde(default = "default_shortcut_toggle_sidebar")]
    pub toggle_sidebar: String,
    #[serde(default = "default_shortcut_open_macros")]
    pub open_macros: String,
    #[serde(default = "default_shortcut_emergency_broadcast_disable")]
    pub emergency_broadcast_disable: String,
}

impl Default for KeyboardSettings {
    fn default() -> Self {
        Self {
            new_terminal: default_shortcut_new_terminal(),
            quick_connect: default_shortcut_quick_connect(),
            command_palette: default_shortcut_command_palette(),
            close_tab: default_shortcut_close_tab(),
            next_tab: default_shortcut_next_tab(),
            previous_tab: default_shortcut_previous_tab(),
            split_right: default_shortcut_split_right(),
            split_down: default_shortcut_split_down(),
            focus_pane: default_shortcut_focus_pane(),
            search_terminal: default_shortcut_search_terminal(),
            toggle_sidebar: default_shortcut_toggle_sidebar(),
            open_macros: default_shortcut_open_macros(),
            emergency_broadcast_disable: default_shortcut_emergency_broadcast_disable(),
        }
    }
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            scrollback_lines: default_scrollback(),
            cursor_blink: true,
            copy_on_select: false,
            color_theme: String::new(),
            background: String::new(),
            foreground: String::new(),
            legacy_background_opacity: None,
            legacy_blurred_transparency: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SshSettings {
    #[serde(default = "default_true")]
    pub reconnect_enabled: bool,
    #[serde(default = "default_reconnect_attempts")]
    pub reconnect_attempts: u8,
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_ms: u64,
}

impl Default for SshSettings {
    fn default() -> Self {
        Self {
            reconnect_enabled: true,
            reconnect_attempts: default_reconnect_attempts(),
            connect_timeout_ms: default_connect_timeout(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkSettings {
    #[serde(default = "default_diagnostic_timeout")]
    pub diagnostic_timeout_ms: u64,
    #[serde(default = "default_scan_concurrency")]
    pub scan_concurrency: u16,
}

impl Default for NetworkSettings {
    fn default() -> Self {
        Self {
            diagnostic_timeout_ms: default_diagnostic_timeout(),
            scan_concurrency: default_scan_concurrency(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSettings {
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub terminal: TerminalSettings,
    #[serde(default)]
    pub keyboard: KeyboardSettings,
    #[serde(default)]
    pub ssh: SshSettings,
    #[serde(default)]
    pub network: NetworkSettings,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SettingsValidationError {
    #[error("terminal font size must be between 8 and 32")]
    InvalidFontSize,
    #[error("terminal scrollback must be between 100 and 100000 lines")]
    InvalidScrollback,
    #[error("invalid terminal colors or theme")]
    InvalidTerminalAppearance,
    #[error("SSH reconnect attempts must be between 0 and 10")]
    InvalidReconnectAttempts,
    #[error("SSH connect timeout must be between 100 and 60000 milliseconds")]
    InvalidConnectTimeout,
    #[error("diagnostic timeout must be between 50 and 60000 milliseconds")]
    InvalidDiagnosticTimeout,
    #[error("scan concurrency must be between 1 and 128")]
    InvalidScanConcurrency,
    #[error("keyboard shortcut is invalid")]
    InvalidShortcut,
    #[error("keyboard shortcuts must not collide")]
    DuplicateShortcut,
}

impl AppSettings {
    pub fn validate(&self) -> Result<(), SettingsValidationError> {
        if !(8..=32).contains(&self.appearance.font_size) {
            return Err(SettingsValidationError::InvalidFontSize);
        }
        if !(100..=100_000).contains(&self.terminal.scrollback_lines) {
            return Err(SettingsValidationError::InvalidScrollback);
        }
        let terminal = &self.terminal;
        let color_valid = |value: &str| {
            value.is_empty()
                || (value.len() == 7
                    && value.starts_with('#')
                    && value[1..].bytes().all(|b| b.is_ascii_hexdigit()))
        };
        if !["", "dark", "light", "midnight", "dracula", "nord", "gruvbox", "tokyoNight", "catppuccin", "oneDark", "solarizedDark", "solarizedLight"].contains(&terminal.color_theme.as_str())
            || !color_valid(&terminal.background)
            || !color_valid(&terminal.foreground)
        {
            return Err(SettingsValidationError::InvalidTerminalAppearance);
        }
        if self.ssh.reconnect_attempts > 10 {
            return Err(SettingsValidationError::InvalidReconnectAttempts);
        }
        if !(100..=60_000).contains(&self.ssh.connect_timeout_ms) {
            return Err(SettingsValidationError::InvalidConnectTimeout);
        }
        if !(50..=60_000).contains(&self.network.diagnostic_timeout_ms) {
            return Err(SettingsValidationError::InvalidDiagnosticTimeout);
        }
        if !(1..=128).contains(&self.network.scan_concurrency) {
            return Err(SettingsValidationError::InvalidScanConcurrency);
        }
        let shortcuts = [
            &self.keyboard.new_terminal,
            &self.keyboard.quick_connect,
            &self.keyboard.command_palette,
            &self.keyboard.close_tab,
            &self.keyboard.next_tab,
            &self.keyboard.previous_tab,
            &self.keyboard.split_right,
            &self.keyboard.split_down,
            &self.keyboard.focus_pane,
            &self.keyboard.search_terminal,
            &self.keyboard.toggle_sidebar,
            &self.keyboard.open_macros,
            &self.keyboard.emergency_broadcast_disable,
        ];
        let mut signatures = HashSet::new();
        for shortcut in shortcuts {
            if !valid_shortcut(shortcut) {
                return Err(SettingsValidationError::InvalidShortcut);
            }
            if !signatures.insert(shortcut_signature(shortcut)) {
                return Err(SettingsValidationError::DuplicateShortcut);
            }
        }
        Ok(())
    }
}

fn default_true() -> bool {
    true
}

fn default_font_size() -> u16 {
    13
}

fn default_scrollback() -> u32 {
    5_000
}

fn default_reconnect_attempts() -> u8 {
    3
}

fn default_connect_timeout() -> u64 {
    12_000
}

fn default_diagnostic_timeout() -> u64 {
    1_500
}

fn default_scan_concurrency() -> u16 {
    32
}

fn valid_shortcut(shortcut: &str) -> bool {
    let parts = shortcut.split('+').collect::<Vec<_>>();
    if parts.is_empty()
        || parts
            .iter()
            .any(|part| part.trim() != *part || part.is_empty())
    {
        return false;
    }
    let mut modifiers = HashSet::new();
    let mut key = None;
    for part in parts {
        match part {
            "Mod" | "Ctrl" | "Alt" | "Shift" => {
                if !modifiers.insert(part) {
                    return false;
                }
            }
            "Tab" | "Escape" | "Enter" | "Backspace" | "Delete" | "Space" | "ArrowUp"
            | "ArrowDown" | "ArrowLeft" | "ArrowRight" => {
                if key.replace(part).is_some() {
                    return false;
                }
            }
            value if value.len() == 1 && value.as_bytes()[0].is_ascii_alphanumeric() => {
                if key.replace(value).is_some() {
                    return false;
                }
            }
            _ => return false,
        }
    }
    key.is_some() && !(modifiers.contains("Mod") && modifiers.contains("Ctrl"))
}

fn shortcut_signature(shortcut: &str) -> String {
    let parts = shortcut.split('+').collect::<Vec<_>>();
    let mut signature = String::new();
    for modifier in ["Mod", "Ctrl", "Alt", "Shift"] {
        if parts.contains(&modifier) {
            signature.push_str(modifier);
            signature.push('+');
        }
    }
    let key = parts.last().expect("validated shortcuts always have a key");
    signature.push_str(&key.to_ascii_lowercase());
    signature
}

fn default_shortcut_new_terminal() -> String {
    "Mod+N".into()
}

fn default_shortcut_quick_connect() -> String {
    "Mod+K".into()
}

fn default_shortcut_command_palette() -> String {
    "Mod+Shift+P".into()
}

fn default_shortcut_close_tab() -> String {
    "Mod+W".into()
}

fn default_shortcut_next_tab() -> String {
    "Ctrl+Tab".into()
}

fn default_shortcut_previous_tab() -> String {
    "Ctrl+Shift+Tab".into()
}

fn default_shortcut_split_right() -> String {
    "Mod+Shift+ArrowRight".into()
}

fn default_shortcut_split_down() -> String {
    "Mod+Shift+ArrowDown".into()
}

fn default_shortcut_focus_pane() -> String {
    "Mod+1".into()
}

fn default_shortcut_search_terminal() -> String {
    "Mod+F".into()
}

fn default_shortcut_toggle_sidebar() -> String {
    "Mod+Shift+B".into()
}

fn default_shortcut_open_macros() -> String {
    "Mod+Shift+M".into()
}

fn default_shortcut_emergency_broadcast_disable() -> String {
    "Escape".into()
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, SettingsValidationError};

    #[test]
    fn tab_plus_preference_migrates_and_round_trips() {
        let mut general: super::GeneralSettings = serde_json::from_str("{}").unwrap();
        assert!(!general.tab_plus_saved_sessions);
        general.tab_plus_saved_sessions = true;
        let json = serde_json::to_string(&general).unwrap();
        assert!(json.contains("\"tabPlusSavedSessions\":true"));
        assert_eq!(
            serde_json::from_str::<super::GeneralSettings>(&json).unwrap(),
            general
        );
    }

    #[test]
    fn retired_transparency_settings_are_discarded_on_save() {
        let old: super::TerminalSettings =
            serde_json::from_str(r#"{"backgroundOpacity":40,"blurredTransparency":true}"#).unwrap();
        let json = serde_json::to_string(&old).unwrap();
        assert!(!json.contains("backgroundOpacity"));
        assert!(!json.contains("blurredTransparency"));
    }

    #[test]
    fn terminal_appearance_migrates_and_round_trips() {
        let old: super::TerminalSettings = serde_json::from_str(
            r#"{"scrollbackLines":5000,"cursorBlink":true,"copyOnSelect":false}"#,
        )
        .unwrap();
        assert_eq!(old.legacy_background_opacity, None);
        assert_eq!(old.legacy_blurred_transparency, None);
        assert!(old.color_theme.is_empty());
        let mut settings = AppSettings::default();
        settings.terminal.background = "#123abc".into();
        settings.terminal.foreground = "#ffffff".into();
        settings.terminal.color_theme = "midnight".into();
        assert!(settings.validate().is_ok());
        let json = serde_json::to_string(&settings).unwrap();
        assert_eq!(
            serde_json::from_str::<AppSettings>(&json).unwrap(),
            settings
        );
        for preset in ["dracula", "nord", "gruvbox", "tokyoNight", "catppuccin", "oneDark", "solarizedDark", "solarizedLight"] {
            settings.terminal.color_theme = preset.into();
            assert!(settings.validate().is_ok());
            let json = serde_json::to_string(&settings).unwrap();
            assert_eq!(serde_json::from_str::<AppSettings>(&json).unwrap(), settings);
        }
        for theme in ["dracula", "nord", "gruvbox", "tokyoNight", "catppuccin", "oneDark", "solarizedDark", "solarizedLight"] {
            settings.general.theme = serde_json::from_value(serde_json::json!(theme)).unwrap();
            let json = serde_json::to_string(&settings).unwrap();
            assert_eq!(serde_json::from_str::<AppSettings>(&json).unwrap(), settings);
        }
        for color in ["red", "#123", "#xyzxyz", "#12345678"] {
            settings.terminal.background = color.into();
            assert_eq!(
                settings.validate(),
                Err(SettingsValidationError::InvalidTerminalAppearance)
            );
        }
        settings.terminal.background.clear();
        settings.terminal.color_theme = "unknown".into();
        assert_eq!(
            settings.validate(),
            Err(SettingsValidationError::InvalidTerminalAppearance)
        );
    }

    #[test]
    fn defaults_are_safe_and_valid() {
        let settings = AppSettings::default();
        settings.validate().unwrap();
        assert!(settings.general.confirm_multiline_paste);
        assert_eq!(settings.terminal.scrollback_lines, 5_000);
        assert_eq!(settings.keyboard.command_palette, "Mod+Shift+P");
    }

    #[test]
    fn unsafe_ranges_are_rejected() {
        let mut settings = AppSettings::default();
        settings.appearance.font_size = 100;
        assert_eq!(
            settings.validate(),
            Err(SettingsValidationError::InvalidFontSize)
        );
        settings = AppSettings::default();
        settings.network.scan_concurrency = 0;
        assert_eq!(
            settings.validate(),
            Err(SettingsValidationError::InvalidScanConcurrency)
        );
        settings = AppSettings::default();
        settings.keyboard.quick_connect = "Mod+Shift+Unknown".into();
        assert_eq!(
            settings.validate(),
            Err(SettingsValidationError::InvalidShortcut)
        );
        settings.keyboard.quick_connect = settings.keyboard.new_terminal.clone();
        assert_eq!(
            settings.validate(),
            Err(SettingsValidationError::DuplicateShortcut)
        );
        settings.keyboard.quick_connect = "Mod+Mod+K".into();
        assert_eq!(
            settings.validate(),
            Err(SettingsValidationError::InvalidShortcut)
        );
        settings.keyboard.quick_connect = "Mod+Ctrl+K".into();
        assert_eq!(
            settings.validate(),
            Err(SettingsValidationError::InvalidShortcut)
        );
        settings.keyboard.quick_connect = "Shift+Mod+k".into();
        settings.keyboard.new_terminal = "Mod+Shift+K".into();
        assert_eq!(
            settings.validate(),
            Err(SettingsValidationError::DuplicateShortcut)
        );
    }
}
