// Notification engine for session events

#![allow(dead_code)]

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// Send a notification for task completion
pub fn notify_task_completed(
    app: &AppHandle,
    project_name: &str,
    prompt_snippet: &str,
    cost: f64,
    duration_secs: u64,
) -> Result<(), String> {
    let title = format!("✓ {}", project_name);
    let body = format!(
        "\"{}\" finished ({}, ${:.2})",
        truncate_str(prompt_snippet, 50),
        format_duration(duration_secs),
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
    let body = format!("Error: {}", truncate_str(error_message, 100));
    send_notification(app, &title, &body)
}

/// Send a notification when input is needed
pub fn notify_needs_input(app: &AppHandle, project_name: &str) -> Result<(), String> {
    let title = format!("⚠ {}", project_name);
    send_notification(app, &title, "Waiting for user input")
}

/// Send a notification when queue task starts
pub fn notify_queue_started(
    app: &AppHandle,
    project_name: &str,
    prompt_snippet: &str,
) -> Result<(), String> {
    let title = format!("▶ Queue: {}", project_name);
    let body = format!("Starting: \"{}\"", truncate_str(prompt_snippet, 50));
    send_notification(app, &title, &body)
}

/// Send a notification for daily report
pub fn notify_daily_report(
    app: &AppHandle,
    date: &str,
    session_count: i32,
    total_cost: f64,
) -> Result<(), String> {
    let body = format!("{}: {} sessions, ${:.2}", date, session_count, total_cost);
    send_notification(app, "📋 Daily Report", &body)
}

/// Core notification sending function
fn send_notification(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())?;

    if crate::config::load_config().voice_notifications {
        speak_notification(title, body);
    }

    Ok(())
}

/// Speak notification using platform-native TTS
fn speak_notification(title: &str, body: &str) {
    let clean_title = title
        .replace("✓", "Completed:")
        .replace("✗", "Error:")
        .replace("⚠", "Attention:")
        .replace("▶", "Started:")
        .replace("📋", "");

    let text = format!("{} {}", clean_title.trim(), body);

    std::thread::spawn(move || {
        let _ = build_tts_command(&text).output();
    });
}

/// Build a platform-specific TTS command
#[cfg(target_os = "macos")]
fn build_tts_command(text: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new("say");
    cmd.args(["-v", "Samantha", "-r", "200", text]);
    cmd
}

#[cfg(target_os = "windows")]
fn build_tts_command(text: &str) -> std::process::Command {
    let escaped = text.replace('\'', "''");
    let mut cmd = std::process::Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-Command",
        &format!(
            "Add-Type -AssemblyName System.Speech; \
             $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
             $s.Rate = 1; \
             $s.Speak('{}')",
            escaped
        ),
    ]);
    cmd
}

#[cfg(target_os = "linux")]
fn build_tts_command(text: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new("espeak");
    cmd.arg(text);
    cmd
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

/// Truncate string to max length with ellipsis, respecting char boundaries
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }
    // Find a valid char boundary at or before max_len - 3
    let mut end = max_len - 3;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &s[..end])
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
pub fn emit_session_status(app: &AppHandle, event: SessionStatusEvent) -> Result<(), String> {
    app.emit("session-status-changed", &event)
        .map_err(|e| e.to_string())?;

    match event.status.as_str() {
        "completed" => {
            if let Some(cost) = event.cost {
                notify_task_completed(
                    app,
                    &event.project_name,
                    event.prompt_snippet.as_deref().unwrap_or("Task"),
                    cost,
                    0,
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
