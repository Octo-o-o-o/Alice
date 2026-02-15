// OpenAI Codex CLI provider implementation

use super::{session_id_from_path, Provider, ProviderError, ProviderId, ProviderUsage};
use crate::session::{Session, SessionStatus};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

/// Codex provider
pub struct CodexProvider {
    data_dir: PathBuf,
}

impl CodexProvider {
    pub fn new() -> Self {
        Self {
            data_dir: crate::platform::get_codex_dir(),
        }
    }

    #[allow(dead_code)]
    pub fn with_data_dir(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }
}

impl Default for CodexProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl Provider for CodexProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Codex
    }

    fn is_installed(&self) -> bool {
        crate::platform::is_cli_installed("codex")
    }

    fn get_session_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = Vec::new();

        // Walk YYYY/MM/DD directory structure under ~/.codex/sessions/
        let sessions_dir = self.data_dir.join("sessions");
        if sessions_dir.exists() {
            collect_leaf_dirs(&sessions_dir, 3, &mut dirs);
        }

        // Archived sessions are a flat directory
        let archived_dir = self.data_dir.join("archived_sessions");
        if archived_dir.is_dir() {
            dirs.push(archived_dir);
        }

        dirs
    }

    fn parse_session(&self, path: &Path) -> Result<Session, ProviderError> {
        let lines = parse_codex_session_file(path)
            .map_err(|e| ProviderError::SessionParse(e.to_string()))?;

        if lines.is_empty() {
            return Err(ProviderError::SessionParse("Empty session file".to_string()));
        }

        let session_id = session_id_from_path(path)?;
        Ok(build_codex_session(&session_id, path, &lines))
    }

    fn get_usage(&self) -> Result<Option<ProviderUsage>, ProviderError> {
        // OAuth usage requires async context - use get_codex_usage() instead
        Err(ProviderError::UsageFetch(
            "Use get_codex_usage() async function for OAuth providers".to_string()
        ))
    }
}

/// Public async function to get Codex usage (avoids nested runtime issues)
pub async fn get_codex_usage() -> Result<ProviderUsage, String> {
    let data_dir = crate::platform::get_codex_dir();
    let auth_path = data_dir.join("auth.json");

    if !auth_path.exists() {
        return Ok(ProviderUsage::error(ProviderId::Codex, "No auth file found"));
    }

    let auth_content = std::fs::read_to_string(&auth_path)
        .map_err(|e| format!("Failed to read auth file: {}", e))?;

    let auth_json: serde_json::Value = serde_json::from_str(&auth_content)
        .map_err(|e| format!("Failed to parse auth file: {}", e))?;

    let access_token = auth_json
        .get("tokens")
        .and_then(|t| t.get("access_token"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No access_token in tokens object".to_string())?;

    match fetch_codex_oauth_usage(access_token).await {
        Ok(usage) => Ok(usage),
        Err(e) => Ok(ProviderUsage::error(ProviderId::Codex, &e)),
    }
}

/// Recursively collect subdirectories at a given depth.
/// At depth 0, pushes the directory itself. Otherwise descends into children.
fn collect_leaf_dirs(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        out.push(dir.to_path_buf());
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            collect_leaf_dirs(&path, depth - 1, out);
        }
    }
}

// -- Codex JSONL parsing types --

// 2025 Format (old)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexJsonlLine {
    #[serde(default)]
    pub event_msg: Option<serde_json::Value>,
    #[serde(default)]
    pub token_count: Option<CodexTokenCount>,
    #[serde(default)]
    pub turn_context: Option<CodexTurnContext>,
    #[serde(default)]
    pub timestamp: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexTokenCount {
    #[serde(default)]
    pub input: i64,
    #[serde(default)]
    pub output: i64,
    #[serde(default)]
    pub cached: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexTurnContext {
    #[serde(default)]
    pub model: Option<String>,
}

// 2026 Format (new) - supports both formats
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Codex2026Line {
    #[serde(default)]
    pub timestamp: Option<String>,  // ISO 8601 string
    #[serde(default, rename = "type")]
    pub line_type: Option<String>,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
}

/// 2026 format token usage structure (from event_msg with type=token_count)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Codex2026TokenUsage {
    #[serde(default)]
    pub input_tokens: i64,
    #[serde(default)]
    pub cached_input_tokens: i64,
    #[serde(default)]
    pub output_tokens: i64,
    #[serde(default)]
    pub reasoning_output_tokens: i64,
    #[serde(default)]
    pub total_tokens: i64,
}

/// Unified parsed line that works with both formats
#[derive(Debug, Clone)]
struct ParsedCodexLine {
    pub timestamp_ms: Option<i64>,
    pub model: Option<String>,
    pub token_count: Option<CodexTokenCount>,
    /// 2026 format token usage (different structure)
    pub token_usage_2026: Option<Codex2026TokenUsage>,
}

