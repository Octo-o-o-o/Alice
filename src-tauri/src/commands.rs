// Tauri commands for frontend communication

use crate::database::{self, Task};
use crate::session::{Session, SessionDetail, UsageStats};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchQuery {
    pub query: String,
    pub project: Option<String>,
    pub limit: Option<i64>,
}

/// Get all sessions, optionally filtered by project
#[tauri::command]
pub async fn get_sessions(
    app: AppHandle,
    project: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Session>, String> {
    database::get_sessions(&app, project.as_deref(), limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

/// Get detailed information about a specific session
#[tauri::command(rename_all = "camelCase")]
pub async fn get_session_detail(
    app: AppHandle,
    session_id: String,
) -> Result<SessionDetail, String> {
    database::get_session_detail(&app, &session_id).map_err(|e| e.to_string())
}

/// Get currently active sessions (based on file activity)
#[tauri::command]
pub async fn get_active_sessions(app: AppHandle) -> Result<Vec<Session>, String> {
    database::get_active_sessions(&app).map_err(|e| e.to_string())
}

/// Get usage statistics
#[tauri::command(rename_all = "camelCase")]
pub async fn get_usage_stats(
    app: AppHandle,
    project: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<UsageStats, String> {
    database::get_usage_stats(&app, project.as_deref(), start_date.as_deref(), end_date.as_deref())
        .map_err(|e| e.to_string())
}

/// Get all tasks
#[tauri::command]
pub async fn get_tasks(
    app: AppHandle,
    status: Option<String>,
    project: Option<String>,
) -> Result<Vec<Task>, String> {
    let status = status.and_then(|s| s.parse().ok());
    database::get_tasks(&app, status, project.as_deref()).map_err(|e| e.to_string())
}

/// Create a new task
#[tauri::command]
pub async fn create_task(
    app: AppHandle,
    prompt: String,
    project: Option<String>,
    priority: Option<String>,
    notes: Option<String>,
) -> Result<Task, String> {
    database::create_task(&app, &prompt, project.as_deref(), priority.as_deref(), notes.as_deref())
        .map_err(|e| e.to_string())
}

/// Update an existing task
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
        .map_err(|e| e.to_string())
}

/// Delete a task
#[tauri::command]
pub async fn delete_task(app: AppHandle, id: String) -> Result<(), String> {
    database::delete_task(&app, &id).map_err(|e| e.to_string())
}

/// Search sessions by query
#[tauri::command]
pub async fn search_sessions(
    app: AppHandle,
    query: String,
    project: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Session>, String> {
    database::search_sessions(&app, &query, project.as_deref(), limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

/// Search sessions with advanced filters
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
    .map_err(|e| e.to_string())
}

/// Resume a session - returns the command to run
#[tauri::command(rename_all = "camelCase")]
pub async fn resume_session(session_id: String) -> Result<String, String> {
    Ok(format!("claude --resume {}", session_id))
}

/// Get live usage stats from OAuth API
#[tauri::command]
pub async fn get_live_usage() -> Result<crate::usage::LiveUsageStats, String> {
    // Try to read credentials
    let credentials = crate::usage::read_claude_credentials();

    let mut stats = crate::usage::LiveUsageStats {
        last_updated: chrono::Utc::now().timestamp_millis(),
        ..Default::default()
    };

    if let Some(creds) = credentials {
        stats.account_email = creds.account_email;

        if let Some(access_token) = creds.access_token {
            match crate::usage::fetch_oauth_usage(&access_token).await {
                Ok(response) => {
                    stats.session_percent = response.five_hour.utilization;
                    stats.session_reset_at = Some(response.five_hour.resets_at);
                    stats.weekly_percent = response.seven_day.utilization;
                    stats.weekly_reset_at = Some(response.seven_day.resets_at);

                    // Load history and calculate burn rate
                    let mut history = crate::usage::load_usage_history();
                    history.add_session_point(stats.session_percent);

                    if let Some(burn_rate) = history.get_session_burn_rate() {
                        stats.burn_rate_per_hour = Some(burn_rate);
                        stats.estimated_limit_in_minutes =
                            crate::usage::estimate_time_to_limit(stats.session_percent, burn_rate);
                    }

                    // Save updated history
                    let _ = crate::usage::save_usage_history(&history);
                }
                Err(e) => {
                    stats.error = Some(e);
                }
            }
        } else {
            stats.error = Some("No access token found".to_string());
        }
    } else {
        stats.error = Some("No credentials found".to_string());
    }

    Ok(stats)
}

/// Check if Claude credentials exist
#[tauri::command]
pub async fn has_claude_credentials() -> bool {
    crate::usage::read_claude_credentials()
        .map(|c| c.access_token.is_some())
        .unwrap_or(false)
}

/// Rescan all session files to update token data
#[tauri::command]
pub async fn rescan_sessions(app: AppHandle) -> Result<u32, String> {
    crate::watcher::rescan_all_sessions(&app)
        .map_err(|e| e.to_string())
}

/// Queue start result
#[derive(Debug, Clone, serde::Serialize)]
pub struct QueueStartResult {
    pub started: bool,
    pub needs_terminal_choice: bool,
}

/// Start the task queue
#[tauri::command]
pub async fn start_queue(app: AppHandle) -> Result<QueueStartResult, String> {
    // Check if terminal choice has been made
    let config = crate::config::load_config();
    if !config.terminal_choice_made {
        return Ok(QueueStartResult {
            started: false,
            needs_terminal_choice: true,
        });
    }

    // Spawn queue execution in background
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

/// Stop the task queue
#[tauri::command]
pub async fn stop_queue() -> Result<(), String> {
    crate::queue::stop_queue().await
}

/// Get queue status
#[tauri::command]
pub async fn get_queue_status() -> Result<bool, String> {
    Ok(crate::queue::is_queue_running().await)
}

/// Generate daily report for a date
#[tauri::command]
pub async fn generate_daily_report(
    app: AppHandle,
    date: Option<String>,
) -> Result<crate::report::DailyReport, String> {
    let date = date.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    crate::report::generate_report(&app, &date)
}

/// Get an existing daily report
#[tauri::command]
pub async fn get_daily_report(date: String) -> Result<crate::report::DailyReport, String> {
    crate::report::load_report(&date)
}

/// List available reports
#[tauri::command]
pub async fn list_reports() -> Result<Vec<String>, String> {
    crate::report::list_reports()
}

/// Get list of unique projects
#[tauri::command]
pub async fn get_projects(app: AppHandle) -> Result<Vec<String>, String> {
    database::get_projects(&app).map_err(|e| e.to_string())
}

/// Get application config
#[tauri::command]
pub async fn get_config() -> crate::config::AppConfig {
    crate::config::load_config()
}

/// Update a config value
#[tauri::command]
pub async fn update_config(
    key: String,
    value: serde_json::Value,
) -> Result<crate::config::AppConfig, String> {
    crate::config::update_config_value(&key, value)
}

/// System information for Config view
#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub claude_installed: bool,
    pub claude_version: Option<String>,
    pub credentials_exist: bool,
    pub account_email: Option<String>,
    pub db_stats: crate::config::DbStats,
}

/// Get system information
#[tauri::command]
pub async fn get_system_info() -> SystemInfo {
    let credentials = crate::usage::read_claude_credentials();

    SystemInfo {
        claude_installed: crate::config::is_claude_installed(),
        claude_version: crate::config::get_claude_version(),
        credentials_exist: credentials.as_ref().map(|c| c.access_token.is_some()).unwrap_or(false),
        account_email: credentials.and_then(|c| c.account_email),
        db_stats: crate::config::get_db_stats(),
    }
}

/// Reorder tasks by updating their sort_order
#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_tasks(app: AppHandle, task_ids: Vec<String>) -> Result<(), String> {
    database::reorder_tasks(&app, task_ids).map_err(|e| e.to_string())
}

/// Update session label
#[tauri::command(rename_all = "camelCase")]
pub async fn update_session_label(
    app: AppHandle,
    session_id: String,
    label: Option<String>,
) -> Result<(), String> {
    database::update_session_label(&app, &session_id, label.as_deref()).map_err(|e| e.to_string())
}

/// Fork a session - returns the command to run
#[tauri::command(rename_all = "camelCase")]
pub async fn fork_session(session_id: String) -> Result<String, String> {
    Ok(format!("claude --fork-session {}", session_id))
}

/// Delete a session from the database
#[tauri::command(rename_all = "camelCase")]
pub async fn delete_session(app: AppHandle, session_id: String) -> Result<(), String> {
    database::delete_session(&app, &session_id).map_err(|e| e.to_string())
}

/// Scan Claude directory for sessions and projects
#[derive(serde::Serialize)]
pub struct ScanResult {
    pub session_count: usize,
    pub project_count: usize,
    pub total_tokens: i64,
    pub projects: Vec<String>,
}

#[tauri::command]
pub async fn scan_claude_directory(app: AppHandle) -> Result<ScanResult, String> {
    let sessions = database::get_sessions(&app, None, 10000).map_err(|e| e.to_string())?;
    let projects = database::get_projects(&app).map_err(|e| e.to_string())?;

    let total_tokens: i64 = sessions.iter().map(|s| s.total_tokens).sum();

    Ok(ScanResult {
        session_count: sessions.len(),
        project_count: projects.len(),
        total_tokens,
        projects,
    })
}

/// Export session as JSON or Markdown
#[tauri::command(rename_all = "camelCase")]
pub async fn export_session(
    app: AppHandle,
    session_id: String,
    format: String,
) -> Result<String, String> {
    let detail = database::get_session_detail(&app, &session_id).map_err(|e| e.to_string())?;

    match format.as_str() {
        "json" => {
            serde_json::to_string_pretty(&detail)
                .map_err(|e| format!("Failed to serialize: {}", e))
        }
        "markdown" => {
            let mut md = String::new();
            md.push_str(&format!("# Session: {}\n\n", detail.session.project_name));
            md.push_str(&format!("**Session ID**: `{}`\n", detail.session.session_id));
            md.push_str(&format!("**Model**: {}\n", detail.session.model.as_deref().unwrap_or("unknown")));
            md.push_str(&format!("**Status**: {:?}\n", detail.session.status));
            md.push_str(&format!("**Tokens**: {}\n", detail.session.total_tokens));
            md.push_str(&format!("**Cost**: ${:.2}\n\n", detail.session.total_cost_usd));

            md.push_str("## Messages\n\n");
            for msg in &detail.messages {
                let role = match msg.role.as_str() {
                    "user" => "👤 User",
                    "assistant" => "🤖 Assistant",
                    _ => &msg.role,
                };
                md.push_str(&format!("### {}\n\n", role));
                md.push_str(&format!("{}\n\n", msg.content));
            }

            Ok(md)
        }
        _ => Err("Invalid format. Use 'json' or 'markdown'".to_string()),
    }
}

/// Install Alice hooks into Claude Code settings
#[tauri::command]
pub async fn install_hooks() -> Result<HooksInstallResult, String> {
    let settings_path = crate::platform::get_claude_dir().join("settings.json");

    // Create the hooks configuration for Alice (platform-aware commands)
    let alice_hooks = serde_json::json!({
        "hooks": {
            "SessionStart": [
                {
                    "type": "command",
                    "command": crate::platform::get_hook_command("session_start", true)
                }
            ],
            "Stop": [
                {
                    "type": "command",
                    "command": crate::platform::get_hook_command("stop", false)
                }
            ],
            "SessionEnd": [
                {
                    "type": "command",
                    "command": crate::platform::get_hook_command("session_end", false)
                }
            ]
        }
    });

    // Read existing settings or create new
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Merge hooks into settings
    if let Some(hooks) = alice_hooks.get("hooks") {
        if let Some(settings_obj) = settings.as_object_mut() {
            if let Some(existing_hooks) = settings_obj.get_mut("hooks") {
                // Merge with existing hooks
                if let (Some(existing), Some(new)) = (existing_hooks.as_object_mut(), hooks.as_object()) {
                    for (key, value) in new {
                        existing.insert(key.clone(), value.clone());
                    }
                }
            } else {
                settings_obj.insert("hooks".to_string(), hooks.clone());
            }
        }
    }

    // Write settings back
    let settings_content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    // Create .claude directory if it doesn't exist
    let claude_dir = crate::platform::get_claude_dir();
    std::fs::create_dir_all(&claude_dir)
        .map_err(|e| format!("Failed to create .claude directory: {}", e))?;

    std::fs::write(&settings_path, &settings_content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    // Create the hooks events file if it doesn't exist
    let alice_dir = crate::platform::get_alice_dir();
    std::fs::create_dir_all(&alice_dir)
        .map_err(|e| format!("Failed to create .alice directory: {}", e))?;

    let hooks_file = alice_dir.join("hooks-events.jsonl");
    if !hooks_file.exists() {
        std::fs::write(&hooks_file, "")
            .map_err(|e| format!("Failed to create hooks events file: {}", e))?;
    }

    // Update config to mark hooks as installed
    let mut config = crate::config::load_config();
    config.hooks_installed = true;
    let _ = crate::config::save_config(&config);

    Ok(HooksInstallResult {
        success: true,
        settings_path: settings_path.to_string_lossy().to_string(),
        hooks_file: hooks_file.to_string_lossy().to_string(),
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HooksInstallResult {
    pub success: bool,
    pub settings_path: String,
    pub hooks_file: String,
}

/// Check if hooks are installed
#[tauri::command]
pub async fn check_hooks_installed() -> bool {
    let config = crate::config::load_config();
    config.hooks_installed
}

/// Generate AI summary for a daily report
#[tauri::command]
pub async fn generate_report_ai_summary(date: String) -> Result<crate::report::DailyReport, String> {
    // Load the existing report
    let report = crate::report::load_report(&date)?;

    // Generate AI summary
    let summary = crate::report::generate_ai_summary(&report).await?;

    // Update report with summary
    crate::report::update_report_with_summary(&date, &summary)
}

/// Get Anthropic service status
#[tauri::command]
pub async fn get_anthropic_status() -> Result<crate::usage::AnthropicStatus, String> {
    crate::usage::fetch_anthropic_status().await
}

/// Onboarding status for setup wizard
#[derive(Debug, Clone, serde::Serialize)]
pub struct OnboardingStatus {
    /// Claude CLI installed
    pub cli_installed: bool,
    /// Claude CLI version
    pub cli_version: Option<String>,
    /// OAuth credentials found
    pub credentials_found: bool,
    /// Account email (if logged in)
    pub account_email: Option<String>,
    /// Subscription type (max/pro/free/team/enterprise)
    pub subscription_type: Option<String>,
    /// Claude directory exists
    pub claude_dir_exists: bool,
    /// Platform (macos/windows/linux)
    pub platform: String,
    /// Hooks already installed
    pub hooks_installed: bool,
    /// Number of existing sessions found
    pub existing_sessions_count: usize,
}

/// Get complete onboarding status for setup wizard
#[tauri::command]
pub async fn get_onboarding_status(app: AppHandle) -> OnboardingStatus {
    let cli_installed = crate::config::is_claude_installed();
    let cli_version = crate::config::get_claude_version();
    let credentials = crate::usage::read_claude_credentials();
    let claude_dir = crate::platform::get_claude_dir();
    let config = crate::config::load_config();

    // Count existing sessions
    let existing_sessions_count = database::get_sessions(&app, None, 10000)
        .map(|sessions| sessions.len())
        .unwrap_or(0);

    // Determine platform
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };

    // Extract subscription type from credentials
    let (credentials_found, account_email, subscription_type) = match credentials {
        Some(creds) => {
            let has_token = creds.access_token.is_some();
            // Parse subscription type from account_email field (which contains "Claude Max" etc.)
            let sub_type = creds.account_email.as_ref().and_then(|email| {
                if email.contains("Max") {
                    Some("max".to_string())
                } else if email.contains("Pro") {
                    Some("pro".to_string())
                } else if email.contains("Free") {
                    Some("free".to_string())
                } else if email.contains("Team") {
                    Some("team".to_string())
                } else if email.contains("Enterprise") {
                    Some("enterprise".to_string())
                } else {
                    None
                }
            });
            (has_token, creds.account_email, sub_type)
        }
        None => (false, None, None),
    };

    OnboardingStatus {
        cli_installed,
        cli_version,
        credentials_found,
        account_email,
        subscription_type,
        claude_dir_exists: claude_dir.exists(),
        platform: platform.to_string(),
        hooks_installed: config.hooks_installed,
        existing_sessions_count,
    }
}

/// Install hooks and verify the installation
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
    // First install hooks
    let install_result = install_hooks().await?;

    // Then verify by reading the settings file
    let settings_path = crate::platform::get_claude_dir().join("settings.json");
    let mut session_start_installed = false;
    let mut session_end_installed = false;

    if settings_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(hooks) = settings.get("hooks") {
                    session_start_installed = hooks.get("SessionStart").is_some();
                    session_end_installed = hooks.get("SessionEnd").is_some();
                }
            }
        }
    }

    Ok(HookVerifyResult {
        success: install_result.success && session_start_installed && session_end_installed,
        settings_path: install_result.settings_path,
        hooks_file: install_result.hooks_file,
        session_start_installed,
        session_end_installed,
    })
}

/// Terminal option for UI
#[derive(Debug, Clone, serde::Serialize)]
pub struct TerminalOption {
    pub value: String,
    pub label: String,
}

/// Get list of available terminal applications
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
// Favorites
// ============================================================================

/// Get all favorites
#[tauri::command]
pub async fn get_favorites(app: AppHandle) -> Result<Vec<database::Favorite>, String> {
    database::get_favorites(&app).map_err(|e| e.to_string())
}

/// Create a new favorite
#[tauri::command(rename_all = "camelCase")]
pub async fn create_favorite(
    app: AppHandle,
    name: String,
    prompt: String,
    project_path: Option<String>,
    tags: Option<String>,
) -> Result<database::Favorite, String> {
    database::create_favorite(&app, &name, &prompt, project_path.as_deref(), tags.as_deref())
        .map_err(|e| e.to_string())
}

/// Update a favorite
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
    database::update_favorite(&app, &id, name.as_deref(), prompt.as_deref(), project_path_ref, tags.as_deref())
        .map_err(|e| e.to_string())
}

/// Delete a favorite
#[tauri::command]
pub async fn delete_favorite(app: AppHandle, id: String) -> Result<(), String> {
    database::delete_favorite(&app, &id).map_err(|e| e.to_string())
}

/// Reorder favorites
#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_favorites(app: AppHandle, favorite_ids: Vec<String>) -> Result<(), String> {
    database::reorder_favorites(&app, favorite_ids).map_err(|e| e.to_string())
}

// ============================================================================
// Auto Action
// ============================================================================

/// Get auto action state
#[tauri::command]
pub async fn get_auto_action_state(app: AppHandle) -> crate::auto_action::AutoActionState {
    crate::auto_action::get_auto_action_state(&app).await
}

/// Start auto action timer manually
#[tauri::command]
pub async fn start_auto_action_timer(app: AppHandle) -> Result<(), String> {
    crate::auto_action::start_auto_action_timer(&app).await
}

/// Cancel auto action timer
#[tauri::command]
pub async fn cancel_auto_action_timer() -> Result<(), String> {
    crate::auto_action::cancel_auto_action_timer().await
}

// ============================================================================
// Claude Environments
// ============================================================================

/// Get all Claude environments
#[tauri::command]
pub async fn get_claude_environments() -> Vec<crate::config::ClaudeEnvironment> {
    let config = crate::config::load_config();
    config.claude_environments
}

/// Get the active Claude environment
#[tauri::command]
pub async fn get_active_environment() -> crate::config::ClaudeEnvironment {
    crate::config::get_active_environment()
}

/// Add a new Claude environment
#[tauri::command]
pub async fn add_claude_environment(
    env: crate::config::ClaudeEnvironment,
) -> Result<crate::config::AppConfig, String> {
    crate::config::add_environment(env)
}

/// Update an existing Claude environment
#[tauri::command]
pub async fn update_claude_environment(
    env: crate::config::ClaudeEnvironment,
) -> Result<crate::config::AppConfig, String> {
    crate::config::update_environment(env)
}

/// Delete a Claude environment
#[tauri::command]
pub async fn delete_claude_environment(id: String) -> Result<crate::config::AppConfig, String> {
    crate::config::delete_environment(&id)
}

/// Set the active Claude environment
#[tauri::command(rename_all = "camelCase")]
pub async fn set_active_environment(environment_id: String) -> Result<crate::config::AppConfig, String> {
    crate::config::set_active_environment(&environment_id)
}
