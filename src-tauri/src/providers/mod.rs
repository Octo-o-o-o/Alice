// Provider abstraction for multi-AI CLI support

use crate::session::Session;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

pub mod claude;
pub mod codex;
pub mod gemini;

/// Provider identifier
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    #[default]
    Claude,
    Codex,
    Gemini,
}

impl ProviderId {
    pub fn display_name(&self) -> &'static str {
        match self {
            ProviderId::Claude => "Claude",
            ProviderId::Codex => "Codex",
            ProviderId::Gemini => "Gemini",
        }
    }

    pub fn cli_command(&self) -> &'static str {
        match self {
            ProviderId::Claude => "claude",
            ProviderId::Codex => "codex",
            ProviderId::Gemini => "gemini",
        }
    }

    pub fn default_data_dir(&self) -> PathBuf {
        match self {
            ProviderId::Claude => crate::platform::get_claude_dir(),
            ProviderId::Codex => crate::platform::get_codex_dir(),
            ProviderId::Gemini => crate::platform::get_gemini_dir(),
        }
    }
}


impl std::fmt::Display for ProviderId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

impl std::str::FromStr for ProviderId {
    type Err = ProviderError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "claude" => Ok(ProviderId::Claude),
            "codex" => Ok(ProviderId::Codex),
            "gemini" => Ok(ProviderId::Gemini),
            _ => Err(ProviderError::UnknownProvider(s.to_string())),
        }
    }
}

/// Provider-specific errors
#[derive(Error, Debug)]
pub enum ProviderError {
    #[error("Unknown provider: {0}")]
    UnknownProvider(String),

    #[allow(dead_code)]
    #[error("Provider not installed: {0}")]
    NotInstalled(ProviderId),

    #[error("Session parse error: {0}")]
    SessionParse(String),

    #[allow(dead_code)]
    #[error("Usage fetch error: {0}")]
    UsageFetch(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Provider usage statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsage {
    pub id: ProviderId,
    pub session_percent: f64,
    pub session_reset_at: Option<String>,
    pub weekly_percent: Option<f64>,
    pub weekly_reset_at: Option<String>,
    pub last_updated: i64,
    pub error: Option<String>,
}

impl ProviderUsage {
    /// Create a usage result representing an error state for a given provider.
    #[allow(dead_code)]
    pub fn error(id: ProviderId, message: impl Into<String>) -> Self {
        Self {
            id,
            session_percent: 0.0,
            session_reset_at: None,
            weekly_percent: None,
            weekly_reset_at: None,
            last_updated: chrono::Utc::now().timestamp_millis(),
            error: Some(message.into()),
        }
    }
}

/// Provider trait - implemented by each AI CLI provider
pub trait Provider: Send + Sync {
    /// Get the provider identifier
    fn id(&self) -> ProviderId;

    /// Check if the CLI is installed on the system
    fn is_installed(&self) -> bool;

    /// Get the session directories to monitor
    fn get_session_dirs(&self) -> Vec<PathBuf>;

    /// Parse a session file and extract metadata
    fn parse_session(&self, path: &Path) -> Result<Session, ProviderError>;

    /// Get current usage statistics from OAuth API.
    /// Returns None if provider doesn't support usage tracking.
    #[allow(dead_code)]
    fn get_usage(&self) -> Result<Option<ProviderUsage>, ProviderError> {
        Ok(None)
    }

    /// Get the CLI command to execute tasks
    fn get_cli_command(&self) -> String {
        self.id().cli_command().to_string()
    }

    /// Check if a session file is currently active (modified within last 60 seconds)
    fn is_session_active(&self, path: &Path) -> bool {
        crate::session::is_session_active(path)
    }
}

/// Extract a session ID from a file path (the file stem).
/// Shared by providers that derive session IDs from file names.
pub fn session_id_from_path(path: &Path) -> Result<String, ProviderError> {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ProviderError::SessionParse("Invalid session file name".to_string()))
}

/// Get all available providers
pub fn get_all_providers() -> Vec<Box<dyn Provider>> {
    vec![
        Box::new(claude::ClaudeProvider::new()),
        Box::new(codex::CodexProvider::new()),
        Box::new(gemini::GeminiProvider::new()),
    ]
}

/// Get a provider by ID
pub fn get_provider(id: ProviderId) -> Box<dyn Provider> {
    match id {
        ProviderId::Claude => Box::new(claude::ClaudeProvider::new()),
        ProviderId::Codex => Box::new(codex::CodexProvider::new()),
        ProviderId::Gemini => Box::new(gemini::GeminiProvider::new()),
    }
}

/// Get enabled providers from configuration
pub fn get_enabled_providers() -> Vec<Box<dyn Provider>> {
    let config = crate::config::load_config();

    get_all_providers()
        .into_iter()
        .filter(|provider| {
            config
                .provider_configs
                .get(provider.id().cli_command())
                .map(|cfg| cfg.enabled)
                .unwrap_or(false)
        })
        .collect()
}
