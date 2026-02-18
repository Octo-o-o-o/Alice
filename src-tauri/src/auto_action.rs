// Auto Action Module - Sleep/Shutdown after all tasks complete

use crate::config::{load_config, save_config, AutoActionType};
use serde::Serialize;
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct AutoActionState {
    pub timer_active: bool,
    pub action_type: String,
    pub remaining_seconds: u64,
    pub total_seconds: u64,
}

impl AutoActionState {
    fn inactive(action_type: &str) -> Self {
        Self {
            timer_active: false,
            action_type: action_type.to_string(),
            remaining_seconds: 0,
            total_seconds: 0,
        }
    }

    fn active(action_type: &str, remaining: Duration, total: Duration) -> Self {
        Self {
            timer_active: true,
            action_type: action_type.to_string(),
            remaining_seconds: remaining.as_secs(),
            total_seconds: total.as_secs(),
        }
    }
}

impl fmt::Display for AutoActionType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let label = match self {
            AutoActionType::Sleep => "sleep",
            AutoActionType::Shutdown => "shutdown",
            AutoActionType::None => "none",
        };
        f.write_str(label)
    }
}

pub struct AutoActionManager {
    app: AppHandle,
    timer_active: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
    start_time: Arc<Mutex<Option<Instant>>>,
    total_duration: Arc<Mutex<Duration>>,
}

impl AutoActionManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            timer_active: Arc::new(AtomicBool::new(false)),
            cancelled: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(Mutex::new(None)),
            total_duration: Arc::new(Mutex::new(Duration::ZERO)),
        }
    }

    /// Compute remaining and total duration from current timer state.
    async fn remaining(&self) -> (Duration, Duration) {
        let elapsed = self
            .start_time
            .lock()
            .await
            .map(|s| s.elapsed())
            .unwrap_or(Duration::ZERO);
        let total = *self.total_duration.lock().await;
        (total.saturating_sub(elapsed), total)
    }

    pub async fn start_timer(&self) -> Result<(), String> {
        let config = load_config();

        if !config.auto_action.enabled {
            return Err("Auto action is not enabled".to_string());
        }

        if config.auto_action.action_type == AutoActionType::None {
            return Err("No action type selected".to_string());
        }

        if self.timer_active.swap(true, Ordering::SeqCst) {
            return Err("Timer already active".to_string());
        }

        self.cancelled.store(false, Ordering::SeqCst);

        let delay = Duration::from_secs(config.auto_action.delay_minutes as u64 * 60);
        *self.start_time.lock().await = Some(Instant::now());
        *self.total_duration.lock().await = delay;

        let timer_active = self.timer_active.clone();
        let cancelled = self.cancelled.clone();
        let app = self.app.clone();
        let action_type = config.auto_action.action_type.clone();
        let start_time = self.start_time.clone();
        let total_duration = self.total_duration.clone();

        tauri::async_runtime::spawn(async move {
            let action_str = action_type.to_string();

            loop {
                if cancelled.load(Ordering::SeqCst) {
                    tracing::info!("Auto action timer cancelled");
                    break;
                }

                let elapsed = start_time
                    .lock()
                    .await
                    .map(|s| s.elapsed())
                    .unwrap_or(Duration::ZERO);
                let total = *total_duration.lock().await;

                if elapsed >= total {
                    tracing::info!("Executing auto action: {:?}", action_type);
                    reset_auto_action_config();

                    if let Err(e) = execute_system_action(&action_type) {
                        tracing::error!("Failed to execute auto action: {}", e);
                    }
                    break;
                }

                let remaining = total.saturating_sub(elapsed);
                let _ = app.emit(
                    "auto-action-state",
                    AutoActionState::active(&action_str, remaining, total),
                );

                tokio::time::sleep(Duration::from_secs(1)).await;
            }

            timer_active.store(false, Ordering::SeqCst);
            let _ = app.emit("auto-action-state", AutoActionState::inactive("none"));
        });

        Ok(())
    }

    pub fn cancel_timer(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.timer_active.store(false, Ordering::SeqCst);
        let _ = self
            .app
            .emit("auto-action-state", AutoActionState::inactive("none"));
    }

    #[allow(dead_code)]
    pub fn is_timer_active(&self) -> bool {
        self.timer_active.load(Ordering::SeqCst)
    }

    pub async fn get_state(&self) -> AutoActionState {
        let action_str = load_config().auto_action.action_type.to_string();

        if !self.timer_active.load(Ordering::SeqCst) {
            return AutoActionState::inactive(&action_str);
        }

        let (remaining, total) = self.remaining().await;
        AutoActionState::active(&action_str, remaining, total)
    }
}

