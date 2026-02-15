// Usage tracking and OAuth API integration

use serde::{Deserialize, Serialize};

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
    pub seven_day_oauth_apps: Option<UsageWindow>,
    #[serde(default)]
    pub seven_day_cowork: Option<UsageWindow>,
    #[serde(default)]
    pub extra_usage: Option<ExtraUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    /// Usage percentage (0-100). API returns this as "utilization"
    #[serde(alias = "percent_used")]
    pub utilization: f64,
    /// Reset time in ISO 8601 format. API returns this as "resets_at"
    #[serde(alias = "reset_at")]
    pub resets_at: String,
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

    let oauth = creds.claude_ai_oauth?;

    // Format subscription type as display name (e.g., "max" -> "Claude Max")
    let plan_display = oauth.subscription_type.map(|s| {
        let label = match s.to_lowercase().as_str() {
            "max" => "Max",
            "pro" => "Pro",
            "free" => "Free",
            "team" => "Team",
            "enterprise" => "Enterprise",
            _ => return format!("Claude {}", s),
        };
        format!("Claude {}", label)
    });

    Some(ClaudeCredentials {
        access_token: Some(oauth.access_token),
        account_email: plan_display,
    })
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
    #[allow(dead_code)]
    refresh_token: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
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
    #[allow(dead_code)]
    refresh_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ClaudeCredentials {
    pub access_token: Option<String>,
    pub account_email: Option<String>,
}

/// Fetch live usage from Anthropic OAuth API
pub async fn fetch_oauth_usage(access_token: &str) -> Result<OAuthUsageResponse, String> {
    const MAX_ATTEMPTS: u32 = 2;
    const RETRY_DELAY_MS: u64 = 500;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut last_error = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        match client
            .get("https://api.anthropic.com/api/oauth/usage")
            .header("Authorization", format!("Bearer {}", access_token))
            .header("anthropic-beta", "oauth-2025-04-20")
            .send()
            .await
        {
            Ok(response) => {
                if !response.status().is_success() {
                    return Err(format!(
                        "API error: {} - {}",
                        response.status(),
                        response.text().await.unwrap_or_default()
                    ));
                }
                return response
                    .json::<OAuthUsageResponse>()
                    .await
                    .map_err(|e| format!("Failed to parse usage response: {}", e));
            }
            Err(e) => {
                last_error = format!("Failed to fetch usage: {}", e);
                if attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS)).await;
                }
            }
        }
    }

    Err(last_error)
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
#[allow(dead_code)]
pub fn format_reset_countdown(reset_at: &str) -> String {
    let Ok(reset_time) = chrono::DateTime::parse_from_rfc3339(reset_at) else {
        return "Unknown".to_string();
    };

    let duration = reset_time.signed_duration_since(chrono::Utc::now());
    let hours = duration.num_hours();
    let minutes = duration.num_minutes() % 60;

    if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else if minutes > 0 {
        format!("{}m", minutes)
    } else {
        "Soon".to_string()
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

    fn add_point(history: &mut Vec<(i64, f64)>, percent: f64) {
        let now = chrono::Utc::now().timestamp_millis();
        history.push((now, percent));
        if history.len() > Self::MAX_HISTORY_POINTS {
            *history = history.split_off(history.len() - Self::MAX_HISTORY_POINTS);
        }
    }

    pub fn add_session_point(&mut self, percent: f64) {
        Self::add_point(&mut self.session_history, percent);
    }

    #[allow(dead_code)]
    pub fn add_weekly_point(&mut self, percent: f64) {
        Self::add_point(&mut self.weekly_history, percent);
    }

    pub fn get_session_burn_rate(&self) -> Option<f64> {
        if self.session_history.len() < 2 {
            return None;
        }
        let last = self.session_history.last()?;
        calculate_burn_rate(last.1, &self.session_history)
    }
}

/// Save usage history to disk
pub fn save_usage_history(history: &UsageHistory) -> Result<(), String> {
    let path = crate::platform::get_alice_dir().join("usage_history.json");
    let content = serde_json::to_string_pretty(history)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write history: {}", e))?;
    Ok(())
}

/// Load usage history from disk
pub fn load_usage_history() -> UsageHistory {
    let path = crate::platform::get_alice_dir().join("usage_history.json");
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
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

/// Atlassian Statuspage API response types (used for typed deserialization)
#[derive(Deserialize)]
struct StatusPageResponse {
    status: StatusPageInfo,
}

#[derive(Deserialize)]
struct StatusPageInfo {
    #[serde(default)]
    indicator: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Deserialize)]
struct IncidentsResponse {
    #[serde(default)]
    incidents: Vec<StatusIncidentRaw>,
}

#[derive(Deserialize)]
struct StatusIncidentRaw {
    name: String,
    status: String,
    impact: String,
    created_at: String,
    updated_at: String,
}

impl From<StatusIncidentRaw> for StatusIncident {
    fn from(raw: StatusIncidentRaw) -> Self {
        Self {
            name: raw.name,
            status: raw.status,
            impact: raw.impact,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
        }
    }
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

    let parsed: StatusPageResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse status: {}", e))?;

    let incidents = fetch_incidents(&client).await.unwrap_or_default();

    Ok(AnthropicStatus {
        status: parsed.status.indicator.unwrap_or_else(|| "unknown".to_string()),
        description: parsed.status.description.unwrap_or_else(|| "Unknown".to_string()),
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

    let parsed: IncidentsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse incidents: {}", e))?;

    Ok(parsed.incidents.into_iter().map(StatusIncident::from).collect())
}
