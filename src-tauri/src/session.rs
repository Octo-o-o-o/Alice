// Session parsing and data structures

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Session status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Idle,
    Active,
    Completed,
    Error,
    NeedsInput,
}

impl Default for SessionStatus {
    fn default() -> Self {
        SessionStatus::Completed
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
    pub timestamp: Option<serde_json::Value>,
    #[serde(default)]
    pub message: Option<JsonlMessage>,
    #[serde(default)]
    pub content: Option<serde_json::Value>,
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
    pub content: Option<serde_json::Value>,
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

impl ModelPricing {
    pub fn for_model(model: &str) -> Self {
        match model {
            m if m.contains("opus") => ModelPricing {
                input: 5.0,
                output: 25.0,
                cache_5min: 6.25,
                cache_1h: 10.0,
                cache_read: 0.50,
            },
            m if m.contains("sonnet") => ModelPricing {
                input: 3.0,
                output: 15.0,
                cache_5min: 3.75,
                cache_1h: 6.0,
                cache_read: 0.30,
            },
            m if m.contains("haiku") => ModelPricing {
                input: 1.0,
                output: 5.0,
                cache_5min: 1.25,
                cache_1h: 2.0,
                cache_read: 0.10,
            },
            _ => ModelPricing {
                input: 3.0,
                output: 15.0,
                cache_5min: 3.75,
                cache_1h: 6.0,
                cache_read: 0.30,
            },
        }
    }

    pub fn calculate_cost(&self, usage: &TokenUsage) -> f64 {
        let input_cost = (usage.input_tokens as f64 / 1_000_000.0) * self.input;
        let output_cost = (usage.output_tokens as f64 / 1_000_000.0) * self.output;
        let cache_read_cost = (usage.cache_read_input_tokens as f64 / 1_000_000.0) * self.cache_read;

        // Calculate cache write cost based on duration
        let cache_write_cost = if let Some(ref cache_creation) = usage.cache_creation {
            let cache_5m_cost =
                (cache_creation.ephemeral_5m_input_tokens as f64 / 1_000_000.0) * self.cache_5min;
            let cache_1h_cost =
                (cache_creation.ephemeral_1h_input_tokens as f64 / 1_000_000.0) * self.cache_1h;
            cache_5m_cost + cache_1h_cost
        } else {
            // Fall back to treating all cache creation as 1h cache
            (usage.cache_creation_input_tokens as f64 / 1_000_000.0) * self.cache_1h
        };

        input_cost + output_cost + cache_read_cost + cache_write_cost
    }
}

/// Parse a JSONL session file
pub fn parse_session_file(path: &Path) -> Result<Vec<JsonlLine>, std::io::Error> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();
    let mut seen_ids: HashMap<String, bool> = HashMap::new();

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<JsonlLine>(&line) {
            Ok(parsed) => {
                // Dedup by message.id + requestId (streaming chunks)
                let dedup_key = format!(
                    "{}:{}",
                    parsed
                        .message
                        .as_ref()
                        .and_then(|m| m.id.clone())
                        .unwrap_or_default(),
                    parsed.request_id.clone().unwrap_or_default()
                );

                if !dedup_key.is_empty() && dedup_key != ":" {
                    if seen_ids.contains_key(&dedup_key) {
                        // Skip duplicate streaming chunk
                        continue;
                    }
                    seen_ids.insert(dedup_key, true);
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
fn parse_timestamp(value: &serde_json::Value) -> Option<i64> {
    match value {
        // Integer milliseconds
        serde_json::Value::Number(n) => n.as_i64(),
        // ISO 8601 string like "2026-02-14T10:50:36.482Z"
        serde_json::Value::String(s) => {
            // Try parsing as ISO 8601
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                return Some(dt.timestamp_millis());
            }
            // Try parsing without timezone (assume UTC)
            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.fZ") {
                return Some(dt.and_utc().timestamp_millis());
            }
            if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f") {
                return Some(dt.and_utc().timestamp_millis());
            }
            // Try parsing as integer string
            s.parse::<i64>().ok()
        }
        _ => None,
    }
}

/// Extract user prompt text from a JSONL line
/// Handles multiple content formats: array of text objects, direct string, etc.
fn extract_user_prompt(line: &JsonlLine) -> Option<String> {
    // Try to get content from message.content first (new format)
    if let Some(ref msg) = line.message {
        if let Some(ref content) = msg.content {
            if let Some(text) = extract_text_from_content(content) {
                return Some(text);
            }
        }
    }

    // Fallback to line.content (old format)
    if let Some(ref content) = line.content {
        if let Some(text) = extract_text_from_content(content) {
            return Some(text);
        }
    }

    None
}

/// Extract text from content value, handling various formats
fn extract_text_from_content(content: &serde_json::Value) -> Option<String> {
    match content {
        // Content is an array of text objects: [{"type": "text", "text": "..."}, ...]
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(obj) = item.as_object() {
                    // Skip IDE context messages (ide_opened_file, ide_selection, etc.)
                    if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                        if !text.starts_with('<') || !text.contains("ide_") {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                return Some(trimmed.to_string());
                            }
                        }
                    }
                }
            }
            None
        }
        // Content is a direct string
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                Some(trimmed.to_string())
            } else {
                None
            }
        }
        // Content is something else - try to convert to string
        _ => {
            let s = content.to_string().trim_matches('"').to_string();
            if !s.is_empty() && s != "null" {
                Some(s)
            } else {
                None
            }
        }
    }
}

