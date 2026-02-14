// Alice - Claude Code Desktop Assistant
// A lightweight menu bar application for managing Claude Code tasks, sessions, and workflows

mod auto_action;
mod commands;
mod config;
mod database;
mod notification;
mod platform;
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
                .icon(tauri::include_image!("icons/tray-icon.png"))
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Alice - Claude Code Assistant")
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            // Toggle window visibility
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                // Position window aligned with tray icon
                                if let Ok(Some(monitor)) = window.current_monitor() {
                                    let monitor_size = monitor.size();
                                    let scale_factor = monitor.scale_factor();
                                    let window_size = window.outer_size().unwrap_or_default();

                                    // Tray click position (physical pixels)
                                    let tray_x = position.x as i32;
                                    let tray_y = position.y as i32;

                                    // Gap between window and menu bar/taskbar (in logical pixels)
                                    let gap = (8.0 * scale_factor) as i32;

                                    // macOS: menu bar at top, tray icons on right side of menu bar
                                    // Window should align left edge with tray icon, below menu bar
                                    #[cfg(target_os = "macos")]
                                    let (x, y) = {
                                        // Use tray click y position + gap to position below menu bar
                                        // This handles both regular and notched MacBooks correctly
                                        // Add extra offset to clear the menu bar (tray_y is center of icon)
                                        let menu_bar_bottom = tray_y + (14.0 * scale_factor) as i32;

                                        // Align window left edge with tray icon position
                                        // But ensure window doesn't go off screen right edge
                                        let x = (tray_x).min(
                                            monitor_size.width as i32 - window_size.width as i32 - gap,
                                        );

                                        // Position below menu bar with gap
                                        let y = menu_bar_bottom + gap;

                                        (x, y)
                                    };

                                    // Windows: taskbar typically at bottom, system tray on right
                                    // Window should appear above taskbar, aligned with tray icon
                                    #[cfg(target_os = "windows")]
                                    let (x, y) = {
                                        // Use tray click y position to determine taskbar top
                                        // tray_y is center of icon, subtract half icon height (~12px) to get taskbar top
                                        let taskbar_top = tray_y - (12.0 * scale_factor) as i32;

                                        // Align window left edge with tray icon
                                        // Ensure window doesn't go off screen right edge
                                        let x = (tray_x).min(
                                            monitor_size.width as i32 - window_size.width as i32 - gap,
                                        );

                                        // Position window bottom above taskbar with gap
                                        let y = taskbar_top - window_size.height as i32 - gap;

                                        (x, y)
                                    };

                                    // Fallback for other platforms (Linux, etc.)
                                    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                                    let (x, y) = {
                                        let x = (tray_x).min(
                                            monitor_size.width as i32 - window_size.width as i32 - gap,
                                        );
                                        let y = gap;
                                        (x, y)
                                    };

                                    // Ensure x is not negative
                                    let x = x.max(gap);

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
            commands::rescan_sessions,
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
            commands::install_hooks,
            commands::check_hooks_installed,
            commands::generate_report_ai_summary,
            commands::get_anthropic_status,
            commands::get_onboarding_status,
            commands::install_and_verify_hooks,
            commands::get_available_terminals,
            commands::get_favorites,
            commands::create_favorite,
            commands::update_favorite,
            commands::delete_favorite,
            commands::reorder_favorites,
            commands::get_auto_action_state,
            commands::start_auto_action_timer,
            commands::cancel_auto_action_timer,
            commands::get_claude_environments,
            commands::get_active_environment,
            commands::add_claude_environment,
            commands::update_claude_environment,
            commands::delete_claude_environment,
            commands::set_active_environment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