/// Parse ISO 8601 timestamp to milliseconds since epoch
fn parse_iso_timestamp(ts: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// Check if a line type is a known 2026 format type
fn is_2026_line_type(line_type: Option<&str>) -> bool {
    matches!(
        line_type,
        Some("session_meta") | Some("turn_context") | Some("event_msg") | Some("item") | Some("response_item")
    )
}

/// Parse a single JSONL line, trying both 2026 and 2025 formats
fn parse_codex_line(line_str: &str) -> Option<ParsedCodexLine> {
    // Try 2026 format first - check for specific 2026 type values
    // 2026 format has types like: session_meta, turn_context, event_msg, item
    // 2025 format has types like: message (which should NOT be treated as 2026)
    if let Ok(line2026) = serde_json::from_str::<Codex2026Line>(line_str) {
        // Only treat as 2026 format if it has a known 2026 type AND payload
        if is_2026_line_type(line2026.line_type.as_deref()) && line2026.payload.is_some() {
            let timestamp_ms = line2026.timestamp
                .as_ref()
                .and_then(|ts| parse_iso_timestamp(ts));

            let mut model = None;
            let mut token_usage_2026 = None;

            if let Some(ref payload) = line2026.payload {
                // Extract model from turn_context
                if line2026.line_type.as_deref() == Some("turn_context") {
                    model = payload.get("model")
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string());
                }

                // Extract token counts from event_msg with type=token_count
                if line2026.line_type.as_deref() == Some("event_msg") {
                    if payload.get("type").and_then(|t| t.as_str()) == Some("token_count") {
                        if let Some(info) = payload.get("info") {
                            // Parse total_token_usage (cumulative for the session)
                            if let Some(usage) = info.get("total_token_usage") {
                                token_usage_2026 = serde_json::from_value(usage.clone()).ok();
                            }
                        }
                    }
                }
            }

            return Some(ParsedCodexLine {
                timestamp_ms,
                model,
                token_count: None,
                token_usage_2026,
            });
        }
    }

    // Try 2025 format
    if let Ok(line2025) = serde_json::from_str::<CodexJsonlLine>(line_str) {
        return Some(ParsedCodexLine {
            timestamp_ms: line2025.timestamp,
            model: line2025.turn_context.and_then(|tc| tc.model),
            token_count: line2025.token_count,
            token_usage_2026: None,
        });
    }

    None
}

fn parse_codex_session_file(path: &Path) -> Result<Vec<ParsedCodexLine>, std::io::Error> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        match parse_codex_line(&line) {
            Some(parsed) => lines.push(parsed),
            None => tracing::warn!("Failed to parse Codex JSONL line from: {}",
                path.file_name().unwrap_or_default().to_string_lossy()),
        }
    }

    Ok(lines)
}

/// Convert a SystemTime to epoch milliseconds, falling back to `fallback`.
fn system_time_to_millis(time: std::time::SystemTime, fallback: i64) -> i64 {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
        .unwrap_or(fallback)
}

/// OpenAI model pricing (per 1M tokens)
/// GPT-4o: input $2.5, output $10, cached $1.25
/// GPT-5.2-codex: input $2, output $8, cached $0.5
/// Note: cached_input_tokens is a SUBSET of input_tokens, reasoning_output_tokens is a SUBSET of output_tokens
struct CodexModelPricing {
    input: f64,
    output: f64,
    cached: f64,
}

impl CodexModelPricing {
    fn for_model(model: Option<&str>) -> Self {
        match model {
            // GPT-5.2-codex pricing
            Some(m) if m.contains("5.2") || m.contains("gpt-5") => Self {
                input: 2.0,
                output: 8.0,
                cached: 0.5,
            },
            // Default to GPT-4o pricing
            _ => Self {
                input: 2.5,
                output: 10.0,
                cached: 1.25,
            },
        }
    }

    /// Calculate cost given token counts
    /// - input_tokens: total input tokens (includes cached)
    /// - output_tokens: total output tokens (includes reasoning)
    /// - cached_input_tokens: subset of input_tokens that were cached (cheaper)
    fn calculate_cost(&self, input_tokens: i64, output_tokens: i64, cached_input_tokens: i64) -> f64 {
        // Non-cached input tokens pay full price
        let non_cached_input = input_tokens - cached_input_tokens;
        // Cached input tokens get discount
        let cached_input = cached_input_tokens;
        // All output tokens (including reasoning) pay same price
        let output = output_tokens;

        (non_cached_input as f64 / 1_000_000.0) * self.input
            + (cached_input as f64 / 1_000_000.0) * self.cached
            + (output as f64 / 1_000_000.0) * self.output
    }
}