/// Extract session metadata from parsed JSONL
pub fn extract_session_metadata(
    session_id: &str,
    project_path: &str,
    lines: &[JsonlLine],
) -> Session {
    let project_name = Path::new(project_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| project_path.to_string());

    let mut first_prompt: Option<String> = None;
    let mut started_at: i64 = 0;
    let mut last_active_at: i64 = 0;
    let mut last_human_message_at: i64 = 0;
    let mut message_count: i32 = 0;
    let mut total_tokens: i64 = 0;
    let mut total_cost_usd: f64 = 0.0;
    // Detailed token breakdown
    let mut input_tokens: i64 = 0;
    let mut output_tokens: i64 = 0;
    let mut cache_read_tokens: i64 = 0;
    let mut cache_write_tokens: i64 = 0;
    let mut model: Option<String> = None;
    // Track seen message+request IDs to deduplicate streaming chunks
    let mut seen_keys: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Track the last assistant message's stop_reason for accurate status determination
    let mut last_assistant_stop_reason: Option<Option<String>> = None;
    let mut last_message_type: Option<String> = None;
    let mut has_error = false;
    // Track tool_use IDs and their corresponding tool_result IDs
    // to detect pending tool executions (active tools without results)
    let mut pending_tool_use_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in lines {
        // Update timestamps
        if let Some(ref ts_value) = line.timestamp {
            if let Some(ts) = parse_timestamp(ts_value) {
                if started_at == 0 || ts < started_at {
                    started_at = ts;
                }
                if ts > last_active_at {
                    last_active_at = ts;
                }
            }
        }

        match line.message_type.as_str() {
            "user" => {
                message_count += 1;
                last_message_type = Some("user".to_string());
                // Track last human message timestamp for stable sorting
                if let Some(ref ts_value) = line.timestamp {
                    if let Some(ts) = parse_timestamp(ts_value) {
                        if ts > last_human_message_at {
                            last_human_message_at = ts;
                        }
                    }
                }
                if first_prompt.is_none() {
                    first_prompt = extract_user_prompt(line);
                }
                // Track tool_result to mark corresponding tool_use as completed
                if let Some(ref msg) = line.message {
                    if let Some(ref content) = msg.content {
                        if let Some(arr) = content.as_array() {
                            for item in arr {
                                if let Some(obj) = item.as_object() {
                                    if obj.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                                        if let Some(tool_use_id) = obj.get("tool_use_id").and_then(|id| id.as_str()) {
                                            pending_tool_use_ids.remove(tool_use_id);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "assistant" => {
                message_count += 1;
                last_message_type = Some("assistant".to_string());
                if let Some(ref msg) = line.message {
                    if model.is_none() {
                        model = msg.model.clone();
                    }
                    // Track tool_use IDs from assistant messages
                    if let Some(ref content) = msg.content {
                        if let Some(arr) = content.as_array() {
                            for item in arr {
                                if let Some(obj) = item.as_object() {
                                    if obj.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                        if let Some(tool_id) = obj.get("id").and_then(|id| id.as_str()) {
                                            pending_tool_use_ids.insert(tool_id.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if let Some(ref usage) = msg.usage {
                        // Deduplicate by message.id + requestId (streaming chunks have same usage)
                        let dedup_key = format!(
                            "{}:{}",
                            msg.id.as_deref().unwrap_or(""),
                            line.request_id.as_deref().unwrap_or("")
                        );
                        let should_count = if !dedup_key.is_empty() && dedup_key != ":" {
                            if seen_keys.contains(&dedup_key) {
                                false
                            } else {
                                seen_keys.insert(dedup_key);
                                true
                            }
                        } else {
                            // Older logs may not have IDs, count each line
                            true
                        };

                        if should_count {
                            // Accumulate detailed token counts
                            input_tokens += usage.input_tokens;
                            output_tokens += usage.output_tokens;
                            cache_read_tokens += usage.cache_read_input_tokens;
                            // Cache write = cache_creation_input_tokens + ephemeral tokens
                            let cache_write = usage.cache_creation_input_tokens
                                + usage.cache_creation.as_ref().map(|c| {
                                    c.ephemeral_5m_input_tokens + c.ephemeral_1h_input_tokens
                                }).unwrap_or(0);
                            cache_write_tokens += cache_write;

                            total_tokens +=
                                usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens;
                            let pricing =
                                ModelPricing::for_model(msg.model.as_deref().unwrap_or("sonnet"));
                            total_cost_usd += pricing.calculate_cost(usage);
                        }
                    }
                    // Track last assistant message's stop_reason (only update if this message has one)
                    // This ensures we capture the final stop_reason from streaming chunks
                    if msg.stop_reason.is_some() {
                        last_assistant_stop_reason = Some(msg.stop_reason.clone());
                    } else if last_assistant_stop_reason.is_none() {
                        // First assistant message without stop_reason
                        last_assistant_stop_reason = Some(None);
                    }
                }
            }
            "system" => {
                // Check for errors
                if let Some(ref content) = line.content {
                    if content.to_string().contains("error") {
                        has_error = true;
                    }
                }
            }
            _ => {}
        }
    }

    // Fall back to last_active_at if no user messages found
    if last_human_message_at == 0 {
        last_human_message_at = last_active_at;
    }

    // Determine session status
    // Note: stop_reason is always null in JSONL files, so we can't rely on it.
    // We use multiple indicators to detect active sessions:
    // 1. Pending tool_use without corresponding tool_result (tool is executing)
    // 2. User message waiting for assistant response
    // 3. File modification time (checked by watcher)
    let has_pending_tools = !pending_tool_use_ids.is_empty();
    let status = if has_error {
        SessionStatus::Error
    } else if has_pending_tools {
        // Tool is currently executing (e.g., Bash command, file write, etc.)
        // This is a reliable indicator of active work even if file isn't being modified
        SessionStatus::Active
    } else if last_message_type.as_deref() == Some("user") && last_assistant_stop_reason.is_none() {
        // User sent a message but no assistant response yet - waiting for response
        SessionStatus::Active
    } else {
        // Default to Completed - watcher will override to Active if file is being modified
        SessionStatus::Completed
    };

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
        total_tokens,
        total_cost_usd,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        model,
        status,
    }
}

/// Check if a session file is currently active (recently modified)
/// Uses 60 second threshold to account for long-running operations like:
/// - Generating large files
/// - Running compilation/build commands
/// - Executing test suites
/// - Waiting for slow network operations
pub fn is_session_active(path: &Path) -> bool {
    if let Ok(metadata) = std::fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            let elapsed = modified.elapsed().unwrap_or_default();
            return elapsed.as_secs() < 60; // Active if modified in last 60 seconds
        }
    }
    false
}

/// Extract project name from path
pub fn extract_project_name(project_path: &str) -> String {
    Path::new(project_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| project_path.to_string())
}
