// File watcher for ~/.claude/ directory

use crate::database;
use crate::session::{extract_session_metadata, is_session_active, parse_session_file, SessionStatus};
use crate::tray::{set_tray_state, TrayState};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Events emitted to the frontend
#[derive(Clone, serde::Serialize)]
pub struct SessionUpdateEvent {
    pub session_id: String,
    pub project_path: String,
    pub status: String,
}

/// Start the file watcher for ~/.claude/
pub fn start_watcher(app: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let claude_dir = get_claude_dir()?;

    if !claude_dir.exists() {
        tracing::warn!("Claude directory not found: {:?}", claude_dir);
        return Ok(());
    }

    tracing::info!("Starting file watcher on {:?}", claude_dir);

    // Initial scan
    initial_scan(&app, &claude_dir)?;

    // Set up file watcher
    let (tx, rx) = channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(500)),
    )?;

    // Watch the projects directory recursively
    let projects_dir = claude_dir.join("projects");
    if projects_dir.exists() {
        watcher.watch(&projects_dir, RecursiveMode::Recursive)?;
    }

    // Debounce map to avoid processing the same file multiple times
    let mut last_processed: HashMap<PathBuf, Instant> = HashMap::new();
    let debounce_duration = Duration::from_millis(500);

    // Process events
    for event in rx {
        for path in event.paths {
            // Only process JSONL files
            if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                // Debounce
                let now = Instant::now();
                if let Some(last) = last_processed.get(&path) {
                    if now.duration_since(*last) < debounce_duration {
                        continue;
                    }
                }
                last_processed.insert(path.clone(), now);

                // Process the file
                if let Err(e) = process_session_file(&app, &path) {
                    tracing::error!("Failed to process session file {:?}: {}", path, e);
                }
            }
        }

        // Clean up old entries from debounce map
        last_processed.retain(|_, last| now() - *last < Duration::from_secs(60));
    }

    Ok(())
}

fn now() -> Instant {
    Instant::now()
}

/// Get the Claude directory path
fn get_claude_dir() -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".claude"))
}

/// Perform initial scan of existing session files
fn initial_scan(app: &AppHandle, claude_dir: &Path) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let projects_dir = claude_dir.join("projects");
    if !projects_dir.exists() {
        return Ok(());
    }

    tracing::info!("Performing initial scan of {:?}", projects_dir);

    // Walk through all project directories
    for entry in walkdir::WalkDir::new(&projects_dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            if let Err(e) = process_session_file(app, path) {
                tracing::warn!("Failed to process session file {:?}: {}", path, e);
            }
        }
    }

    tracing::info!("Initial scan complete");
    Ok(())
}

/// Process a session JSONL file
fn process_session_file(app: &AppHandle, path: &Path) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Extract session ID and project path from the file path
    // Path format: ~/.claude/projects/<encoded_project_path>/<session_id>.jsonl
    let file_name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if file_name.is_empty() {
        return Ok(());
    }

    let session_id = file_name.to_string();

    // Extract project path from parent directory name
    let parent = path.parent().ok_or("No parent directory")?;
    let encoded_project = parent.file_name().and_then(|s| s.to_str()).unwrap_or("");
    let project_path = decode_project_path(encoded_project);

    tracing::debug!("Processing session file: {} for project: {}", session_id, project_path);

    // Parse the JSONL file
    let lines = parse_session_file(path)?;
    if lines.is_empty() {
        return Ok(());
    }

    // Extract metadata
    let mut session = extract_session_metadata(&session_id, &project_path, &lines);

    // Check if session is currently active
    if is_session_active(path) {
        session.status = crate::session::SessionStatus::Active;
    }

    // Store in database
    database::upsert_session(&session)?;

    // Update tray state based on session status
    let tray_state = match session.status {
        SessionStatus::Active => TrayState::Active,
        SessionStatus::NeedsInput => TrayState::Warning,
        SessionStatus::Error => TrayState::Error,
        SessionStatus::Completed => TrayState::Success,
        SessionStatus::Idle => TrayState::Idle,
    };
    set_tray_state(app, tray_state);

    // Emit event to frontend
    let event = SessionUpdateEvent {
        session_id: session.session_id.clone(),
        project_path: session.project_path.clone(),
        status: format!("{:?}", session.status).to_lowercase(),
    };

    app.emit("session-updated", event)?;

    Ok(())
}

/// Decode the encoded project path
/// Claude Code encodes project paths by replacing / with - and other special handling
fn decode_project_path(encoded: &str) -> String {
    // The encoding is: replace '/' with '-', URL-encode special chars
    // For simplicity, we'll just handle common cases

    // First try URL decoding
    let decoded = urlencoding::decode(encoded).unwrap_or_else(|_| encoded.into());

    // Claude Code uses base64-like encoding for paths
    // The format appears to be the full path with '/' replaced by certain sequences
    // For now, we'll try to reconstruct a reasonable path

    // Check if it starts with typical path indicators
    if decoded.starts_with("-Users-") || decoded.starts_with("-home-") {
        // Replace leading dash and remaining dashes that represent /
        return decoded
            .strip_prefix("-")
            .unwrap_or(&decoded)
            .replace("-", "/");
    }

    // If it looks like an absolute path already, return as-is
    if decoded.starts_with("/") {
        return decoded.to_string();
    }

    // Otherwise, assume it's a relative path from home
    if let Some(home) = dirs::home_dir() {
        if decoded.contains("-") {
            return format!("{}/{}", home.display(), decoded.replace("-", "/"));
        }
    }

    decoded.to_string()
}

/// Watch for history.jsonl changes
pub fn watch_history_file(_app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let claude_dir = get_claude_dir()?;
    let history_file = claude_dir.join("history.jsonl");

    if !history_file.exists() {
        tracing::info!("History file not found, skipping watch");
        return Ok(());
    }

    // Parse and index history entries
    // This provides additional metadata for search
    // Implementation deferred to later phase

    Ok(())
}
