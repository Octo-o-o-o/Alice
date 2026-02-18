// Session parsing and data structures

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Session status
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Idle,
    Active,
    #[default]
    Completed,
    Error,
    NeedsInput,
}

impl SessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SessionStatus::Idle => "idle",
            SessionStatus::Active => "active",
            SessionStatus::Completed => "completed",
            SessionStatus::Error => "error",
            SessionStatus::NeedsInput => "needsinput",
        }
    }
}


/// Session summary for list views
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_id: String,
    pub project_path: String,
    pub project_name: String,
    pub first_prompt: Option<String>,
    pub label: Option<String>,
    pub tags: Vec<String>,
    pub started_at: i64,
    pub last_active_at: i64,
    /// Timestamp of the last human/user message (for stable sorting)
    pub last_human_message_at: i64,
    pub message_count: i32,
    pub total_tokens: i64,
    pub total_cost_usd: f64,
    /// Detailed token breakdown
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub model: Option<String>,
    pub status: SessionStatus,
    /// Provider that created this session
    #[serde(default)]
    pub provider: crate::providers::ProviderId,
}

/// Detailed session information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionDetail {
    pub session: Session,
    pub messages: Vec<SessionMessage>,
}

/// Individual message in a session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMessage {
    pub id: Option<String>,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    pub model: Option<String>,
    #[serde(default)]
    pub images: Vec<ImageContent>,
}

/// Image content in a message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageContent {
    #[serde(rename = "type")]
    pub source_type: String, // "base64" or "path"
    pub media_type: Option<String>, // e.g., "image/png", "image/jpeg"
    pub data: Option<String>, // base64 data
    pub path: Option<String>, // file path
}

/// Usage statistics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageStats {
    pub total_tokens: i64,
    pub total_cost_usd: f64,
    pub session_count: i32,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub daily_usage: Vec<DailyUsage>,
    pub project_usage: Vec<ProjectUsage>,
}

/// Daily usage breakdown
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyUsage {
    pub date: String,
    pub tokens: i64,
    pub cost_usd: f64,
    pub session_count: i32,
}

/// Per-project usage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectUsage {
    pub project_name: String,
    pub project_path: String,
    pub tokens: i64,
    pub cost_usd: f64,
    pub session_count: i32,
}

/// Token usage from JSONL
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_input_tokens: i64,
    pub cache_creation_input_tokens: i64,
    #[serde(default)]
    pub cache_creation: Option<CacheCreation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CacheCreation {
    #[serde(default)]
    pub ephemeral_5m_input_tokens: i64,
    #[serde(default)]
    pub ephemeral_1h_input_tokens: i64,
}

/// Raw JSONL line from Claude Code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonlLine {
    #[serde(rename = "type")]
    pub message_type: String,
    /// Timestamp can be either ISO 8601 string or milliseconds integer
    #[serde(default)]
    pub timestamp: Option<Value>,
    #[serde(default)]
    pub message: Option<JsonlMessage>,
    #[serde(default)]
    pub content: Option<Value>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub project: Option<String>,
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonlMessage {
    pub id: Option<String>,
    pub role: Option<String>,
    pub content: Option<Value>,
    pub model: Option<String>,
    pub usage: Option<TokenUsage>,
    pub stop_reason: Option<String>,
}

/// Model pricing (per 1M tokens)
#[derive(Debug, Clone)]
pub struct ModelPricing {
    pub input: f64,
    pub output: f64,
    pub cache_5min: f64,
    pub cache_1h: f64,
    pub cache_read: f64,
}

/// Pricing constants per model tier: (input, output, cache_5min, cache_1h, cache_read)
const OPUS_PRICING: (f64, f64, f64, f64, f64) = (5.0, 25.0, 6.25, 10.0, 0.50);
const SONNET_PRICING: (f64, f64, f64, f64, f64) = (3.0, 15.0, 3.75, 6.0, 0.30);
const HAIKU_PRICING: (f64, f64, f64, f64, f64) = (1.0, 5.0, 1.25, 2.0, 0.10);

/// Cost for a given number of tokens at a per-million rate
fn token_cost(tokens: i64, rate_per_million: f64) -> f64 {
    (tokens as f64 / 1_000_000.0) * rate_per_million
}

impl ModelPricing {
    pub fn for_model(model: &str) -> Self {
        let (input, output, cache_5min, cache_1h, cache_read) = if model.contains("opus") {
            OPUS_PRICING
        } else if model.contains("haiku") {
            HAIKU_PRICING
        } else {
            SONNET_PRICING // default
        };
        ModelPricing { input, output, cache_5min, cache_1h, cache_read }
    }

