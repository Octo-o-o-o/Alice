// Alice - Claude Code Desktop Assistant
// A lightweight menu bar application for managing Claude Code tasks, sessions, and workflows

mod auto_action;
mod commands;
mod config;
mod database;
mod notification;
mod platform;
mod providers;
mod queue;
mod report;
mod session;
mod tray;
mod usage;
mod watcher;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow, WindowEvent,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Calculate the window position relative to the tray icon click.
///
/// Each platform anchors the window differently:
/// - macOS: below the menu bar, left-aligned with the tray icon
/// - Windows: above the taskbar, left-aligned with the tray icon
/// - Other: top of the screen with a small gap
fn calculate_window_position(
    window: &WebviewWindow,
    tray_x: i32,
    tray_y: i32,
    scale_factor: f64,
) -> Option<(i32, i32)> {
    let monitor = window.current_monitor().ok()??;
    let monitor_width = monitor.size().width as i32;
    let window_size = window.outer_size().unwrap_or_default();
    let gap = (8.0 * scale_factor) as i32;

    let max_x = monitor_width - window_size.width as i32 - gap;

    #[cfg(target_os = "macos")]
    let (x, y) = {
        let menu_bar_bottom = tray_y + (14.0 * scale_factor) as i32;
        (tray_x.min(max_x), menu_bar_bottom + gap)
    };

    #[cfg(target_os = "windows")]
    let (x, y) = {
        let taskbar_top = tray_y - (12.0 * scale_factor) as i32;
        (
            tray_x.min(max_x),
            taskbar_top - window_size.height as i32 - gap,
        )
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (x, y) = (tray_x.min(max_x), gap);

    Some((x.max(gap), y))
}

/// Toggle window visibility: hide if visible, position and show if hidden.
fn toggle_window(window: &WebviewWindow, tray_position: tauri::PhysicalPosition<f64>) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    if let Some(scale_factor) = window.current_monitor().ok().flatten().map(|m| m.scale_factor()) {
        if let Some((x, y)) = calculate_window_position(
            window,
            tray_position.x as i32,
            tray_position.y as i32,
            scale_factor,
        ) {
            let _ = window.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition::new(x, y),
            ));
        }
    }

    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            if let Err(e) = database::init_database(&app.handle().clone()) {
                tracing::error!("Failed to initialize database: {}", e);
            }

            // Initialize queue executor
            queue::init_queue(&app.handle());

            // Initialize auto-action manager
            auto_action::init_auto_action(&app.handle());

            let watcher_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = watcher::start_watcher(watcher_handle) {
                    tracing::error!("Failed to start file watcher: {}", e);
                }
            });

            let tray_handle = app.handle().clone();
            let _tray = TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/tray-icon.png"))
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Alice - Claude Code Assistant")
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        if let Some(window) = tray_handle.get_webview_window("main") {
                            toggle_window(&window, position);
                        }
                    }
                })
                .build(app.handle())?;

            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        let _ = w.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_sessions,
            commands::get_session_detail,
            commands::get_session_images,
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
            commands::get_provider_usage,
            commands::rescan_sessions,
            commands::debug_get_enabled_providers,
            commands::debug_get_codex_dirs,
            commands::debug_codex_db_sessions,
            commands::start_queue,
            commands::stop_queue,
            commands::get_queue_status,
            commands::generate_daily_report,
            commands::get_daily_report,
            commands::list_reports,
            commands::export_report_markdown,
            commands::save_report_file,
            commands::get_projects,
            commands::get_config,
            commands::update_config,
            commands::get_system_info,
            commands::reorder_tasks,
            commands::update_session_label,
            commands::scan_claude_directory,
            commands::install_hooks,
            commands::check_hooks_installed,
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
            commands::get_provider_statuses,
            commands::update_provider_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
