// Usage tracking and OAuth API integration

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// OAuth usage response from Anthropic API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthUsageResponse {
    pub five_hour: UsageWindow,
    pub seven_day: UsageWindow,
    #[serde(default)]
    pub seven_day_sonnet: Option<UsageWindow>,
    #[serde(default)]
    pub seven_day_opus: Option<UsageWindow>,
    #[serde(default)]
    pub extra_usage: Option<ExtraUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    pub percent_used: f64,
    pub reset_at: String, // ISO 8601
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraUsage {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub remaining_usd: Option<f64>,
}

/// Combined usage stats for display
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveUsageStats {
    /// Session (5h window) usage percentage
    pub session_percent: f64,
    /// Session reset time (ISO 8601)
    pub session_reset_at: Option<String>,
    /// Weekly usage percentage
    pub weekly_percent: f64,
    /// Weekly reset time (ISO 8601)
    pub weekly_reset_at: Option<String>,
    /// Current burn rate (% per hour)
    pub burn_rate_per_hour: Option<f64>,
    /// Estimated time until limit hit (minutes)
    pub estimated_limit_in_minutes: Option<i32>,
    /// Account email
    pub account_email: Option<String>,
    /// Account plan (Max, Pro, etc.)
    pub account_plan: Option<String>,
    /// Last updated timestamp
    pub last_updated: i64,
    /// Error message if fetch failed
    pub error: Option<String>,
}

/// Read Claude Code credentials from the system
pub fn read_claude_credentials() -> Option<ClaudeCredentials> {
    // Try to read from ~/.claude/.credentials.json
    let home = dirs::home_dir()?;
    let creds_path = home.join(".claude").join(".credentials.json");

    if creds_path.exists() {
        let content = std::fs::read_to_string(&creds_path).ok()?;
        let creds: ClaudeCredentialsFile = serde_json::from_str(&content).ok()?;
        return Some(ClaudeCredentials {
            access_token: creds.access_token,
            account_email: creds.account_email,
        });
    }

    // Fallback: try macOS Keychain (would need keyring crate)
    // For now, just return None if file doesn't exist
    None
}

#[derive(Debug, Clone, Deserialize)]
struct ClaudeCredentialsFile {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    account_email: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ClaudeCredentials {
    pub access_token: Option<String>,
    pub account_email: Option<String>,
}

/// Fetch live usage from Anthropic OAuth API
pub async fn fetch_oauth_usage(access_token: &str) -> Result<OAuthUsageResponse, String> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch usage: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "API error: {} - {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    response
        .json::<OAuthUsageResponse>()
        .await
        .map_err(|e| format!("Failed to parse usage response: {}", e))
}

/// Calculate burn rate from historical usage
pub fn calculate_burn_rate(
    _current_percent: f64,
    history: &[(i64, f64)], // (timestamp_ms, percent)
) -> Option<f64> {
    if history.len() < 2 {
        return None;
    }

    // Use last hour of data points
    let now = chrono::Utc::now().timestamp_millis();
    let one_hour_ago = now - 3600_000;

    let recent: Vec<_> = history
        .iter()
        .filter(|(ts, _)| *ts > one_hour_ago)
        .collect();

    if recent.len() < 2 {
        return None;
    }

    let first = recent.first()?;
    let last = recent.last()?;

    let time_diff_hours = (last.0 - first.0) as f64 / 3600_000.0;
    let percent_diff = last.1 - first.1;

    if time_diff_hours > 0.0 {
        Some(percent_diff / time_diff_hours)
    } else {
        None
    }
}

/// Estimate time until limit is reached
pub fn estimate_time_to_limit(
    current_percent: f64,
    burn_rate_per_hour: f64,
) -> Option<i32> {
    if burn_rate_per_hour <= 0.0 {
        return None;
    }

    let remaining_percent = 100.0 - current_percent;
    let hours_remaining = remaining_percent / burn_rate_per_hour;
    let minutes_remaining = (hours_remaining * 60.0) as i32;

    Some(minutes_remaining.max(0))
}

/// Parse reset time to countdown string
pub fn format_reset_countdown(reset_at: &str) -> String {
    if let Ok(reset_time) = chrono::DateTime::parse_from_rfc3339(reset_at) {
        let now = chrono::Utc::now();
        let duration = reset_time.signed_duration_since(now);

        let hours = duration.num_hours();
        let minutes = duration.num_minutes() % 60;

        if hours > 0 {
            format!("{}h {}m", hours, minutes)
        } else if minutes > 0 {
            format!("{}m", minutes)
        } else {
            "Soon".to_string()
        }
    } else {
        "Unknown".to_string()
    }
}

/// Store usage history for burn rate calculation
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageHistory {
    pub session_history: Vec<(i64, f64)>, // (timestamp_ms, percent)
    pub weekly_history: Vec<(i64, f64)>,
}

impl UsageHistory {
    const MAX_HISTORY_POINTS: usize = 100;

    pub fn add_session_point(&mut self, percent: f64) {
        let now = chrono::Utc::now().timestamp_millis();
        self.session_history.push((now, percent));

        // Trim old points
        if self.session_history.len() > Self::MAX_HISTORY_POINTS {
            self.session_history = self.session_history
                .split_off(self.session_history.len() - Self::MAX_HISTORY_POINTS);
        }
    }

    pub fn add_weekly_point(&mut self, percent: f64) {
        let now = chrono::Utc::now().timestamp_millis();
        self.weekly_history.push((now, percent));

        // Trim old points
        if self.weekly_history.len() > Self::MAX_HISTORY_POINTS {
            self.weekly_history = self.weekly_history
                .split_off(self.weekly_history.len() - Self::MAX_HISTORY_POINTS);
        }
    }

    pub fn get_session_burn_rate(&self) -> Option<f64> {
        if self.session_history.len() < 2 {
            return None;
        }
        let last = self.session_history.last()?;
        calculate_burn_rate(last.1, &self.session_history)
    }
}

/// Get the Alice data directory
fn get_alice_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".alice")
}

/// Save usage history to disk
pub fn save_usage_history(history: &UsageHistory) -> Result<(), String> {
    let path = get_alice_dir().join("usage_history.json");
    let content = serde_json::to_string_pretty(history)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write history: {}", e))?;
    Ok(())
}

/// Load usage history from disk
pub fn load_usage_history() -> UsageHistory {
    let path = get_alice_dir().join("usage_history.json");
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(history) = serde_json::from_str(&content) {
                return history;
            }
        }
    }
    UsageHistory::default()
}
