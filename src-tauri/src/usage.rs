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
    // First, try macOS Keychain (primary storage on macOS)
    #[cfg(target_os = "macos")]
    if let Some(creds) = read_credentials_from_keychain() {
        return Some(creds);
    }

    // Fallback: try to read from ~/.claude/.credentials.json (Linux/Windows)
    let creds_path = crate::platform::get_claude_dir().join(".credentials.json");

    if creds_path.exists() {
        let content = std::fs::read_to_string(&creds_path).ok()?;
        let creds: ClaudeCredentialsFile = serde_json::from_str(&content).ok()?;
        return Some(ClaudeCredentials {
            access_token: creds.access_token,
            account_email: creds.account_email,
        });
    }

    None
}

/// Read credentials from macOS Keychain
#[cfg(target_os = "macos")]
fn read_credentials_from_keychain() -> Option<ClaudeCredentials> {
    use std::process::Command;

    // Try to read from macOS Keychain using security command
    // Service name used by Claude Code CLI
    let output = Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let json_str = String::from_utf8(output.stdout).ok()?;
    let json_str = json_str.trim();

    // Parse the JSON credentials
    let creds: KeychainCredentials = serde_json::from_str(json_str).ok()?;

    // Extract OAuth token from claudeAiOauth
    if let Some(oauth) = creds.claude_ai_oauth {
        // Format subscription type as display name (e.g., "max" -> "Claude Max")
        let account_info = oauth.subscription_type.map(|s| {
            match s.to_lowercase().as_str() {
                "max" => "Claude Max".to_string(),
                "pro" => "Claude Pro".to_string(),
                "free" => "Claude Free".to_string(),
                "team" => "Claude Team".to_string(),
                "enterprise" => "Claude Enterprise".to_string(),
                other => format!("Claude {}", other),
            }
        });

        return Some(ClaudeCredentials {
            access_token: Some(oauth.access_token),
            account_email: account_info,
        });
    }

    None
}

/// Keychain credentials structure (matches Claude Code storage format)
#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeychainCredentials {
    #[serde(default)]
    claude_ai_oauth: Option<ClaudeAiOAuth>,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeAiOAuth {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_at: Option<i64>,
    #[serde(default)]
    subscription_type: Option<String>,
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
    crate::platform::get_alice_dir()
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

/// Anthropic service status
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AnthropicStatus {
    /// Overall status: "operational", "degraded_performance", "partial_outage", "major_outage"
    pub status: String,
    /// Human-readable status description
    pub description: String,
    /// Active incidents
    pub incidents: Vec<StatusIncident>,
    /// Last updated timestamp
    pub last_updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusIncident {
    pub name: String,
    pub status: String,
    pub impact: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Fetch Anthropic service status from status page API
pub async fn fetch_anthropic_status() -> Result<AnthropicStatus, String> {
    let client = reqwest::Client::new();

    // status.anthropic.com uses Atlassian Statuspage API
    let response = client
        .get("https://status.anthropic.com/api/v2/status.json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch status: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Status API error: {}", response.status()));
    }

    let status_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse status: {}", e))?;

    // Parse status response
    let status_info = status_json.get("status").ok_or("Missing status field")?;
    let indicator = status_info
        .get("indicator")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let description = status_info
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown");

    // Fetch incidents
    let incidents = fetch_incidents(&client).await.unwrap_or_default();

    Ok(AnthropicStatus {
        status: indicator.to_string(),
        description: description.to_string(),
        incidents,
        last_updated: chrono::Utc::now().timestamp_millis(),
    })
}

/// Fetch active incidents
async fn fetch_incidents(client: &reqwest::Client) -> Result<Vec<StatusIncident>, String> {
    let response = client
        .get("https://status.anthropic.com/api/v2/incidents/unresolved.json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch incidents: {}", e))?;

    if !response.status().is_success() {
        return Ok(vec![]);
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse incidents: {}", e))?;

    let incidents = json
        .get("incidents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|incident| {
                    Some(StatusIncident {
                        name: incident.get("name")?.as_str()?.to_string(),
                        status: incident.get("status")?.as_str()?.to_string(),
                        impact: incident.get("impact")?.as_str()?.to_string(),
                        created_at: incident.get("created_at")?.as_str()?.to_string(),
                        updated_at: incident.get("updated_at")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(incidents)
}
