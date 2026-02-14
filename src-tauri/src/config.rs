// Configuration management for Alice

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Theme setting
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::System
    }
}

/// Terminal application setting for task execution
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalApp {
    /// Run in background (no visible terminal)
    Background,
    /// macOS: Terminal.app, Windows: cmd.exe
    System,
    /// macOS: iTerm2
    #[serde(rename = "iterm2")]
    ITerm2,
    /// Windows Terminal (wt.exe)
    WindowsTerminal,
    /// Warp terminal
    Warp,
    /// Custom terminal command
    Custom,
}

impl Default for TerminalApp {
    fn default() -> Self {
        TerminalApp::System
    }
}

/// Application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Onboarding completed flag
    #[serde(default)]
    pub onboarding_completed: bool,
    /// Launch Alice at system login
    #[serde(default)]
    pub launch_at_login: bool,
    /// Auto-hide panel when clicking outside
    #[serde(default = "default_true")]
    pub auto_hide_on_blur: bool,
    /// Play notification sound
    #[serde(default = "default_true")]
    pub notification_sound: bool,
    /// Voice notifications using TTS (macOS say command)
    #[serde(default)]
    pub voice_notifications: bool,
    /// Notification settings
    #[serde(default)]
    pub notifications: NotificationConfig,
    /// Claude Code hooks installed
    #[serde(default)]
    pub hooks_installed: bool,
    /// Data retention days (0 = forever)
    #[serde(default)]
    pub data_retention_days: u32,
    /// Daily report auto-generation time (HH:MM, empty = disabled)
    #[serde(default)]
    pub daily_report_time: String,
    /// Theme setting (system, light, dark)
    #[serde(default)]
    pub theme: Theme,
    /// Terminal application for task execution
    #[serde(default)]
    pub terminal_app: TerminalApp,
    /// Custom terminal command (used when terminal_app is Custom)
    #[serde(default)]
    pub custom_terminal_command: String,
    /// Whether terminal choice has been made (for first-run prompt)
    #[serde(default)]
    pub terminal_choice_made: bool,
}

fn default_true() -> bool {
    true
}

/// Notification configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationConfig {
    /// Notify on task completion
    #[serde(default = "default_true")]
    pub on_task_completed: bool,
    /// Notify on task error
    #[serde(default = "default_true")]
    pub on_task_error: bool,
    /// Notify when input is needed
    #[serde(default = "default_true")]
    pub on_needs_input: bool,
    /// Notify when queue item starts
    #[serde(default)]
    pub on_queue_started: bool,
    /// Notify daily report ready
    #[serde(default = "default_true")]
    pub on_daily_report: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            onboarding_completed: false,
            launch_at_login: false,
            auto_hide_on_blur: true,
            notification_sound: true,
            voice_notifications: false,
            notifications: NotificationConfig::default(),
            hooks_installed: false,
            data_retention_days: 0,
            daily_report_time: String::new(),
            theme: Theme::default(),
            terminal_app: TerminalApp::default(),
            custom_terminal_command: String::new(),
            terminal_choice_made: false,
        }
    }
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            on_task_completed: true,
            on_task_error: true,
            on_needs_input: true,
            on_queue_started: false,
            on_daily_report: true,
        }
    }
}

/// Get the config file path
fn get_config_path() -> PathBuf {
    crate::platform::get_alice_dir().join("config.json")
}

/// Load configuration from disk
pub fn load_config() -> AppConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    AppConfig::default()
}

/// Save configuration to disk
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

/// Update a single config value
pub fn update_config_value(key: &str, value: serde_json::Value) -> Result<AppConfig, String> {
    let mut config = load_config();

    match key {
        "onboarding_completed" => {
            config.onboarding_completed = value.as_bool().unwrap_or(false);
        }
        "launch_at_login" => {
            config.launch_at_login = value.as_bool().unwrap_or(false);
        }
        "auto_hide_on_blur" => {
            config.auto_hide_on_blur = value.as_bool().unwrap_or(true);
        }
        "notification_sound" => {
            config.notification_sound = value.as_bool().unwrap_or(true);
        }
        "voice_notifications" => {
            config.voice_notifications = value.as_bool().unwrap_or(false);
        }
        "hooks_installed" => {
            config.hooks_installed = value.as_bool().unwrap_or(false);
        }
        "data_retention_days" => {
            config.data_retention_days = value.as_u64().unwrap_or(0) as u32;
        }
        "daily_report_time" => {
            config.daily_report_time = value.as_str().unwrap_or("").to_string();
        }
        "notifications.on_task_completed" => {
            config.notifications.on_task_completed = value.as_bool().unwrap_or(true);
        }
        "notifications.on_task_error" => {
            config.notifications.on_task_error = value.as_bool().unwrap_or(true);
        }
        "notifications.on_needs_input" => {
            config.notifications.on_needs_input = value.as_bool().unwrap_or(true);
        }
        "notifications.on_queue_started" => {
            config.notifications.on_queue_started = value.as_bool().unwrap_or(false);
        }
        "notifications.on_daily_report" => {
            config.notifications.on_daily_report = value.as_bool().unwrap_or(true);
        }
        "theme" => {
            let theme_str = value.as_str().unwrap_or("system");
            config.theme = match theme_str {
                "light" => Theme::Light,
                "dark" => Theme::Dark,
                _ => Theme::System,
            };
        }
        "terminal_app" => {
            let terminal_str = value.as_str().unwrap_or("system");
            config.terminal_app = match terminal_str {
                "background" => TerminalApp::Background,
                "iterm2" => TerminalApp::ITerm2,
                "windows_terminal" => TerminalApp::WindowsTerminal,
                "warp" => TerminalApp::Warp,
                "custom" => TerminalApp::Custom,
                _ => TerminalApp::System,
            };
        }
        "custom_terminal_command" => {
            config.custom_terminal_command = value.as_str().unwrap_or("").to_string();
        }
        "terminal_choice_made" => {
            config.terminal_choice_made = value.as_bool().unwrap_or(false);
        }
        _ => return Err(format!("Unknown config key: {}", key)),
    }

    save_config(&config)?;
    Ok(config)
}

/// Get database statistics
pub fn get_db_stats() -> DbStats {
    let alice_dir = crate::platform::get_alice_dir();

    let db_path = alice_dir.join("alice.db");
    let db_size = std::fs::metadata(&db_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Count reports
    let reports_dir = alice_dir.join("reports");
    let report_count = if reports_dir.exists() {
        std::fs::read_dir(&reports_dir)
            .map(|entries| entries.filter_map(|e| e.ok()).count())
            .unwrap_or(0)
    } else {
        0
    };

    DbStats {
        db_size_bytes: db_size,
        report_count,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbStats {
    pub db_size_bytes: u64,
    pub report_count: usize,
}

/// Check if Claude Code is installed
pub fn is_claude_installed() -> bool {
    crate::platform::is_cli_installed("claude")
}

/// Get Claude Code version
pub fn get_claude_version() -> Option<String> {
    std::process::Command::new(crate::platform::get_claude_command())
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
}
