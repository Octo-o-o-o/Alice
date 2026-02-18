// File watcher for multi-provider session directories

use crate::database;
use crate::providers::{Provider, ProviderId};
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

/// Check whether a path points to a JSONL file
fn is_jsonl(path: &Path) -> bool {
    path.extension().is_some_and(|e| e == "jsonl")
}

/// Build a mapping from session directories to their provider IDs.
/// Falls back to the default Claude directory when no providers yield directories.
fn build_provider_dir_map() -> HashMap<PathBuf, ProviderId> {
    let mut map = HashMap::new();

    for provider in crate::providers::get_enabled_providers() {
        let provider_id = provider.id();
        for dir in provider.get_session_dirs() {
            if dir.exists() {
                tracing::info!("Found {} directory: {:?}", provider_id, dir);
                map.insert(dir, provider_id);
            }
        }
    }

    if map.is_empty() {
        let default_dir = crate::platform::get_claude_dir().join("projects");
        if default_dir.exists() {
            tracing::warn!("No providers enabled, falling back to default Claude directory");
            map.insert(default_dir, ProviderId::Claude);
        }
    }

    map
}

/// Find which provider a path belongs to by checking watched directory prefixes.
fn find_provider_for_path(
    path: &Path,
    dir_to_provider: &HashMap<PathBuf, ProviderId>,
) -> Option<ProviderId> {
    dir_to_provider
        .iter()
        .find(|(watched_dir, _)| path.starts_with(watched_dir))
        .map(|(_, &id)| id)
}

/// Walk a directory and process every JSONL session file using the given provider.
/// Returns the number of successfully processed sessions.
fn scan_provider_sessions(app: &AppHandle, dir: &Path, provider: &dyn Provider) -> u32 {
    if !dir.exists() {
        return 0;
    }

    let mut count: u32 = 0;
    for entry in walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if is_jsonl(path) {
            match process_session_file(app, path, provider) {
                Ok(()) => count += 1,
                Err(e) => tracing::warn!(
                    "Failed to process {} session file {:?}: {}",
                    provider.id(),
                    path,
                    e
                ),
            }
        }
    }
    count
}

/// Start the file watcher for all enabled provider directories
pub fn start_watcher(app: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let dir_to_provider = build_provider_dir_map();

    if dir_to_provider.is_empty() {
        tracing::warn!("No provider directories found");
        return Ok(());
    }

    tracing::info!(
        "Starting file watcher for {} provider directories",
        dir_to_provider.len()
    );

    // Initial scan for all provider directories
    for (dir, provider_id) in &dir_to_provider {
        tracing::info!("Scanning {} directory: {:?}", provider_id, dir);
        let provider = crate::providers::get_provider(*provider_id);
        scan_provider_sessions(&app, dir, provider.as_ref());
    }

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

    for (dir, provider_id) in &dir_to_provider {
        tracing::info!("Watching {} directory: {:?}", provider_id, dir);
        watcher.watch(dir, RecursiveMode::Recursive)?;
    }

    let mut last_processed: HashMap<PathBuf, Instant> = HashMap::new();
    let debounce_duration = Duration::from_millis(500);

    for event in rx {
        for path in event.paths {
            if !is_jsonl(&path) {
                continue;
            }

            // Debounce: skip files processed too recently
            let now = Instant::now();
            if let Some(last) = last_processed.get(&path) {
                if now.duration_since(*last) < debounce_duration {
                    continue;
                }
            }
            last_processed.insert(path.clone(), now);

            let provider_id =
                find_provider_for_path(&path, &dir_to_provider).unwrap_or(ProviderId::Claude);
            let provider = crate::providers::get_provider(provider_id);

            if let Err(e) = process_session_file(&app, &path, provider.as_ref()) {
                tracing::error!(
                    "Failed to process {} session file {:?}: {}",
                    provider_id,
                    path,
                    e
                );
            }
        }

        // Clean up old entries from debounce map
        let now = Instant::now();
        last_processed.retain(|_, last| now.duration_since(*last) < Duration::from_secs(60));
    }

    Ok(())
}

/// Process a single session JSONL file using the given provider
fn process_session_file(
    app: &AppHandle,
    path: &Path,
    provider: &dyn Provider,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing::debug!("Processing {} session file: {:?}", provider.id(), path);

    let session = provider
        .parse_session(path)
        .map_err(|e| format!("Provider parse error: {}", e))?;

    database::upsert_session(&session)?;

    let status_str = session.status.as_str().to_string();
    set_tray_state(app, TrayState::from(session.status));

    app.emit(
        "session-updated",
        SessionUpdateEvent {
            session_id: session.session_id,
            project_path: session.project_path,
            status: status_str,
        },
    )?;

    Ok(())
}

/// Force rescan all session files to update token data (all providers)
pub fn rescan_all_sessions(
    app: &AppHandle,
) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
    let dir_to_provider = build_provider_dir_map();

    tracing::info!("Rescan: Found {} provider directories", dir_to_provider.len());

    let mut count: u32 = 0;
    for (dir, provider_id) in &dir_to_provider {
        tracing::info!("Force rescanning all {} sessions in {:?}", provider_id, dir);
        let provider = crate::providers::get_provider(*provider_id);
        let scanned = scan_provider_sessions(app, dir, provider.as_ref());
        tracing::info!("  Scanned {} {} sessions from {:?}", scanned, provider_id, dir);
        count += scanned;
    }

    tracing::info!(
        "Rescan complete: {} sessions updated across all providers",
        count
    );
    Ok(count)
}
