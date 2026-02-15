// Configuration management for Alice

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AutoActionType {
    #[default]
    None,
    Sleep,
    Shutdown,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalApp {
    Background,
    #[default]
    System,
    #[serde(rename = "iterm2")]
    ITerm2,
    WindowsTerminal,
    Warp,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoActionConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub action_type: AutoActionType,
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
            action_type: AutoActionType::default(),
            delay_minutes: default_auto_action_delay(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeEnvironment {
    pub id: String,
    pub name: String,
    /// Config directory path (e.g., ~/.claude-yixiao). Empty = default ~/.claude/
    #[serde(default)]
    pub config_dir: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    /// CLI command or alias (e.g., "claude-yixiao")
    #[serde(default)]
    pub command: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfigData {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub data_dir: Option<String>,
}

impl Default for ProviderConfigData {
    fn default() -> Self {
        Self {
            enabled: true,
            data_dir: None,
        }
    }
}

fn default_provider_configs() -> HashMap<String, ProviderConfigData> {
    HashMap::from([
        ("claude".to_string(), ProviderConfigData::default()),
        ("codex".to_string(), ProviderConfigData { enabled: false, ..Default::default() }),
        ("gemini".to_string(), ProviderConfigData { enabled: false, ..Default::default() }),
    ])
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default)]
    pub launch_at_login: bool,
    #[serde(default = "default_true")]
    pub auto_hide_on_blur: bool,
    #[serde(default = "default_true")]
    pub notification_sound: bool,
    #[serde(default)]
    pub voice_notifications: bool,
    #[serde(default)]
    pub notifications: NotificationConfig,
    #[serde(default)]
    pub hooks_installed: bool,
    /// 0 = retain forever
    #[serde(default)]
    pub data_retention_days: u32,
    /// HH:MM format, empty = disabled
    #[serde(default)]
    pub daily_report_time: String,
    /// "auto", "en", "zh", "ja", etc.
    #[serde(default = "default_report_language")]
    pub report_language: String,
    #[serde(default)]
    pub theme: Theme,
    #[serde(default)]
    pub terminal_app: TerminalApp,
    #[serde(default)]
    pub custom_terminal_command: String,
    #[serde(default)]
    pub terminal_choice_made: bool,
    #[serde(default)]
    pub auto_action: AutoActionConfig,
    #[serde(default = "default_environments")]
    pub claude_environments: Vec<ClaudeEnvironment>,
    #[serde(default)]
    pub active_environment_id: Option<String>,
    #[serde(default = "default_provider_configs")]
    pub provider_configs: HashMap<String, ProviderConfigData>,
}

fn default_report_language() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationConfig {
    #[serde(default = "default_true")]
    pub on_task_completed: bool,
    #[serde(default = "default_true")]
    pub on_task_error: bool,
    #[serde(default = "default_true")]
    pub on_needs_input: bool,
    #[serde(default)]
    pub on_queue_started: bool,
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
            report_language: default_report_language(),
            theme: Theme::default(),
            terminal_app: TerminalApp::default(),
            custom_terminal_command: String::new(),
            terminal_choice_made: false,
            auto_action: AutoActionConfig::default(),
            claude_environments: default_environments(),
            active_environment_id: None,
            provider_configs: default_provider_configs(),
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

fn get_config_path() -> PathBuf {
    crate::platform::get_alice_dir().join("config.json")
}

pub fn load_config() -> AppConfig {
    let path = get_config_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path();

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

/// Load config, apply a mutation, save, and return the updated config.
fn modify_and_save(mutate: impl FnOnce(&mut AppConfig) -> Result<(), String>) -> Result<AppConfig, String> {
    let mut config = load_config();
    mutate(&mut config)?;
    save_config(&config)?;
    Ok(config)
}

pub fn update_config_value(key: &str, value: serde_json::Value) -> Result<AppConfig, String> {
    modify_and_save(|config| {
        match key {
            "onboarding_completed" => config.onboarding_completed = value.as_bool().unwrap_or(false),
            "launch_at_login" => config.launch_at_login = value.as_bool().unwrap_or(false),
            "auto_hide_on_blur" => config.auto_hide_on_blur = value.as_bool().unwrap_or(true),
            "notification_sound" => config.notification_sound = value.as_bool().unwrap_or(true),
            "voice_notifications" => config.voice_notifications = value.as_bool().unwrap_or(false),
            "hooks_installed" => config.hooks_installed = value.as_bool().unwrap_or(false),
            "data_retention_days" => config.data_retention_days = value.as_u64().unwrap_or(0) as u32,
            "daily_report_time" => config.daily_report_time = value.as_str().unwrap_or("").to_string(),
            "report_language" => config.report_language = value.as_str().unwrap_or("auto").to_string(),
            "custom_terminal_command" => config.custom_terminal_command = value.as_str().unwrap_or("").to_string(),
            "terminal_choice_made" => config.terminal_choice_made = value.as_bool().unwrap_or(false),

            "notifications.on_task_completed" => config.notifications.on_task_completed = value.as_bool().unwrap_or(true),
            "notifications.on_task_error" => config.notifications.on_task_error = value.as_bool().unwrap_or(true),
            "notifications.on_needs_input" => config.notifications.on_needs_input = value.as_bool().unwrap_or(true),
            "notifications.on_queue_started" => config.notifications.on_queue_started = value.as_bool().unwrap_or(false),
            "notifications.on_daily_report" => config.notifications.on_daily_report = value.as_bool().unwrap_or(true),

            "theme" => config.theme = match value.as_str().unwrap_or("system") {
                "light" => Theme::Light,
                "dark" => Theme::Dark,
                _ => Theme::System,
            },
            "terminal_app" => config.terminal_app = match value.as_str().unwrap_or("system") {
                "background" => TerminalApp::Background,
                "iterm2" => TerminalApp::ITerm2,
                "windows_terminal" => TerminalApp::WindowsTerminal,
                "warp" => TerminalApp::Warp,
                "custom" => TerminalApp::Custom,
                _ => TerminalApp::System,
            },

            "auto_action.enabled" => config.auto_action.enabled = value.as_bool().unwrap_or(false),
            "auto_action.action_type" => config.auto_action.action_type = match value.as_str().unwrap_or("none") {
                "sleep" => AutoActionType::Sleep,
                "shutdown" => AutoActionType::Shutdown,
                _ => AutoActionType::None,
            },
            "auto_action.delay_minutes" => config.auto_action.delay_minutes = value.as_u64().unwrap_or(5) as u32,

            _ => return Err(format!("Unknown config key: {}", key)),
        }
        Ok(())
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbStats {
    pub db_size_bytes: u64,
    pub report_count: usize,
}

pub fn get_db_stats() -> DbStats {
    let alice_dir = crate::platform::get_alice_dir();

    let db_size = std::fs::metadata(alice_dir.join("alice.db"))
        .map(|m| m.len())
        .unwrap_or(0);

    let report_count = std::fs::read_dir(alice_dir.join("reports"))
        .map(|entries| entries.filter_map(|e| e.ok()).count())
        .unwrap_or(0);

    DbStats { db_size_bytes: db_size, report_count }
}

pub fn get_active_environment() -> ClaudeEnvironment {
    let config = load_config();
    let active_id = config.active_environment_id.as_deref().unwrap_or("default");

    config.claude_environments
        .iter()
        .find(|e| e.id == active_id && e.enabled)
        .cloned()
        .unwrap_or_default()
}

pub fn add_environment(env: ClaudeEnvironment) -> Result<AppConfig, String> {
    modify_and_save(|config| {
        if config.claude_environments.iter().any(|e| e.id == env.id) {
            return Err(format!("Environment with ID '{}' already exists", env.id));
        }
        config.claude_environments.push(env);
        Ok(())
    })
}

pub fn update_environment(env: ClaudeEnvironment) -> Result<AppConfig, String> {
    modify_and_save(|config| {
        let existing = config.claude_environments.iter_mut()
            .find(|e| e.id == env.id)
            .ok_or_else(|| format!("Environment with ID '{}' not found", env.id))?;
        *existing = env;
        Ok(())
    })
}

pub fn delete_environment(id: &str) -> Result<AppConfig, String> {
    if id == "default" {
        return Err("Cannot delete the default environment".to_string());
    }

    modify_and_save(|config| {
        let original_len = config.claude_environments.len();
        config.claude_environments.retain(|e| e.id != id);

        if config.claude_environments.len() == original_len {
            return Err(format!("Environment with ID '{}' not found", id));
        }

        if config.active_environment_id.as_deref() == Some(id) {
            config.active_environment_id = None;
        }
        Ok(())
    })
}

pub fn set_active_environment(id: &str) -> Result<AppConfig, String> {
    modify_and_save(|config| {
        if !config.claude_environments.iter().any(|e| e.id == id && e.enabled) {
            return Err(format!("Environment '{}' not found or not enabled", id));
        }
        config.active_environment_id = Some(id.to_string());
        Ok(())
    })
}

pub fn is_claude_installed() -> bool {
    crate::platform::is_cli_installed("claude")
}

pub fn get_claude_version() -> Option<String> {
    let output = std::process::Command::new(crate::platform::get_claude_command())
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())?;

    String::from_utf8(output.stdout)
        .ok()
        .map(|s| s.trim().to_string())
}

#[allow(dead_code)]
pub fn get_provider_config(provider_id: &str) -> ProviderConfigData {
    load_config()
        .provider_configs
        .get(provider_id)
        .cloned()
        .unwrap_or_default()
}

pub fn update_provider_config(provider_id: &str, enabled: bool, data_dir: Option<String>) -> Result<AppConfig, String> {
    modify_and_save(|config| {
        config.provider_configs.insert(
            provider_id.to_string(),
            ProviderConfigData { enabled, data_dir },
        );
        Ok(())
    })
}

#[allow(dead_code)]
pub fn get_enabled_provider_ids() -> Vec<String> {
    load_config()
        .provider_configs
        .into_iter()
        .filter(|(_, cfg)| cfg.enabled)
        .map(|(id, _)| id)
        .collect()
}
