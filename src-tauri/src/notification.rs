// Notification engine for session events

use std::borrow::Cow;

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// Emoji-to-spoken-label mapping for TTS output.
const EMOJI_LABELS: &[(&str, &str)] = &[
    ("✓", "Completed:"),
    ("✗", "Error:"),
    ("⚠", "Attention:"),
    ("▶", "Started:"),
    ("📋", ""),
];

// ---------------------------------------------------------------------------
// Public notification helpers
// ---------------------------------------------------------------------------

pub fn notify_task_completed(
    app: &AppHandle,
    project_name: &str,
    prompt_snippet: &str,
    cost: f64,
    duration_secs: u64,
) -> Result<(), String> {
    let snippet = truncate_str(prompt_snippet, 50);
    let duration = format_duration(duration_secs);
    let title = format!("✓ {project_name}");
    let body = format!("\"{snippet}\" finished ({duration}, ${cost:.2})");
    send_notification(app, &title, &body)
}

pub fn notify_task_error(
    app: &AppHandle,
    project_name: &str,
    error_message: &str,
) -> Result<(), String> {
    let msg = truncate_str(error_message, 100);
    send_notification(app, &format!("✗ {project_name}"), &format!("Error: {msg}"))
}

pub fn notify_needs_input(app: &AppHandle, project_name: &str) -> Result<(), String> {
    send_notification(app, &format!("⚠ {project_name}"), "Waiting for user input")
}

pub fn notify_queue_started(
    app: &AppHandle,
    project_name: &str,
    prompt_snippet: &str,
) -> Result<(), String> {
    let snippet = truncate_str(prompt_snippet, 50);
    send_notification(
        app,
        &format!("▶ Queue: {project_name}"),
        &format!("Starting: \"{snippet}\""),
    )
}

#[allow(dead_code)]
pub fn notify_daily_report(
    app: &AppHandle,
    date: &str,
    session_count: i32,
    total_cost: f64,
) -> Result<(), String> {
    send_notification(
        app,
        "📋 Daily Report",
        &format!("{date}: {session_count} sessions, ${total_cost:.2}"),
    )
}

/// Truncates title/body to prevent overly long notifications from hook scripts.
pub fn send_hook_notification(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    send_notification(app, &truncate_str(title, 80), &truncate_str(body, 200))
}

// ---------------------------------------------------------------------------
// Core notification dispatch
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------

fn speak_notification(title: &str, body: &str) {
    let clean_title = EMOJI_LABELS
        .iter()
        .fold(title.to_string(), |acc, &(emoji, label)| acc.replace(emoji, label));

    let text = format!("{} {body}", clean_title.trim());

    std::thread::spawn(move || {
        let _ = build_tts_command(&text).output();
    });
}

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

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

fn format_duration(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;

    if hours > 0 {
        format!("{hours}h {minutes}m")
    } else if minutes > 0 {
        format!("{minutes}m {secs}s")
    } else {
        format!("{secs}s")
    }
}

fn truncate_str(s: &str, max_len: usize) -> Cow<'_, str> {
    if s.len() <= max_len {
        return Cow::Borrowed(s);
    }
    // Walk backwards from the byte limit to find a char boundary (stable alternative
    // to the nightly-only `floor_char_boundary`).
    let mut end = max_len.saturating_sub(3);
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    Cow::Owned(format!("{}...", &s[..end]))
}

// ---------------------------------------------------------------------------
// Session status event (emitted to frontend)
// ---------------------------------------------------------------------------

#[allow(dead_code)]
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionStatusEvent {
    pub session_id: String,
    pub project_name: String,
    pub status: String,
    pub prompt_snippet: Option<String>,
    pub cost: Option<f64>,
    pub error_message: Option<String>,
}

#[allow(dead_code)]
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