/// Build a Session from parsed Codex JSONL lines
fn build_codex_session(session_id: &str, path: &Path, lines: &[ParsedCodexLine]) -> Session {
    let mut total_input = 0i64;
    let mut total_output = 0i64;
    let mut total_cached = 0i64;
    let mut model = None;
    let mut first_timestamp = None;
    let mut last_timestamp = None;
    let mut latest_2026_usage: Option<Codex2026TokenUsage> = None;

    for line in lines {
        // 2025 format token counts (incremental)
        if let Some(ref tc) = line.token_count {
            total_input += tc.input;
            total_output += tc.output;
            total_cached += tc.cached;
        }

        // 2026 format token usage (cumulative - use the latest one)
        if let Some(ref usage) = line.token_usage_2026 {
            latest_2026_usage = Some(usage.clone());
        }

        if model.is_none() {
            model = line.model.clone();
        }

        if let Some(ts) = line.timestamp_ms {
            if first_timestamp.is_none() {
                first_timestamp = Some(ts);
            }
            last_timestamp = Some(ts);
        }
    }

    // If we have 2026 format usage data, use it (it's cumulative so last value is total)
    // Note: cached_input_tokens is a SUBSET of input_tokens, not additional
    // Note: reasoning_output_tokens is a SUBSET of output_tokens, not additional
    if let Some(usage) = latest_2026_usage {
        total_input = usage.input_tokens;
        total_output = usage.output_tokens;
        total_cached = usage.cached_input_tokens;
    }

    // Resolve timestamps: prefer JSONL data, fall back to file metadata
    let file_metadata = std::fs::metadata(path).ok();
    let now = chrono::Utc::now().timestamp_millis();

    let (started_at, last_active_at) = match (first_timestamp, last_timestamp) {
        (Some(first), Some(last)) => (first, last),
        _ => {
            if let Some(ref meta) = file_metadata {
                let created = meta
                    .created()
                    .ok()
                    .map(|t| system_time_to_millis(t, now))
                    .unwrap_or(now);
                let modified = meta
                    .modified()
                    .ok()
                    .map(|t| system_time_to_millis(t, created))
                    .unwrap_or(created);
                (created, modified)
            } else {
                (now, now)
            }
        }
    };

    let project_path = path
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("unknown")
        .to_string();

    let project_name = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    // Calculate pricing based on model
    // total_tokens = input_tokens + output_tokens (cached and reasoning are subsets, not additional)
    let pricing = CodexModelPricing::for_model(model.as_deref());
    let total_tokens = total_input + total_output;
    let total_cost_usd = pricing.calculate_cost(total_input, total_output, total_cached);

    let status = if crate::session::is_session_active(path) {
        SessionStatus::Active
    } else {
        SessionStatus::Completed
    };

    Session {
        session_id: session_id.to_string(),
        project_path,
        project_name,
        first_prompt: None,
        label: None,
        tags: vec![],
        started_at,
        last_active_at,
        last_human_message_at: last_active_at,
        message_count: lines.len() as i32,
        total_tokens,
        total_cost_usd,
        input_tokens: total_input,
        output_tokens: total_output,  // Already includes reasoning_output_tokens
        cache_read_tokens: total_cached,
        cache_write_tokens: 0,
        model,
        status,
        provider: ProviderId::Codex,
    }
}

/// Fetch Codex usage from OAuth API
/// Response format: https://chatgpt.com/backend-api/wham/usage
/// {
///   "plan_type": "team",
///   "rate_limit": {
///     "primary_window": {
///       "used_percent": 100,
///       "reset_at": 1234567890,
///       "limit_window_seconds": 18000
///     },
///     "secondary_window": {
///       "used_percent": 45,
///       "reset_at": 1234567890,
///       "limit_window_seconds": 604800
///     }
///   },
///   "credits": { ... }
/// }
#[allow(dead_code)]
async fn fetch_codex_oauth_usage(access_token: &str) -> Result<ProviderUsage, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    tracing::info!("Fetching Codex usage from ChatGPT API");

    let response = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .header("User-Agent", "Alice/1.0")
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Codex API request failed: {}", e);
            format!("Failed to fetch usage: {}", e)
        })?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        tracing::error!("Codex API returned {}: {}", status, error_body);
        return Err(format!("API returned status {}: {}", status, error_body));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let rate_limit = json.get("rate_limit");
    let primary = rate_limit.and_then(|r| r.get("primary_window"));
    let secondary = rate_limit.and_then(|r| r.get("secondary_window"));

    // Extract session usage (primary window - typically 5h)
    let session_percent = primary
        .and_then(|p| p.get("used_percent"))
        .and_then(|v| v.as_i64())
        .map(|i| i as f64)
        .unwrap_or(0.0);

    let session_reset_at = primary
        .and_then(|p| p.get("reset_at"))
        .and_then(|v| v.as_i64())
        .map(|ts| {
            chrono::DateTime::from_timestamp(ts, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default()
        });

    // Extract weekly usage (secondary window)
    let weekly_percent = secondary
        .and_then(|s| s.get("used_percent"))
        .and_then(|v| v.as_i64())
        .map(|i| i as f64);

    let weekly_reset_at = secondary
        .and_then(|s| s.get("reset_at"))
        .and_then(|v| v.as_i64())
        .and_then(|ts| {
            chrono::DateTime::from_timestamp(ts, 0)
                .map(|dt| dt.to_rfc3339())
        });

    Ok(ProviderUsage {
        id: ProviderId::Codex,
        session_percent,
        session_reset_at,
        weekly_percent,
        weekly_reset_at,
        last_updated: chrono::Utc::now().timestamp_millis(),
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_id() {
        let provider = CodexProvider::new();
        assert_eq!(provider.id(), ProviderId::Codex);
    }

    #[test]
    fn test_cli_command() {
        let provider = CodexProvider::new();
        assert_eq!(provider.get_cli_command(), "codex");
    }
}