    pub fn calculate_cost(&self, usage: &TokenUsage) -> f64 {
        let cache_write_cost = match usage.cache_creation {
            Some(ref cc) => {
                token_cost(cc.ephemeral_5m_input_tokens, self.cache_5min)
                    + token_cost(cc.ephemeral_1h_input_tokens, self.cache_1h)
            }
            // Fall back to treating all cache creation as 1h cache
            None => token_cost(usage.cache_creation_input_tokens, self.cache_1h),
        };

        token_cost(usage.input_tokens, self.input)
            + token_cost(usage.output_tokens, self.output)
            + token_cost(usage.cache_read_input_tokens, self.cache_read)
            + cache_write_cost
    }
}

/// Build a dedup key from message ID and request ID.
/// Returns None if both are absent (older logs without IDs).
fn dedup_key(message_id: Option<&str>, request_id: Option<&str>) -> Option<String> {
    match (message_id, request_id) {
        (None, None) | (Some(""), Some("")) => None,
        (msg_id, req_id) => Some(format!(
            "{}:{}",
            msg_id.unwrap_or_default(),
            req_id.unwrap_or_default()
        )),
    }
}

/// Parse a JSONL session file
pub fn parse_session_file(path: &Path) -> Result<Vec<JsonlLine>, std::io::Error> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<JsonlLine>(&line) {
            Ok(parsed) => {
                // Dedup by message.id + requestId (streaming chunks)
                let msg_id = parsed.message.as_ref().and_then(|m| m.id.as_deref());
                let req_id = parsed.request_id.as_deref();
                if let Some(key) = dedup_key(msg_id, req_id) {
                    if !seen.insert(key) {
                        continue; // already seen
                    }
                }
                lines.push(parsed);
            }
            Err(e) => {
                tracing::warn!("Failed to parse JSONL line: {}", e);
            }
        }
    }

    Ok(lines)
}

/// Parse timestamp from various formats (ISO 8601 string or milliseconds integer)
fn parse_timestamp(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                return Some(dt.timestamp_millis());
            }
            // Timezone-less ISO 8601 (assume UTC)
            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f") {
                return Some(dt.and_utc().timestamp_millis());
            }
            s.parse::<i64>().ok()
        }
        _ => None,
    }
}

/// Extract user prompt text from a JSONL line.
/// Tries message.content (new format) then line.content (old format).
fn extract_user_prompt(line: &JsonlLine) -> Option<String> {
    line.message
        .as_ref()
        .and_then(|msg| msg.content.as_ref())
        .and_then(extract_text_from_content)
        .or_else(|| line.content.as_ref().and_then(extract_text_from_content))
}

/// Return `Some(trimmed)` when the string is non-empty after trimming.
fn non_empty_trimmed(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

/// Extract text from content value, handling various formats
fn extract_text_from_content(content: &Value) -> Option<String> {
    match content {
        Value::Array(arr) => {
            for item in arr {
                let Some(text) = item
                    .as_object()
                    .and_then(|obj| obj.get("text"))
                    .and_then(|t| t.as_str())
                else {
                    continue;
                };
                // Skip IDE context messages (ide_opened_file, ide_selection, etc.)
                if text.starts_with('<') && text.contains("ide_") {
                    continue;
                }
                if let result @ Some(_) = non_empty_trimmed(text) {
                    return result;
                }
            }
            None
        }
        Value::String(s) => non_empty_trimmed(s),
        _ => {
            let s = content.to_string().trim_matches('"').to_string();
            if !s.is_empty() && s != "null" { Some(s) } else { None }
        }
    }
}

/// Extract IDs from content array items matching a given type.
/// For example, `extract_content_ids(line, "tool_use", "id")` finds all tool_use block IDs,
/// and `extract_content_ids(line, "tool_result", "tool_use_id")` finds completed tool IDs.
fn extract_content_ids(line: &JsonlLine, type_name: &str, id_field: &str) -> Vec<String> {
    let content = line
        .message
        .as_ref()
        .and_then(|msg| msg.content.as_ref())
        .and_then(|c| c.as_array());

    let Some(arr) = content else { return vec![] };

    arr.iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            if obj.get("type").and_then(|t| t.as_str()) != Some(type_name) {
                return None;
            }
            obj.get(id_field)
                .and_then(|id| id.as_str())
                .map(|s| s.to_string())
        })
        .collect()
}

/// Accumulated token counts and cost for a session.
#[derive(Default)]
struct TokenAccumulator {
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
    total: i64,
    cost_usd: f64,
}

