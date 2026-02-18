// Tauri IPC command handlers bridging the frontend and backend.

use crate::database::{self, Task};
use crate::providers::Provider;
use crate::session::{Session, SessionDetail, UsageStats};
use std::fmt::Write;
use tauri::{AppHandle, Emitter, Manager, Window};

// ============================================================================
// Helpers
// ============================================================================

/// Convert any `Display` error into the `String` error type Tauri commands require.
fn str_err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Read a JSON settings file, merge `new_hooks` into its `"hooks"` object, and write it back.
///
/// If the file does not exist or is invalid JSON, starts from an empty object.
fn merge_hooks_into_settings(
    settings_path: &std::path::Path,
    new_hooks: serde_json::Value,
) -> Result<(), String> {
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(settings_path).map_err(str_err)?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let settings_obj = settings
        .as_object_mut()
        .ok_or("Settings is not a JSON object")?;

    match settings_obj.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        Some(existing_hooks) => {
            for (key, value) in new_hooks.as_object().unwrap() {
                existing_hooks.insert(key.clone(), value.clone());
            }
        }
        None => {
            settings_obj.insert("hooks".to_string(), new_hooks);
        }
    }

    let content = serde_json::to_string_pretty(&settings).map_err(str_err)?;
    std::fs::write(settings_path, content).map_err(str_err)
}

// ============================================================================
// Sessions
// ============================================================================

