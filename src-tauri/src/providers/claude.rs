// Claude Code provider implementation

use super::{session_id_from_path, Provider, ProviderError, ProviderId, ProviderUsage};
use crate::session::{extract_session_metadata, parse_session_file, Session, SessionStatus};
use std::path::{Path, PathBuf};

/// Claude Code provider
pub struct ClaudeProvider {
    data_dir: PathBuf,
}

impl ClaudeProvider {
    pub fn new() -> Self {
        Self {
            data_dir: crate::platform::get_claude_dir(),
        }
    }

    #[allow(dead_code)]
    pub fn with_data_dir(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }
}

impl Default for ClaudeProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl Provider for ClaudeProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Claude
    }

    fn is_installed(&self) -> bool {
        crate::platform::is_cli_installed("claude")
    }

    fn get_session_dirs(&self) -> Vec<PathBuf> {
        let projects_dir = self.data_dir.join("projects");
        let Ok(entries) = std::fs::read_dir(&projects_dir) else {
            return vec![];
        };

        entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect()
    }

    fn parse_session(&self, path: &Path) -> Result<Session, ProviderError> {
        let lines = parse_session_file(path)
            .map_err(|e| ProviderError::SessionParse(e.to_string()))?;

        if lines.is_empty() {
            return Err(ProviderError::SessionParse("Empty session file".to_string()));
        }

        let session_id = session_id_from_path(path)?;

        let project_path = path
            .parent()
            .and_then(|p| p.to_str())
            .ok_or_else(|| ProviderError::SessionParse("Invalid project path".to_string()))?
            .to_string();

        let mut session = extract_session_metadata(&session_id, &project_path, &lines);
        session.provider = ProviderId::Claude;

        if self.is_session_active(path) && session.status == SessionStatus::Completed {
            session.status = SessionStatus::Active;
        }

        Ok(session)
    }

    fn get_usage(&self) -> Result<Option<ProviderUsage>, ProviderError> {
        let Some(creds) = crate::usage::read_claude_credentials() else {
            return Ok(Some(ProviderUsage::error(ProviderId::Claude, "No credentials found")));
        };

        let Some(access_token) = creds.access_token else {
            return Ok(Some(ProviderUsage::error(ProviderId::Claude, "No access token")));
        };

        let runtime = tokio::runtime::Runtime::new()
            .map_err(|e| ProviderError::UsageFetch(format!("Failed to create runtime: {}", e)))?;

        let oauth_usage = match runtime.block_on(crate::usage::fetch_oauth_usage(&access_token)) {
            Ok(usage) => usage,
            Err(e) => return Ok(Some(ProviderUsage::error(ProviderId::Claude, e))),
        };

        Ok(Some(ProviderUsage {
            id: ProviderId::Claude,
            session_percent: oauth_usage.five_hour.utilization,
            session_reset_at: Some(oauth_usage.five_hour.resets_at),
            weekly_percent: Some(oauth_usage.seven_day.utilization),
            weekly_reset_at: Some(oauth_usage.seven_day.resets_at),
            last_updated: chrono::Utc::now().timestamp_millis(),
            error: None,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_id() {
        let provider = ClaudeProvider::new();
        assert_eq!(provider.id(), ProviderId::Claude);
    }

    #[test]
    fn test_cli_command() {
        let provider = ClaudeProvider::new();
        assert_eq!(provider.get_cli_command(), "claude");
    }
}
