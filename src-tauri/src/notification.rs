// Notification engine for session events

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// Notification types
#[derive(Debug, Clone, serde::Serialize)]
pub enum NotificationType {
    TaskCompleted,
    TaskError,
    NeedsInput,
    QueueStarted,
    DailyReport,
}

/// Send a notification for task completion
pub fn notify_task_completed(
    app: &AppHandle,
    project_name: &str,
    prompt_snippet: &str,
    cost: f64,
    duration_secs: u64,
) -> Result<(), String> {
    let duration_str = format_duration(duration_secs);
    let title = format!("✓ {}", project_name);
    let body = format!(
        "\"{}\" finished ({}, ${:.2})",
        truncate_string(prompt_snippet, 50),
        duration_str,
        cost
    );

    send_notification(app, &title, &body)
}

/// Send a notification for task error
pub fn notify_task_error(
    app: &AppHandle,
    project_name: &str,
    error_message: &str,
) -> Result<(), String> {
    let title = format!("✗ {}", project_name);
    let body = format!("Error: {}", truncate_string(error_message, 100));

    send_notification(app, &title, &body)
}

/// Send a notification when input is needed
pub fn notify_needs_input(
    app: &AppHandle,
    project_name: &str,
) -> Result<(), String> {
    let title = format!("⚠ {}", project_name);
    let body = "Waiting for user input";

    send_notification(app, &title, body)
}

/// Send a notification when queue task starts
pub fn notify_queue_started(
    app: &AppHandle,
    project_name: &str,
    prompt_snippet: &str,
) -> Result<(), String> {
    let title = format!("▶ Queue: {}", project_name);
    let body = format!("Starting: \"{}\"", truncate_string(prompt_snippet, 50));

    send_notification(app, &title, &body)
}

/// Send a notification for daily report
pub fn notify_daily_report(
    app: &AppHandle,
    date: &str,
    session_count: i32,
    total_cost: f64,
) -> Result<(), String> {
    let title = "📋 Daily Report";
    let body = format!(
        "{}: {} sessions, ${:.2}",
        date, session_count, total_cost
    );

    send_notification(app, title, &body)
}

/// Core notification sending function
fn send_notification(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Format duration in human-readable format
fn format_duration(seconds: u64) -> String {
    let minutes = seconds / 60;
    let hours = minutes / 60;

    if hours > 0 {
        format!("{}h {}m", hours, minutes % 60)
    } else if minutes > 0 {
        format!("{}m {}s", minutes, seconds % 60)
    } else {
        format!("{}s", seconds)
    }
}

/// Truncate string to max length with ellipsis
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len - 3])
    }
}

/// Session status change event for frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionStatusEvent {
    pub session_id: String,
    pub project_name: String,
    pub status: String,
    pub prompt_snippet: Option<String>,
    pub cost: Option<f64>,
    pub error_message: Option<String>,
}

/// Emit session status change to frontend and send notification
pub fn emit_session_status(
    app: &AppHandle,
    event: SessionStatusEvent,
) -> Result<(), String> {
    // Emit to frontend
    app.emit("session-status-changed", &event)
        .map_err(|e| e.to_string())?;

    // Send notification based on status
    match event.status.as_str() {
        "completed" => {
            if let Some(cost) = event.cost {
                notify_task_completed(
                    app,
                    &event.project_name,
                    event.prompt_snippet.as_deref().unwrap_or("Task"),
                    cost,
                    0, // Duration would need to be tracked separately
                )?;
            }
        }
        "error" => {
            notify_task_error(
                app,
                &event.project_name,
                event.error_message.as_deref().unwrap_or("Unknown error"),
            )?;
        }
        "needs_input" => {
            notify_needs_input(app, &event.project_name)?;
        }
        _ => {}
    }

    Ok(())
}
