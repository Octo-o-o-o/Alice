// Session parsing and data structures

// chrono is used for date/time operations
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
    pub message_count: i32,
    pub total_tokens: i64,
    pub total_cost_usd: f64,
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
    pub timestamp: Option<i64>,
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
    let mut message_count: i32 = 0;
    let mut total_tokens: i64 = 0;
    let mut total_cost_usd: f64 = 0.0;
    let mut model: Option<String> = None;
    let mut status = SessionStatus::Completed;

    for line in lines {
        // Update timestamps
        if let Some(ts) = line.timestamp {
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
                if first_prompt.is_none() {
                    if let Some(ref content) = line.content {
                        first_prompt = Some(content.to_string().trim_matches('"').to_string());
                    }
                }
            }
            "assistant" => {
                message_count += 1;
                if let Some(ref msg) = line.message {
                    if model.is_none() {
                        model = msg.model.clone();
                    }
                    if let Some(ref usage) = msg.usage {
                        total_tokens +=
                            usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens;
                        let pricing =
                            ModelPricing::for_model(msg.model.as_deref().unwrap_or("sonnet"));
                        total_cost_usd += pricing.calculate_cost(usage);
                    }
                    // Check for stop_reason to determine status
                    if msg.stop_reason.is_none() {
                        status = SessionStatus::Active;
                    } else if msg.stop_reason.as_deref() == Some("end_turn") {
                        status = SessionStatus::Completed;
                    }
                }
            }
            "system" => {
                // Check for errors
                if let Some(ref content) = line.content {
                    if content.to_string().contains("error") {
                        status = SessionStatus::Error;
                    }
                }
            }
            _ => {}
        }
    }

    Session {
        session_id: session_id.to_string(),
        project_path: project_path.to_string(),
        project_name,
        first_prompt,
        label: None,
        tags: vec![],
        started_at,
        last_active_at,
        message_count,
        total_tokens,
        total_cost_usd,
        model,
        status,
    }
}

/// Check if a session file is currently active (recently modified)
pub fn is_session_active(path: &Path) -> bool {
    if let Ok(metadata) = std::fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            let elapsed = modified.elapsed().unwrap_or_default();
            return elapsed.as_secs() < 10; // Active if modified in last 10 seconds
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
