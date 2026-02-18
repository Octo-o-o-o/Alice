// Google Gemini CLI provider implementation
//
// Partial implementation: supports usage tracking (OAuth quota API) and task execution.
// Session file parsing is not implemented (format unknown).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{Provider, ProviderError, ProviderId, ProviderUsage};
use crate::session::Session;

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
        Err(ProviderError::UsageFetch(
            "Use get_gemini_usage() async function for OAuth providers".to_string(),
        ))
    }

    fn get_cli_command(&self) -> String {
        crate::platform::get_gemini_command().to_string()
    }
}

// -- OAuth credentials --

#[derive(Debug, Clone, Deserialize)]
struct GeminiOAuthCredentials {
    access_token: Option<String>,
}

// -- Quota API response structures --

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

#[derive(Debug, Clone, Deserialize)]
struct GeminiQuotaResponse {
    buckets: Option<Vec<GeminiQuotaBucket>>,
}

// -- Public async usage entry point --

/// Public async function to get Gemini usage (avoids nested runtime issues).
pub async fn get_gemini_usage() -> Result<ProviderUsage, String> {
    let data_dir = crate::platform::get_gemini_dir();
    let creds_path = data_dir.join("oauth_creds.json");

    if !creds_path.exists() {
        return Ok(ProviderUsage::error(
            ProviderId::Gemini,
            "No OAuth credentials found",
        ));
    }

    let content = std::fs::read_to_string(&creds_path)
        .map_err(|e| format!("Failed to read credentials: {}", e))?;

    let creds: GeminiOAuthCredentials = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse credentials: {}", e))?;

    let access_token = creds
        .access_token
        .ok_or_else(|| "No access token in credentials".to_string())?;

    fetch_gemini_oauth_usage(&access_token)
        .await
        .or_else(|e| Ok(ProviderUsage::error(ProviderId::Gemini, &e)))
}

// -- Quota fetching and parsing --

/// Fetch Gemini usage from Google Cloud Code Quota API.
///
/// Response format from `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`:
/// ```json
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
/// ```
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

    let model_quotas = aggregate_model_quotas(&buckets);
    build_usage_from_quotas(&model_quotas)
}

/// A model's lowest remaining fraction and corresponding reset time.
struct ModelQuota {
    remaining_fraction: f64,
    reset_time: Option<String>,
}

/// Group quota buckets by model, keeping the lowest remaining fraction per model.
fn aggregate_model_quotas(buckets: &[GeminiQuotaBucket]) -> HashMap<String, ModelQuota> {
    let mut quotas: HashMap<String, ModelQuota> = HashMap::new();

    for bucket in buckets {
        let (Some(model_id), Some(fraction)) =
            (bucket.model_id.as_ref(), bucket.remaining_fraction)
        else {
            continue;
        };

        quotas
            .entry(model_id.clone())
            .and_modify(|existing| {
                if fraction < existing.remaining_fraction {
                    existing.remaining_fraction = fraction;
                    existing.reset_time = bucket.reset_time.clone();
                }
            })
            .or_insert(ModelQuota {
                remaining_fraction: fraction,
                reset_time: bucket.reset_time.clone(),
            });
    }

    quotas
}

/// Find the minimum remaining fraction among models whose names contain `keyword`.
fn min_quota_for_tier<'a>(
    quotas: &'a HashMap<String, ModelQuota>,
    keyword: &str,
) -> Option<&'a ModelQuota> {
    quotas
        .iter()
        .filter(|(model_id, _)| model_id.to_lowercase().contains(keyword))
        .map(|(_, quota)| quota)
        .min_by(|a, b| {
            a.remaining_fraction
                .partial_cmp(&b.remaining_fraction)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

/// Convert a remaining fraction (0.0..1.0) to a used percentage (0..100).
fn remaining_to_used_percent(remaining_fraction: f64) -> f64 {
    (1.0 - remaining_fraction) * 100.0
}

/// Build the final ProviderUsage from aggregated per-model quotas.
/// Pro models map to the session (primary) window; Flash models to the weekly (secondary) window.
fn build_usage_from_quotas(
    model_quotas: &HashMap<String, ModelQuota>,
) -> Result<ProviderUsage, String> {
    let pro_min = min_quota_for_tier(model_quotas, "pro");
    let flash_min = min_quota_for_tier(model_quotas, "flash");

    Ok(ProviderUsage {
        id: ProviderId::Gemini,
        session_percent: pro_min
            .map(|q| remaining_to_used_percent(q.remaining_fraction))
            .unwrap_or(0.0),
        session_reset_at: pro_min.and_then(|q| q.reset_time.clone()),
        weekly_percent: flash_min.map(|q| remaining_to_used_percent(q.remaining_fraction)),
        weekly_reset_at: flash_min.and_then(|q| q.reset_time.clone()),
        last_updated: chrono::Utc::now().timestamp_millis(),
        error: None,
    })
}