fn reset_auto_action_config() {
    let mut config = load_config();
    config.auto_action.enabled = false;
    config.auto_action.action_type = AutoActionType::None;
    if let Err(e) = save_config(&config) {
        tracing::error!("Failed to reset auto action config: {}", e);
    }
}

fn execute_system_action(action_type: &AutoActionType) -> Result<(), String> {
    match action_type {
        AutoActionType::Sleep => run_platform_command(sleep_command()),
        AutoActionType::Shutdown => run_platform_command(shutdown_command()),
        AutoActionType::None => Ok(()),
    }
}

/// Platform-specific command descriptor: (program, args).
type PlatformCommand = (&'static str, Vec<&'static str>);

fn sleep_command() -> PlatformCommand {
    #[cfg(target_os = "macos")]
    {
        ("pmset", vec!["sleepnow"])
    }

    #[cfg(target_os = "windows")]
    {
        ("powershell", vec![
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)",
        ])
    }

    #[cfg(target_os = "linux")]
    {
        ("systemctl", vec!["suspend"])
    }
}

fn shutdown_command() -> PlatformCommand {
    #[cfg(target_os = "macos")]
    {
        (
            "osascript",
            vec!["-e", "tell application \"Finder\" to shut down"],
        )
    }

    #[cfg(target_os = "windows")]
    {
        ("shutdown", vec![
            "/s",
            "/t",
            "60",
            "/c",
            "Alice: Auto shutdown in 60 seconds. Run 'shutdown /a' to cancel.",
        ])
    }

    #[cfg(target_os = "linux")]
    {
        ("systemctl", vec!["poweroff"])
    }
}

fn run_platform_command((program, args): PlatformCommand) -> Result<(), String> {
    std::process::Command::new(program)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to execute '{}': {}", program, e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Global manager instance
// ---------------------------------------------------------------------------

static AUTO_ACTION_MANAGER: once_cell::sync::OnceCell<Mutex<Option<AutoActionManager>>> =
    once_cell::sync::OnceCell::new();

pub fn init_auto_action(app: &AppHandle) {
    let manager = AutoActionManager::new(app.clone());
    let _ = AUTO_ACTION_MANAGER.set(Mutex::new(Some(manager)));
}

fn try_get_manager() -> Option<tokio::sync::MutexGuard<'static, Option<AutoActionManager>>> {
    AUTO_ACTION_MANAGER.get()?.try_lock().ok()
}

pub async fn start_auto_action_timer(app: &AppHandle) -> Result<(), String> {
    let config = load_config();

    if !config.auto_action.enabled || config.auto_action.action_type == AutoActionType::None {
        return Ok(());
    }

    // Use the global manager so cancel/get_state work correctly.
    if let Some(guard) = try_get_manager() {
        if let Some(manager) = guard.as_ref() {
            return manager.start_timer().await;
        }
    }

    // Fallback: create an ephemeral manager if the global one is unavailable.
    AutoActionManager::new(app.clone()).start_timer().await
}

pub async fn cancel_auto_action_timer() -> Result<(), String> {
    if let Some(guard) = try_get_manager() {
        if let Some(manager) = guard.as_ref() {
            manager.cancel_timer();
        }
    }
    Ok(())
}

pub async fn get_auto_action_state(_app: &AppHandle) -> AutoActionState {
    if let Some(guard) = try_get_manager() {
        if let Some(manager) = guard.as_ref() {
            return manager.get_state().await;
        }
    }

    AutoActionState::inactive(&load_config().auto_action.action_type.to_string())
}
