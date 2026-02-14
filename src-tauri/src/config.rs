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

/// Auto action type after all tasks complete
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AutoActionType {
    /// No action
    None,
    /// Put system to sleep
    Sleep,
    /// Shut down the system
    Shutdown,
}

impl Default for AutoActionType {
    fn default() -> Self {
        AutoActionType::None
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

/// Auto action configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoActionConfig {
    /// Whether auto action is enabled
    #[serde(default)]
    pub enabled: bool,
    /// Action type (sleep/shutdown)
    #[serde(default)]
    pub action_type: AutoActionType,
    /// Delay in minutes before executing action
    #[serde(default = "default_auto_action_delay")]
    pub delay_minutes: u32,
}

fn default_auto_action_delay() -> u32 {
    5
}

impl Default for AutoActionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            action_type: AutoActionType::None,
            delay_minutes: 5,
        }
    }
}

/// Claude Code environment configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeEnvironment {
    /// Unique identifier (e.g., "default", "yixiao", "yufei")
    pub id: String,
    /// Display name
    pub name: String,
    /// Claude config directory path (e.g., ~/.claude-yixiao)
    /// If empty, uses default ~/.claude/
    #[serde(default)]
    pub config_dir: String,
    /// Optional API key (for users with their own Anthropic API key)
    #[serde(default)]
    pub api_key: Option<String>,
    /// Optional model name (e.g., "claude-sonnet-4-5-20250929")
    #[serde(default)]
    pub model: Option<String>,
    /// CLI command or alias (e.g., "claude-yixiao", default "claude")
    #[serde(default)]
    pub command: Option<String>,
    /// Whether this environment is enabled
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl Default for ClaudeEnvironment {
    fn default() -> Self {
        Self {
            id: "default".to_string(),
            name: "Default".to_string(),
            config_dir: String::new(),
            api_key: None,
            model: None,
            command: None,
            enabled: true,
        }
    }
}

fn default_environments() -> Vec<ClaudeEnvironment> {
    vec![ClaudeEnvironment::default()]
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
    /// Auto action after all tasks complete
    #[serde(default)]
    pub auto_action: AutoActionConfig,
    /// Claude environments (for multi-environment support)
    #[serde(default = "default_environments")]
    pub claude_environments: Vec<ClaudeEnvironment>,
    /// Active environment ID (if None, uses "default")
    #[serde(default)]
    pub active_environment_id: Option<String>,
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
            auto_action: AutoActionConfig::default(),
            claude_environments: default_environments(),
            active_environment_id: None,
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
        "auto_action.enabled" => {
            config.auto_action.enabled = value.as_bool().unwrap_or(false);
        }
        "auto_action.action_type" => {
            let action_str = value.as_str().unwrap_or("none");
            config.auto_action.action_type = match action_str {
                "sleep" => AutoActionType::Sleep,
                "shutdown" => AutoActionType::Shutdown,
                _ => AutoActionType::None,
            };
        }
        "auto_action.delay_minutes" => {
            config.auto_action.delay_minutes = value.as_u64().unwrap_or(5) as u32;
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

/// Get the active Claude environment
pub fn get_active_environment() -> ClaudeEnvironment {
    let config = load_config();
    let active_id = config.active_environment_id.as_deref().unwrap_or("default");

    config.claude_environments
        .iter()
        .find(|e| e.id == active_id && e.enabled)
        .cloned()
        .unwrap_or_default()
}

/// Get a Claude environment by ID
pub fn get_environment_by_id(id: &str) -> Option<ClaudeEnvironment> {
    let config = load_config();
    config.claude_environments
        .iter()
        .find(|e| e.id == id)
        .cloned()
}

/// Get all enabled Claude environments
pub fn get_enabled_environments() -> Vec<ClaudeEnvironment> {
    let config = load_config();
    config.claude_environments
        .iter()
        .filter(|e| e.enabled)
        .cloned()
        .collect()
}

/// Add a new Claude environment
pub fn add_environment(env: ClaudeEnvironment) -> Result<AppConfig, String> {
    let mut config = load_config();

    // Check if ID already exists
    if config.claude_environments.iter().any(|e| e.id == env.id) {
        return Err(format!("Environment with ID '{}' already exists", env.id));
    }

    config.claude_environments.push(env);
    save_config(&config)?;
    Ok(config)
}

/// Update an existing Claude environment
pub fn update_environment(env: ClaudeEnvironment) -> Result<AppConfig, String> {
    let mut config = load_config();

    if let Some(existing) = config.claude_environments.iter_mut().find(|e| e.id == env.id) {
        *existing = env;
        save_config(&config)?;
        Ok(config)
    } else {
        Err(format!("Environment with ID '{}' not found", env.id))
    }
}

/// Delete a Claude environment
pub fn delete_environment(id: &str) -> Result<AppConfig, String> {
    if id == "default" {
        return Err("Cannot delete the default environment".to_string());
    }

    let mut config = load_config();
    let original_len = config.claude_environments.len();
    config.claude_environments.retain(|e| e.id != id);

    if config.claude_environments.len() == original_len {
        return Err(format!("Environment with ID '{}' not found", id));
    }

    // If active environment was deleted, reset to default
    if config.active_environment_id.as_deref() == Some(id) {
        config.active_environment_id = None;
    }

    save_config(&config)?;
    Ok(config)
}

/// Set the active environment
pub fn set_active_environment(id: &str) -> Result<AppConfig, String> {
    let mut config = load_config();

    // Verify environment exists
    if !config.claude_environments.iter().any(|e| e.id == id && e.enabled) {
        return Err(format!("Environment '{}' not found or not enabled", id));
    }

    config.active_environment_id = Some(id.to_string());
    save_config(&config)?;
    Ok(config)
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
