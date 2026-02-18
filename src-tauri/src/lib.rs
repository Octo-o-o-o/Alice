mod auto_action;
mod commands;
mod config;
mod database;
mod hook_processor;
mod http_server;
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
    AppHandle, Manager, WebviewWindow, WindowEvent,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Calculate the window position anchored to the tray icon.
///
/// Platform behavior:
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

/// Toggle quick window visibility: hide if visible, position and show if hidden.
fn toggle_quick_window(window: &WebviewWindow, tray_position: tauri::PhysicalPosition<f64>) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    if let Some((x, y)) = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .and_then(|scale| {
            calculate_window_position(
                window,
                tray_position.x as i32,
                tray_position.y as i32,
                scale,
            )
        })
    {
        let pos = tauri::Position::Physical(tauri::PhysicalPosition::new(x, y));
        let _ = window.set_position(pos);
    }

    let _ = window.show();
    let _ = window.set_focus();
}

/// Initialize core services: database, queue, auto-action, and background workers.
fn initialize_services(handle: &AppHandle) {
    if let Err(e) = database::init_database(handle) {
        tracing::error!("Failed to initialize database: {}", e);
    }

    queue::init_queue(handle);
    auto_action::init_auto_action(handle);
    hook_processor::start_hook_processor(handle.clone());

    let watcher_handle = handle.clone();
    std::thread::spawn(move || {
        if let Err(e) = watcher::start_watcher(watcher_handle) {
            tracing::error!("Failed to start file watcher: {}", e);
        }
    });

    let server_handle = handle.clone();
    let server_port = config::load_config().hook_server_port;
    tauri::async_runtime::spawn(async move {
        http_server::start_http_server(server_handle, server_port).await;
    });
}

/// Build the system tray icon with click-to-toggle behavior.
fn build_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();

    TrayIconBuilder::with_id("main")
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
                if let Some(window) = handle.get_webview_window("quick") {
                    toggle_quick_window(&window, position);
                }
            }
        })
        .build(app.handle())?;

    Ok(())
}

/// Hide quick window on blur when configured.
fn setup_hide_on_blur(app: &tauri::App) {
    if !config::load_config().auto_hide_on_blur {
        return;
    }

    if let Some(window) = app.get_webview_window("quick") {
        let window_handle = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::Focused(false) = event {
                let _ = window_handle.hide();
            }
        });
    }
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
            initialize_services(app.handle());
            build_tray(app)?;
            setup_hide_on_blur(app);
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
            commands::get_hook_server_port,
            commands::install_gemini_hooks,
            commands::get_window_context,
            commands::open_main_window,
            commands::open_quick_window,
            commands::navigate_deep_link,
            commands::tool_gate_decide,
            commands::tool_run_status,
            commands::tool_list_artifacts,
            commands::emit_task_event,
            commands::emit_refresh_quick,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
