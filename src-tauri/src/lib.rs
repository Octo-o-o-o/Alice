// Alice - Claude Code Desktop Assistant
// A lightweight menu bar application for managing Claude Code tasks, sessions, and workflows

mod commands;
mod config;
mod database;
mod notification;
mod queue;
mod report;
mod session;
mod tray;
mod usage;
mod watcher;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    tracing::info!("Starting Alice...");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Initialize database
            let app_handle = app.handle().clone();
            if let Err(e) = database::init_database(&app_handle) {
                tracing::error!("Failed to initialize database: {}", e);
            }

            // Start file watcher
            let app_handle_watcher = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = watcher::start_watcher(app_handle_watcher) {
                    tracing::error!("Failed to start file watcher: {}", e);
                }
            });

            // Set up tray icon
            let app_handle_tray = app.handle().clone();
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .tooltip("Alice - Claude Code Assistant")
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            // Toggle window visibility
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                // Position window near tray icon (top-right on macOS)
                                // Simplified positioning for Tauri 2.0 API compatibility
                                if let Ok(Some(monitor)) = window.current_monitor() {
                                    let size = monitor.size();
                                    let window_size = window.outer_size().unwrap_or_default();
                                    // Position at top-right, below menu bar
                                    let x = (size.width as i32 - window_size.width as i32) - 20;
                                    let y = 30; // Below menu bar
                                    let _ = window.set_position(tauri::Position::Physical(
                                        tauri::PhysicalPosition::new(x, y),
                                    ));
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(&app_handle_tray)?;

            // Handle window blur to auto-hide
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        // Auto-hide on blur (can be made configurable)
                        let _ = window_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_sessions,
            commands::get_session_detail,
            commands::get_active_sessions,
            commands::get_usage_stats,
            commands::get_tasks,
            commands::create_task,
            commands::update_task,
            commands::delete_task,
            commands::search_sessions,
            commands::search_sessions_filtered,
            commands::resume_session,
            commands::fork_session,
            commands::delete_session,
            commands::export_session,
            commands::get_live_usage,
            commands::has_claude_credentials,
            commands::start_queue,
            commands::stop_queue,
            commands::get_queue_status,
            commands::generate_daily_report,
            commands::get_daily_report,
            commands::list_reports,
            commands::get_projects,
            commands::get_config,
            commands::update_config,
            commands::get_system_info,
            commands::reorder_tasks,
            commands::update_session_label,
            commands::scan_claude_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
