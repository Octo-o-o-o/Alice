// Google Gemini CLI provider implementation
//
// Partial implementation: supports usage tracking (OAuth quota API) and task execution.
// Session file parsing is not implemented (format unknown).

use super::{Provider, ProviderError, ProviderId, ProviderUsage};
use crate::session::Session;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Gemini provider
pub struct GeminiProvider {
    #[allow(dead_code)]
    data_dir: PathBuf,
}

impl GeminiProvider {
    pub fn new() -> Self {
        Self {
            data_dir: crate::platform::get_gemini_dir(),
        }
    }

    #[allow(dead_code)]
    pub fn with_data_dir(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    #[allow(dead_code)]
    fn read_oauth_credentials(&self) -> Option<GeminiOAuthCredentials> {
        let creds_path = self.data_dir.join("oauth_creds.json");
        let content = std::fs::read_to_string(&creds_path).ok()?;
        serde_json::from_str(&content).ok()
    }
}

impl Default for GeminiProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl Provider for GeminiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Gemini
    }

    fn is_installed(&self) -> bool {
        crate::platform::is_cli_installed("gemini")
    }

    fn get_session_dirs(&self) -> Vec<PathBuf> {
        Vec::new()
    }

    fn parse_session(&self, _path: &Path) -> Result<Session, ProviderError> {
        Err(ProviderError::SessionParse(
            "Gemini session parsing not implemented (format unknown)".to_string(),
        ))
    }

    fn get_usage(&self) -> Result<Option<ProviderUsage>, ProviderError> {
        // OAuth usage requires async context - use get_gemini_usage() instead
        Err(ProviderError::UsageFetch(
            "Use get_gemini_usage() async function for OAuth providers".to_string()
        ))
    }

    fn get_cli_command(&self) -> String {
        crate::platform::get_gemini_command().to_string()
    }
}

/// Public async function to get Gemini usage (avoids nested runtime issues)
pub async fn get_gemini_usage() -> Result<ProviderUsage, String> {
    let data_dir = crate::platform::get_gemini_dir();
    let creds_path = data_dir.join("oauth_creds.json");

    if !creds_path.exists() {
        return Ok(ProviderUsage::error(ProviderId::Gemini, "No OAuth credentials found"));
    }

    let content = std::fs::read_to_string(&creds_path)
        .map_err(|e| format!("Failed to read credentials: {}", e))?;

    let creds: GeminiOAuthCredentials = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse credentials: {}", e))?;

    let access_token = creds.access_token
        .ok_or_else(|| "No access token in credentials".to_string())?;

    match fetch_gemini_oauth_usage(&access_token).await {
        Ok(usage) => Ok(usage),
        Err(e) => Ok(ProviderUsage::error(ProviderId::Gemini, &e)),
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct GeminiOAuthCredentials {
    access_token: Option<String>,
    refresh_token: Option<String>,
    #[serde(rename = "expiry_date")]
    expiry_date: Option<f64>,
}

/// Google Cloud Code Quota API response structures
#[derive(Debug, Clone, Deserialize, Serialize)]
struct GeminiQuotaBucket {
    #[serde(rename = "remainingFraction")]
    remaining_fraction: Option<f64>,
    #[serde(rename = "resetTime")]
    reset_time: Option<String>,
    #[serde(rename = "modelId")]
    model_id: Option<String>,
    #[serde(rename = "tokenType")]
    token_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct GeminiQuotaResponse {
    buckets: Option<Vec<GeminiQuotaBucket>>,
}

/// Fetch Gemini usage from Google Cloud Code Quota API
/// Response format: https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
/// {
///   "buckets": [
///     {
///       "remainingFraction": 0.45,
///       "resetTime": "2024-01-01T12:00:00Z",
///       "modelId": "gemini-1.5-pro",
///       "tokenType": "input"
///     }
///   ]
/// }
#[allow(dead_code)]
async fn fetch_gemini_oauth_usage(access_token: &str) -> Result<ProviderUsage, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    tracing::info!("Fetching Gemini quota from Google Cloud Code API");

    let response = client
        .post("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .header("User-Agent", "Alice/1.0")
        .body("{}")
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Gemini API request failed: {}", e);
            format!("Failed to fetch quota: {}", e)
        })?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        tracing::error!("Gemini API returned {}: {}", status, error_body);
        return Err(format!("API returned status {}: {}", status, error_body));
    }

    let quota_response: GeminiQuotaResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let buckets = quota_response.buckets.unwrap_or_default();
    if buckets.is_empty() {
        return Err("No quota buckets in response".to_string());
    }

    // Group by model, keeping the lowest remaining fraction (usually input tokens)
    let mut model_quotas: std::collections::HashMap<String, (f64, Option<String>)> = std::collections::HashMap::new();

    for bucket in buckets {
        if let (Some(model_id), Some(fraction)) = (bucket.model_id, bucket.remaining_fraction) {
            model_quotas
                .entry(model_id.clone())
                .and_modify(|(existing_fraction, existing_reset)| {
                    if fraction < *existing_fraction {
                        *existing_fraction = fraction;
                        *existing_reset = bucket.reset_time.clone();
                    }
                })
                .or_insert((fraction, bucket.reset_time.clone()));
        }
    }

    // Separate Pro and Flash models
    let mut pro_quotas: Vec<(f64, Option<String>)> = Vec::new();
    let mut flash_quotas: Vec<(f64, Option<String>)> = Vec::new();

    for (model_id, (fraction, reset)) in model_quotas {
        let model_lower = model_id.to_lowercase();
        if model_lower.contains("pro") {
            pro_quotas.push((fraction, reset));
        } else if model_lower.contains("flash") {
            flash_quotas.push((fraction, reset));
        }
    }

    // Find minimum quota for each tier
    let pro_min = pro_quotas.iter().min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let flash_min = flash_quotas.iter().min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    // Calculate used percentage from remaining fraction
    // Pro = primary window (24h), Flash = secondary window (24h)
    let session_percent = pro_min.map(|(frac, _)| (1.0 - frac) * 100.0).unwrap_or(0.0);
    let session_reset_at = pro_min.and_then(|(_, reset)| reset.clone());

    let weekly_percent = flash_min.map(|(frac, _)| (1.0 - frac) * 100.0);
    let weekly_reset_at = flash_min.and_then(|(_, reset)| reset.clone());

    Ok(ProviderUsage {
        id: ProviderId::Gemini,
        session_percent,
        session_reset_at,
        weekly_percent,
        weekly_reset_at,
        last_updated: chrono::Utc::now().timestamp_millis(),
        error: None,
    })
}