impl TokenAccumulator {
    /// Add a single usage entry, computing cost with the given model name.
    fn add(&mut self, usage: &TokenUsage, model_name: &str) {
        self.input += usage.input_tokens;
        self.output += usage.output_tokens;
        self.cache_read += usage.cache_read_input_tokens;
        self.cache_write += usage.cache_creation_input_tokens
            + usage.cache_creation.as_ref().map_or(0, |c| {
                c.ephemeral_5m_input_tokens + c.ephemeral_1h_input_tokens
            });
        self.total += usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens;
        self.cost_usd += ModelPricing::for_model(model_name).calculate_cost(usage);
    }
}

/// Determine session status from accumulated indicators.
/// The watcher may later override Completed -> Active based on file modification time.
fn determine_status(
    has_error: bool,
    has_pending_tools: bool,
    last_message_type: Option<&str>,
    any_assistant_seen: bool,
) -> SessionStatus {
    if has_error {
        SessionStatus::Error
    } else if has_pending_tools || (last_message_type == Some("user") && !any_assistant_seen) {
        SessionStatus::Active
    } else {
        SessionStatus::Completed
    }
}

/// Extract session metadata from parsed JSONL
pub fn extract_session_metadata(
    session_id: &str,
    project_path: &str,
    lines: &[JsonlLine],
) -> Session {
    let project_name = extract_project_name(project_path);

    let mut first_prompt: Option<String> = None;
    let mut started_at: i64 = 0;
    let mut last_active_at: i64 = 0;
    let mut last_human_message_at: i64 = 0;
    let mut message_count: i32 = 0;
    let mut tokens = TokenAccumulator::default();
    let mut model: Option<String> = None;
    let mut seen_keys: HashSet<String> = HashSet::new();
    let mut any_assistant_seen = false;
    let mut last_message_type: Option<String> = None;
    let mut has_error = false;
    let mut pending_tool_use_ids: HashSet<String> = HashSet::new();

    for line in lines {
        let ts = line.timestamp.as_ref().and_then(parse_timestamp);
        if let Some(ts) = ts {
            if started_at == 0 || ts < started_at {
                started_at = ts;
            }
            if ts > last_active_at {
                last_active_at = ts;
            }
        }

        match line.message_type.as_str() {
            "user" => {
                message_count += 1;
                last_message_type = Some("user".to_string());

                if let Some(ts) = ts {
                    if ts > last_human_message_at {
                        last_human_message_at = ts;
                    }
                }
                if first_prompt.is_none() {
                    first_prompt = extract_user_prompt(line);
                }

                for id in extract_content_ids(line, "tool_result", "tool_use_id") {
                    pending_tool_use_ids.remove(&id);
                }
            }
            "assistant" => {
                message_count += 1;
                last_message_type = Some("assistant".to_string());

                let Some(ref msg) = line.message else { continue };

                if model.is_none() {
                    model = msg.model.clone();
                }

                for id in extract_content_ids(line, "tool_use", "id") {
                    pending_tool_use_ids.insert(id);
                }

                // Accumulate token usage (deduplicated by message+request ID)
                if let Some(ref usage) = msg.usage {
                    let is_new = match dedup_key(msg.id.as_deref(), line.request_id.as_deref()) {
                        Some(key) => seen_keys.insert(key),
                        None => true, // older logs without IDs -- count each line
                    };
                    if is_new {
                        tokens.add(usage, msg.model.as_deref().unwrap_or("sonnet"));
                    }
                }

                any_assistant_seen = true;
            }
            "system" => {
                if let Some(ref content) = line.content {
                    if content.to_string().contains("error") {
                        has_error = true;
                    }
                }
            }
            _ => {}
        }
    }

    if last_human_message_at == 0 {
        last_human_message_at = last_active_at;
    }

    let status = determine_status(
        has_error,
        !pending_tool_use_ids.is_empty(),
        last_message_type.as_deref(),
        any_assistant_seen,
    );

    Session {
        session_id: session_id.to_string(),
        project_path: project_path.to_string(),
        project_name,
        first_prompt,
        label: None,
        tags: vec![],
        started_at,
        last_active_at,
        last_human_message_at,
        message_count,
        total_tokens: tokens.total,
        total_cost_usd: tokens.cost_usd,
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_read_tokens: tokens.cache_read,
        cache_write_tokens: tokens.cache_write,
        model,
        status,
        provider: crate::providers::ProviderId::Claude, // Default to Claude
    }
}

/// Check if a session file is currently active (modified within the last 60 seconds).
/// The generous threshold accounts for long-running CLI operations.
pub fn is_session_active(path: &Path) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .map(|t| t.elapsed().unwrap_or_default().as_secs() < 60)
        .unwrap_or(false)
}

/// Extract project name from path
pub fn extract_project_name(project_path: &str) -> String {
    Path::new(project_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| project_path.to_string())
}