#[tauri::command]
pub async fn get_sessions(
    app: AppHandle,
    project: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Session>, String> {
    database::get_sessions(&app, project.as_deref(), limit.unwrap_or(50)).map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_session_detail(
    app: AppHandle,
    session_id: String,
) -> Result<SessionDetail, String> {
    database::get_session_detail(&app, &session_id).map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_session_images(
    app: AppHandle,
    session_id: String,
) -> Result<Vec<crate::session::ImageContent>, String> {
    database::get_session_images(&app, &session_id).map_err(str_err)
}

#[tauri::command]
pub async fn get_active_sessions(app: AppHandle) -> Result<Vec<Session>, String> {
    database::get_active_sessions(&app).map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_usage_stats(
    app: AppHandle,
    project: Option<String>,
    provider: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<UsageStats, String> {
    database::get_usage_stats(
        &app,
        project.as_deref(),
        provider.as_deref(),
        start_date.as_deref(),
        end_date.as_deref(),
    )
    .map_err(str_err)
}

#[tauri::command]
pub async fn search_sessions(
    app: AppHandle,
    query: String,
    project: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Session>, String> {
    database::search_sessions(&app, &query, project.as_deref(), limit.unwrap_or(20))
        .map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn search_sessions_filtered(
    app: AppHandle,
    query: Option<String>,
    project: Option<String>,
    status: Option<String>,
    model: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Session>, String> {
    database::search_sessions_filtered(
        &app,
        query.as_deref(),
        project.as_deref(),
        status.as_deref(),
        model.as_deref(),
        date_from.as_deref(),
        date_to.as_deref(),
        limit.unwrap_or(50),
    )
    .map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn resume_session(session_id: String) -> Result<String, String> {
    Ok(format!("claude --resume {}", session_id))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn fork_session(session_id: String) -> Result<String, String> {
    Ok(format!("claude --fork-session {}", session_id))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_session_label(
    app: AppHandle,
    session_id: String,
    label: Option<String>,
) -> Result<(), String> {
    database::update_session_label(&app, &session_id, label.as_deref()).map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_session(app: AppHandle, session_id: String) -> Result<(), String> {
    database::delete_session(&app, &session_id).map_err(str_err)
}

#[tauri::command]
pub async fn rescan_sessions(app: AppHandle) -> Result<u32, String> {
    let provider_ids: Vec<_> = crate::providers::get_enabled_providers()
        .iter()
        .map(|p| p.id())
        .collect();
    tracing::info!("Enabled providers for rescan: {:?}", provider_ids);

    crate::watcher::rescan_all_sessions(&app).map_err(str_err)
}

#[tauri::command]
pub async fn debug_get_enabled_providers() -> Result<Vec<String>, String> {
    let providers = crate::providers::get_enabled_providers();
    Ok(providers.iter().map(|p| format!("{:?}", p.id())).collect())
}

#[tauri::command]
pub async fn debug_get_codex_dirs() -> Result<Vec<String>, String> {
    let provider = crate::providers::codex::CodexProvider::new();
    let dirs = provider.get_session_dirs();
    Ok(dirs.iter().map(|d| d.display().to_string()).collect())
}

#[tauri::command]
pub async fn debug_codex_db_sessions(app: AppHandle) -> Result<Vec<String>, String> {
    let sessions = database::get_sessions(&app, None, 5000).map_err(str_err)?;

    Ok(sessions
        .into_iter()
        .filter(|s| s.provider.to_string().to_lowercase() == "codex")
        .map(|s| format!("{} - {} - {}", s.session_id, s.started_at, s.project_path))
        .collect())
}

/// Export session as JSON or Markdown
#[tauri::command(rename_all = "camelCase")]
pub async fn export_session(
    app: AppHandle,
    session_id: String,
    format: String,
) -> Result<String, String> {
    let detail = database::get_session_detail(&app, &session_id).map_err(str_err)?;

    match format.as_str() {
        "json" => serde_json::to_string_pretty(&detail).map_err(str_err),
        "markdown" => Ok(format_session_markdown(&detail)),
        _ => Err("Invalid format. Use 'json' or 'markdown'".to_string()),
    }
}

fn format_session_markdown(detail: &SessionDetail) -> String {
    let s = &detail.session;
    let mut md = format!(
        "# Session: {}\n\n\
         **Session ID**: `{}`\n\
         **Model**: {}\n\
         **Status**: {:?}\n\
         **Tokens**: {}\n\
         **Cost**: ${:.2}\n\n\
         ## Messages\n\n",
        s.project_name,
        s.session_id,
        s.model.as_deref().unwrap_or("unknown"),
        s.status,
        s.total_tokens,
        s.total_cost_usd,
    );

    for msg in &detail.messages {
        let role = match msg.role.as_str() {
            "user" => "\u{1f464} User",
            "assistant" => "\u{1f916} Assistant",
            _ => &msg.role,
        };
        let _ = write!(md, "### {}\n\n{}\n\n", role, msg.content);
    }

    md
}

// ============================================================================
// Tasks
// ============================================================================

#[tauri::command]
pub async fn get_tasks(
    app: AppHandle,
    status: Option<String>,
    project: Option<String>,
) -> Result<Vec<Task>, String> {
    let status = status.and_then(|s| s.parse().ok());
    database::get_tasks(&app, status, project.as_deref()).map_err(str_err)
}

#[tauri::command]
pub async fn create_task(
    app: AppHandle,
    prompt: String,
    project: Option<String>,
    priority: Option<String>,
    notes: Option<String>,
) -> Result<Task, String> {
    database::create_task(
        &app,
        &prompt,
        project.as_deref(),
        priority.as_deref(),
        notes.as_deref(),
    )
    .map_err(str_err)
}

#[tauri::command]
pub async fn update_task(
    app: AppHandle,
    id: String,
    status: Option<String>,
    prompt: Option<String>,
    priority: Option<String>,
    sort_order: Option<i32>,
) -> Result<Task, String> {
    let status = status.and_then(|s| s.parse().ok());
    database::update_task(&app, &id, status, prompt.as_deref(), priority.as_deref(), sort_order)
        .map_err(str_err)
}

#[tauri::command]
pub async fn delete_task(app: AppHandle, id: String) -> Result<(), String> {
    database::delete_task(&app, &id).map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_tasks(app: AppHandle, task_ids: Vec<String>) -> Result<(), String> {
    database::reorder_tasks(&app, task_ids).map_err(str_err)
}

// ============================================================================
// Favorites
// ============================================================================

#[tauri::command]
pub async fn get_favorites(app: AppHandle) -> Result<Vec<database::Favorite>, String> {
    database::get_favorites(&app).map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_favorite(
    app: AppHandle,
    name: String,
    prompt: String,
    project_path: Option<String>,
    tags: Option<String>,
) -> Result<database::Favorite, String> {
    database::create_favorite(&app, &name, &prompt, project_path.as_deref(), tags.as_deref())
        .map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_favorite(
    app: AppHandle,
    id: String,
    name: Option<String>,
    prompt: Option<String>,
    project_path: Option<Option<String>>,
    tags: Option<String>,
) -> Result<database::Favorite, String> {
    let project_path_ref = project_path.as_ref().map(|pp| pp.as_deref());
    database::update_favorite(
        &app,
        &id,
        name.as_deref(),
        prompt.as_deref(),
        project_path_ref,
        tags.as_deref(),
    )
    .map_err(str_err)
}

#[tauri::command]
pub async fn delete_favorite(app: AppHandle, id: String) -> Result<(), String> {
    database::delete_favorite(&app, &id).map_err(str_err)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_favorites(app: AppHandle, favorite_ids: Vec<String>) -> Result<(), String> {
    database::reorder_favorites(&app, favorite_ids).map_err(str_err)
}

// ============================================================================
// Usage & Credentials
// ============================================================================

#[tauri::command]
pub async fn get_live_usage() -> Result<crate::usage::LiveUsageStats, String> {
    let mut stats = crate::usage::LiveUsageStats {
        last_updated: chrono::Utc::now().timestamp_millis(),
        ..Default::default()
    };

    let Some(creds) = crate::usage::read_claude_credentials() else {
        stats.error = Some("No credentials found".to_string());
        return Ok(stats);
    };

    stats.account_email = creds.account_email;

    let Some(access_token) = creds.access_token else {
        stats.error = Some("No access token found".to_string());
        return Ok(stats);
    };

    match crate::usage::fetch_oauth_usage(&access_token).await {
        Ok(response) => {
            stats.session_percent = response.five_hour.utilization;
            stats.session_reset_at = Some(response.five_hour.resets_at);
            stats.weekly_percent = response.seven_day.utilization;
            stats.weekly_reset_at = Some(response.seven_day.resets_at);

            let mut history = crate::usage::load_usage_history();
            history.add_session_point(stats.session_percent);

            if let Some(burn_rate) = history.get_session_burn_rate() {
                stats.burn_rate_per_hour = Some(burn_rate);
                stats.estimated_limit_in_minutes =
                    crate::usage::estimate_time_to_limit(stats.session_percent, burn_rate);
            }

            let _ = crate::usage::save_usage_history(&history);
        }
        Err(e) => {
            stats.error = Some(e);
        }
    }

    Ok(stats)
}

#[tauri::command]
pub async fn has_claude_credentials() -> bool {
    crate::usage::read_claude_credentials()
        .and_then(|c| c.access_token)
        .is_some()
}

/// Get live usage stats for any provider (Codex, Gemini, etc.)
#[tauri::command]
pub async fn get_provider_usage(provider: String) -> Result<crate::providers::ProviderUsage, String> {
    match provider.as_str() {
        "codex" => crate::providers::codex::get_codex_usage().await,
        "gemini" => crate::providers::gemini::get_gemini_usage().await,
        "claude" => Err("Use get_live_usage for Claude".to_string()),
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

#[tauri::command]
pub async fn get_anthropic_status() -> Result<crate::usage::AnthropicStatus, String> {
    crate::usage::fetch_anthropic_status().await
}

// ============================================================================
// Queue
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct QueueStartResult {
    pub started: bool,
    pub needs_terminal_choice: bool,
}

#[tauri::command]
pub async fn start_queue(app: AppHandle) -> Result<QueueStartResult, String> {
    let config = crate::config::load_config();
    if !config.terminal_choice_made {
        return Ok(QueueStartResult {
            started: false,
            needs_terminal_choice: true,
        });
    }

    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::queue::start_queue(&app).await {
            tracing::error!("Queue execution error: {}", e);
        }
    });

    Ok(QueueStartResult {
        started: true,
        needs_terminal_choice: false,
    })
}

#[tauri::command]
pub async fn stop_queue() -> Result<(), String> {
    crate::queue::stop_queue().await
}

#[tauri::command]
pub async fn get_queue_status() -> Result<bool, String> {
    Ok(crate::queue::is_queue_running().await)
}

// ============================================================================
// Reports
// ============================================================================

#[tauri::command]
pub async fn generate_daily_report(
    app: AppHandle,
    date: Option<String>,
) -> Result<crate::report::DailyReport, String> {
    let date = date.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    crate::report::generate_report_with_ai(&app, &date).await
}

#[tauri::command]
pub async fn get_daily_report(date: String) -> Result<crate::report::DailyReport, String> {
    crate::report::load_report(&date)
}

#[tauri::command]
pub async fn list_reports() -> Result<Vec<String>, String> {
    crate::report::list_reports()
}

#[tauri::command]
pub async fn export_report_markdown(date: String) -> Result<String, String> {
    let report = crate::report::load_report(&date)?;
    Ok(report.markdown)
}

#[tauri::command]
pub async fn save_report_file(
    _app: AppHandle,
    content: String,
    default_filename: String,
    _file_type: String,
) -> Result<String, String> {
    // Save directly to Downloads folder to avoid dialog API issues on macOS
    let downloads_dir = dirs::download_dir()
        .ok_or_else(|| "Could not find Downloads directory".to_string())?;

    let file_path = downloads_dir.join(&default_filename);

    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

// ============================================================================
// Config & System Info
// ============================================================================

#[tauri::command]
pub async fn get_projects(app: AppHandle) -> Result<Vec<String>, String> {
    database::get_projects(&app).map_err(str_err)
}

#[tauri::command]
pub async fn get_config() -> crate::config::AppConfig {
    crate::config::load_config()
}

#[tauri::command]
pub async fn update_config(
    key: String,
    value: serde_json::Value,
) -> Result<crate::config::AppConfig, String> {
    crate::config::update_config_value(&key, value)
}

#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub claude_installed: bool,
    pub claude_version: Option<String>,
    pub credentials_exist: bool,
    pub account_email: Option<String>,
    pub db_stats: crate::config::DbStats,
}

#[tauri::command]
pub async fn get_system_info() -> SystemInfo {
    let credentials = crate::usage::read_claude_credentials();

    SystemInfo {
        claude_installed: crate::config::is_claude_installed(),
        claude_version: crate::config::get_claude_version(),
        credentials_exist: credentials
            .as_ref()
            .and_then(|c| c.access_token.as_ref())
            .is_some(),
        account_email: credentials.and_then(|c| c.account_email),
        db_stats: crate::config::get_db_stats(),
    }
}

#[derive(serde::Serialize)]
pub struct ScanResult {
    pub session_count: usize,
    pub project_count: usize,
    pub total_tokens: i64,
    pub projects: Vec<String>,
}

#[tauri::command]
pub async fn scan_claude_directory(app: AppHandle) -> Result<ScanResult, String> {
    let sessions = database::get_sessions(&app, None, 10000).map_err(str_err)?;
    let projects = database::get_projects(&app).map_err(str_err)?;
    let total_tokens: i64 = sessions.iter().map(|s| s.total_tokens).sum();

    Ok(ScanResult {
        session_count: sessions.len(),
        project_count: projects.len(),
        total_tokens,
        projects,
    })
}

// ============================================================================
// Hooks
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct HooksInstallResult {
    pub success: bool,
    pub settings_path: String,
    pub hooks_file: String,
}

#[tauri::command]
pub async fn install_hooks() -> Result<HooksInstallResult, String> {
    let claude_dir = crate::platform::get_claude_dir();
    let settings_path = claude_dir.join("settings.json");

    // Build the hooks to merge
    let new_hooks = serde_json::json!({
        "SessionStart": [{
            "type": "command",
            "command": crate::platform::get_hook_command("session_start", true)
        }],
        "Stop": [{
            "type": "command",
            "command": crate::platform::get_hook_command("stop", false)
        }],
        "SessionEnd": [{
            "type": "command",
            "command": crate::platform::get_hook_command("session_end", false)
        }],
        "PreToolUse": [{
            "type": "command",
            "command": crate::platform::get_pre_tool_use_hook_command()
        }]
    });

    // Merge new hooks into the Claude settings file
    std::fs::create_dir_all(&claude_dir).map_err(str_err)?;
    merge_hooks_into_settings(&settings_path, new_hooks)?;

    // Ensure hooks events file exists
    let alice_dir = crate::platform::get_alice_dir();
    std::fs::create_dir_all(&alice_dir).map_err(str_err)?;

    let hooks_file = alice_dir.join("hooks-events.jsonl");
    if !hooks_file.exists() {
        std::fs::write(&hooks_file, "").map_err(str_err)?;
    }

    // Mark hooks as installed in config
    let mut config = crate::config::load_config();
    config.hooks_installed = true;
    let _ = crate::config::save_config(&config);

    Ok(HooksInstallResult {
        success: true,
        settings_path: settings_path.to_string_lossy().to_string(),
        hooks_file: hooks_file.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn check_hooks_installed() -> bool {
    crate::config::load_config().hooks_installed
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HookVerifyResult {
    pub success: bool,
    pub settings_path: String,
    pub hooks_file: String,
    pub session_start_installed: bool,
    pub session_end_installed: bool,
}

#[tauri::command]
pub async fn install_and_verify_hooks() -> Result<HookVerifyResult, String> {
    let install_result = install_hooks().await?;

    // Verify by reading back the settings file
    let (session_start_installed, session_end_installed) = read_installed_hooks();

    Ok(HookVerifyResult {
        success: install_result.success && session_start_installed && session_end_installed,
        settings_path: install_result.settings_path,
        hooks_file: install_result.hooks_file,
        session_start_installed,
        session_end_installed,
    })
}

/// Read the settings file and check which hook events are present.
fn read_installed_hooks() -> (bool, bool) {
    let settings_path = crate::platform::get_claude_dir().join("settings.json");

    let hooks = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|settings| settings.get("hooks").cloned());

    match hooks {
        Some(h) => (h.get("SessionStart").is_some(), h.get("SessionEnd").is_some()),
        None => (false, false),
    }
}

// ============================================================================
// Onboarding
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct OnboardingStatus {
    pub cli_installed: bool,
    pub cli_version: Option<String>,
    pub credentials_found: bool,
    pub account_email: Option<String>,
    pub subscription_type: Option<String>,
    pub claude_dir_exists: bool,
    pub platform: String,
    pub hooks_installed: bool,
    pub existing_sessions_count: usize,
}

/// Subscription tier keywords to match against the account email field.
const SUBSCRIPTION_TIERS: &[(&str, &str)] = &[
    ("Max", "max"),
    ("Pro", "pro"),
    ("Free", "free"),
    ("Team", "team"),
    ("Enterprise", "enterprise"),
];

fn detect_subscription_type(email: &str) -> Option<String> {
    SUBSCRIPTION_TIERS
        .iter()
        .find(|(keyword, _)| email.contains(keyword))
        .map(|(_, tier)| tier.to_string())
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

#[tauri::command]
pub async fn get_onboarding_status(app: AppHandle) -> OnboardingStatus {
    let config = crate::config::load_config();
    let credentials = crate::usage::read_claude_credentials();

    let existing_sessions_count = database::get_sessions(&app, None, 10000)
        .map(|s| s.len())
        .unwrap_or(0);

    let (credentials_found, account_email, subscription_type) = match credentials {
        Some(creds) => {
            let has_token = creds.access_token.is_some();
            let sub_type = creds
                .account_email
                .as_deref()
                .and_then(detect_subscription_type);
            (has_token, creds.account_email, sub_type)
        }
        None => (false, None, None),
    };

    OnboardingStatus {
        cli_installed: crate::config::is_claude_installed(),
        cli_version: crate::config::get_claude_version(),
        credentials_found,
        account_email,
        subscription_type,
        claude_dir_exists: crate::platform::get_claude_dir().exists(),
        platform: current_platform().to_string(),
        hooks_installed: config.hooks_installed,
        existing_sessions_count,
    }
}

// ============================================================================
// Terminals
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct TerminalOption {
    pub value: String,
    pub label: String,
}

#[tauri::command]
pub async fn get_available_terminals() -> Vec<TerminalOption> {
    crate::platform::get_available_terminals()
        .into_iter()
        .map(|(value, label)| TerminalOption {
            value: value.to_string(),
            label: label.to_string(),
        })
        .collect()
}

// ============================================================================
// Auto Action
// ============================================================================

#[tauri::command]
pub async fn get_auto_action_state(app: AppHandle) -> crate::auto_action::AutoActionState {
    crate::auto_action::get_auto_action_state(&app).await
}

#[tauri::command]
pub async fn start_auto_action_timer(app: AppHandle) -> Result<(), String> {
    crate::auto_action::start_auto_action_timer(&app).await
}

#[tauri::command]
pub async fn cancel_auto_action_timer() -> Result<(), String> {
    crate::auto_action::cancel_auto_action_timer().await
}

// ============================================================================
// Claude Environments
// ============================================================================

#[tauri::command]
pub async fn get_claude_environments() -> Vec<crate::config::ClaudeEnvironment> {
    crate::config::load_config().claude_environments
}

#[tauri::command]
pub async fn get_active_environment() -> crate::config::ClaudeEnvironment {
    crate::config::get_active_environment()
}

#[tauri::command]
pub async fn add_claude_environment(
    env: crate::config::ClaudeEnvironment,
) -> Result<crate::config::AppConfig, String> {
    crate::config::add_environment(env)
}

#[tauri::command]
pub async fn update_claude_environment(
    env: crate::config::ClaudeEnvironment,
) -> Result<crate::config::AppConfig, String> {
    crate::config::update_environment(env)
}

#[tauri::command]
pub async fn delete_claude_environment(id: String) -> Result<crate::config::AppConfig, String> {
    crate::config::delete_environment(&id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_active_environment(
    environment_id: String,
) -> Result<crate::config::AppConfig, String> {
    crate::config::set_active_environment(&environment_id)
}

// ============================================================================
// Providers (Multi-AI Support)
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderStatus {
    pub id: String,
    pub display_name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub data_dir: String,
    pub enabled: bool,
    pub custom_data_dir: Option<String>,
}

#[tauri::command]
pub async fn get_provider_statuses() -> Vec<ProviderStatus> {
    let config = crate::config::load_config();

    crate::providers::get_all_providers()
        .into_iter()
        .map(|provider| {
            let provider_id = provider.id();
            let id_str = format!("{:?}", provider_id).to_lowercase();

            let provider_config = config
                .provider_configs
                .get(&id_str)
                .cloned()
                .unwrap_or_default();

            let installed = provider.is_installed();
            let version = installed.then(|| get_provider_version(&id_str)).flatten();

            let data_dir = provider_config
                .data_dir
                .clone()
                .unwrap_or_else(|| provider_id.default_data_dir().to_string_lossy().to_string());

            ProviderStatus {
                id: id_str,
                display_name: provider_id.display_name().to_string(),
                installed,
                version,
                data_dir,
                enabled: provider_config.enabled,
                custom_data_dir: provider_config.data_dir,
            }
        })
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_provider_config(
    provider_id: String,
    enabled: bool,
    data_dir: Option<String>,
) -> Result<crate::config::AppConfig, String> {
    crate::config::update_provider_config(&provider_id, enabled, data_dir)
}

fn get_provider_version(provider_id: &str) -> Option<String> {
    // Only providers with a --version flag are supported
    let command = match provider_id {
        "claude" | "codex" => provider_id,
        _ => return None,
    };

    std::process::Command::new(command)
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
}

// ============================================================================
// Window system and deep link
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct WindowContextResponse {
    pub label: String,
    pub role: String,
    pub default_route: String,
}

fn default_route_for_window(label: &str) -> &'static str {
    if label == "quick" {
        "/quick/home"
    } else {
        "/app/home"
    }
}

fn normalize_route(route: &str, fallback: &str) -> String {
    let trimmed = route.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }

    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{}", trimmed)
    }
}

fn set_window_route(window: &tauri::WebviewWindow, route: &str) -> Result<(), String> {
    let normalized = normalize_route(route, default_route_for_window(window.label()));
    let escaped = normalized.replace('\\', "\\\\").replace('\'', "\\'");
    let script = format!("window.location.hash = '#{}';", escaped);
    window.eval(&script).map_err(str_err)
}

fn open_window_by_label(app: &AppHandle, label: &str, route: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("Window '{}' not found", label))?;
    set_window_route(&window, route)?;
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn get_window_context(window: Window) -> Result<WindowContextResponse, String> {
    let label = window.label().to_string();
    let role = if label == "quick" { "quick" } else { "main" };
    Ok(WindowContextResponse {
        label,
        role: role.to_string(),
        default_route: default_route_for_window(window.label()).to_string(),
    })
}

#[tauri::command]
pub async fn open_main_window(app: AppHandle, route: Option<String>) -> Result<(), String> {
    let route = route.unwrap_or_else(|| "/app/home".to_string());
    open_window_by_label(&app, "main", &route)
}

#[tauri::command]
pub async fn open_quick_window(app: AppHandle, route: Option<String>) -> Result<(), String> {
    let route = route.unwrap_or_else(|| "/quick/home".to_string());
    open_window_by_label(&app, "quick", &route)
}

#[tauri::command]
pub async fn navigate_deep_link(app: AppHandle, uri: String) -> Result<(), String> {
    let raw = uri
        .trim()
        .strip_prefix("alice://")
        .ok_or("Deep link must start with alice://")?;
    let route = normalize_route(raw, "/quick/home");

    if route.starts_with("/quick/") {
        open_window_by_label(&app, "quick", &route)
    } else if route.starts_with("/app/") {
        open_window_by_label(&app, "main", &route)
    } else {
        Err(format!("Unsupported deep link route: {}", route))
    }
}

// ============================================================================
// HTTP Hook Server
// ============================================================================

#[tauri::command]
pub async fn get_hook_server_port() -> u16 {
    crate::config::load_config().hook_server_port
}

// ============================================================================
// Gemini Hook Installation
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct GeminiHooksResult {
    pub success: bool,
    pub settings_path: String,
    pub script_path: String,
    pub message: String,
}

#[tauri::command]
pub async fn install_gemini_hooks() -> Result<GeminiHooksResult, String> {
    let config = crate::config::load_config();
    let port = config.hook_server_port;

    // Write the hook shell script to ~/.alice/scripts/gemini-hook.sh
    let alice_dir = crate::platform::get_alice_dir();
    let scripts_dir = alice_dir.join("scripts");
    std::fs::create_dir_all(&scripts_dir).map_err(str_err)?;

    let script_path = scripts_dir.join("gemini-hook.sh");
    let script_content = crate::platform::get_gemini_hook_script(port);
    std::fs::write(&script_path, &script_content).map_err(str_err)?;

    // Make the script executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script_path)
            .map_err(str_err)?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).map_err(str_err)?;
    }

    // Write ~/.gemini/settings.json hooks
    let gemini_dir = crate::platform::get_gemini_dir();
    std::fs::create_dir_all(&gemini_dir).map_err(str_err)?;
    let settings_path = gemini_dir.join("settings.json");

    let script_path_str = script_path.to_string_lossy().to_string();
    let new_hooks = serde_json::json!({
        "BeforeTool": {
            "command": script_path_str
        }
    });

    merge_hooks_into_settings(&settings_path, new_hooks)?;

    // Mark gemini hooks as installed
    let mut config = crate::config::load_config();
    config.gemini_hooks_installed = true;
    let _ = crate::config::save_config(&config);

    Ok(GeminiHooksResult {
        success: true,
        settings_path: settings_path.to_string_lossy().to_string(),
        script_path: script_path.to_string_lossy().to_string(),
        message: format!(
            "Gemini hooks installed. Script at {}. Alice HTTP server running on port {}.",
            script_path.display(),
            port
        ),
    })
}

// ============================================================================
// §9.3 Unified tool command interface
// ============================================================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolGateDecideResponse {
    pub gate_id: String,
    pub decision: String,
    pub success: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolStatusResponse {
    pub run_id: String,
    pub status: String,
    pub current_phase_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolArtifactEntry {
    pub artifact_id: String,
    pub title: String,
    pub kind: String,
    pub path: String,
}

/// §9.3 tool.gate.approve / tool.gate.reject / tool.gate.defer
#[tauri::command]
pub async fn tool_gate_decide(
    app: AppHandle,
    gate_id: String,
    decision: String,
) -> Result<ToolGateDecideResponse, String> {
    let normalized = match decision.as_str() {
        "approve" | "approved" => "approved",
        "reject" | "rejected" => "rejected",
        "defer" | "deferred" => "deferred",
        _ => {
            let valid = [
                "approve",
                "approved",
                "reject",
                "rejected",
                "defer",
                "deferred",
            ];
            return Err(format!(
                "Invalid decision '{}', expected one of: {:?}",
                decision, valid
            ));
        }
    };

    tracing::info!("Gate {} decision: {}", gate_id, normalized);

    // Emit event to all windows so quick window can refresh
    let _ = app.emit("tool://gate-decided", serde_json::json!({
        "gate_id": gate_id,
        "decision": normalized,
    }));

    Ok(ToolGateDecideResponse {
        gate_id,
        decision: normalized.to_string(),
        success: true,
    })
}

/// §9.3 tool.status — query the status of a run
#[tauri::command]
pub async fn tool_run_status(run_id: String) -> Result<ToolStatusResponse, String> {
    tracing::info!("Tool status query for run {}", run_id);

    Ok(ToolStatusResponse {
        run_id,
        status: "running".to_string(),
        current_phase_id: Some("P-02".to_string()),
        message: "Run is in progress.".to_string(),
    })
}

/// §9.3 tool.list_artifacts — list artifacts for a run
#[tauri::command]
pub async fn tool_list_artifacts(run_id: String) -> Result<Vec<ToolArtifactEntry>, String> {
    tracing::info!("Listing artifacts for run {}", run_id);

    // Placeholder: return empty until real artifact storage is implemented
    Ok(vec![])
}

// ============================================================================
// §10 Cross-window interaction events
// ============================================================================

/// Notify all windows when a task fails (inbox notification)
#[tauri::command]
pub async fn emit_task_event(
    app: AppHandle,
    event_type: String,
    task_id: String,
    message: String,
) -> Result<(), String> {
    let _ = app.emit(
        "tool://task-event",
        serde_json::json!({
            "event_type": event_type,
            "task_id": task_id,
            "message": message,
        }),
    );
    Ok(())
}

/// Notify quick window to refresh its data after main window operations
#[tauri::command]
pub async fn emit_refresh_quick(app: AppHandle) -> Result<(), String> {
    let _ = app.emit("tool://refresh-quick", serde_json::json!({}));
    Ok(())
}
