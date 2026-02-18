// Hook Event Processor
//
// Watches ~/.alice/hooks-events.jsonl for new lines written by provider hook
// scripts (Claude Code SessionStart/Stop/PreToolUse, etc.) and dispatches
// native notifications and frontend events accordingly.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use tauri::{AppHandle, Emitter};

/// A hook event written to hooks-events.jsonl by a provider CLI hook.
#[derive(Debug, Deserialize, Serialize)]
struct HookEvent {
    event: String,
    session_id: Option<String>,
    project: Option<String>,
    tool: Option<String>,
    timestamp: Option<i64>,
}

/// Start the hook event processor in a background thread.
/// Polls hooks-events.jsonl every 500ms for new lines and processes them.
pub fn start_hook_processor(app: AppHandle) {
    let hooks_file = crate::platform::get_alice_dir().join("hooks-events.jsonl");

    std::thread::spawn(move || {
        let mut position: u64 = 0;

        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));

            let file = match std::fs::File::open(&hooks_file) {
                Ok(f) => f,
                Err(_) => continue, // File doesn't exist yet or is inaccessible
            };

            // Guard against file truncation/rotation: reset position if file shrank
            if let Ok(meta) = file.metadata() {
                if meta.len() < position {
                    tracing::info!("hooks-events.jsonl was truncated, resetting position");
                    position = 0;
                }
            }

            let mut reader = BufReader::new(file);

            if reader.seek(SeekFrom::Start(position)).is_err() {
                position = 0;
                continue;
            }

            for line in (&mut reader).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    process_hook_event(&app, &line);
                }
            }

            if let Ok(pos) = reader.stream_position() {
                position = pos;
            }
        }
    });
}

fn process_hook_event(app: &AppHandle, line: &str) {
    let event: HookEvent = match serde_json::from_str(line) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("Failed to parse hook event '{}': {}", line, e);
            return;
        }
    };

    tracing::debug!("Hook event: {} (session: {:?})", event.event, event.session_id);

    let project = event.project.as_deref().unwrap_or("Unknown project");

    // Send system notification for actionable events
    match event.event.as_str() {
        "stop" | "session_end" => {
            let _ = crate::notification::notify_task_completed(app, project, "Session ended", 0.0, 0);
        }
        "pre_tool_use" => {
            let tool = event.tool.as_deref().unwrap_or("unknown tool");
            let body = format!("Wants to use: {}", tool);
            let _ = crate::notification::send_hook_notification(app, project, &body);
        }
        _ => {}
    }

    // Emit to frontend for real-time activity feed
    let _ = app.emit("hook-event", &event);
}
