// Auto Action Module - Sleep/Shutdown after all tasks complete

#![allow(dead_code)]

use crate::config::{load_config, save_config, AutoActionType};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::time::{Duration, Instant};

/// Auto action timer state
#[derive(Debug, Clone, Serialize)]
pub struct AutoActionState {
    /// Whether the timer is active
    pub timer_active: bool,
    /// Action type (sleep/shutdown)
    pub action_type: String,
    /// Remaining seconds until action
    pub remaining_seconds: u64,
    /// Total delay in seconds
    pub total_seconds: u64,
}

/// Global auto action manager
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

    /// Start the auto action timer
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

        // Spawn timer task
        tauri::async_runtime::spawn(async move {
            let action_str = match &action_type {
                AutoActionType::Sleep => "sleep",
                AutoActionType::Shutdown => "shutdown",
                AutoActionType::None => "none",
            };

            // Emit status updates every second
            loop {
                if cancelled.load(Ordering::SeqCst) {
                    tracing::info!("Auto action timer cancelled");
                    break;
                }

                let elapsed = {
                    let start = start_time.lock().await;
                    start.map(|s| s.elapsed()).unwrap_or(Duration::ZERO)
                };

                let total = *total_duration.lock().await;

                if elapsed >= total {
                    // Time to execute action
                    tracing::info!("Executing auto action: {:?}", action_type);

                    // Reset config (one-time use)
                    reset_auto_action_config();

                    // Emit final state
                    let _ = app.emit("auto-action-state", AutoActionState {
                        timer_active: false,
                        action_type: "none".to_string(),
                        remaining_seconds: 0,
                        total_seconds: 0,
                    });

                    // Execute the action
                    if let Err(e) = execute_system_action(&action_type) {
                        tracing::error!("Failed to execute auto action: {}", e);
                    }

                    break;
                }

                let remaining = total.saturating_sub(elapsed);

                // Emit state update
                let _ = app.emit("auto-action-state", AutoActionState {
                    timer_active: true,
                    action_type: action_str.to_string(),
                    remaining_seconds: remaining.as_secs(),
                    total_seconds: total.as_secs(),
                });

                tokio::time::sleep(Duration::from_secs(1)).await;
            }

            timer_active.store(false, Ordering::SeqCst);

            // Emit final state
            let _ = app.emit("auto-action-state", AutoActionState {
                timer_active: false,
                action_type: "none".to_string(),
                remaining_seconds: 0,
                total_seconds: 0,
            });
        });

        Ok(())
    }

    /// Cancel the auto action timer
    pub fn cancel_timer(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.timer_active.store(false, Ordering::SeqCst);

        // Emit cancelled state
        let _ = self.app.emit("auto-action-state", AutoActionState {
            timer_active: false,
            action_type: "none".to_string(),
            remaining_seconds: 0,
            total_seconds: 0,
        });
    }

    /// Check if timer is active
    pub fn is_timer_active(&self) -> bool {
        self.timer_active.load(Ordering::SeqCst)
    }

    /// Get current state
    pub async fn get_state(&self) -> AutoActionState {
        let config = load_config();
        let action_str = match &config.auto_action.action_type {
            AutoActionType::Sleep => "sleep",
            AutoActionType::Shutdown => "shutdown",
            AutoActionType::None => "none",
        };

        if !self.timer_active.load(Ordering::SeqCst) {
            return AutoActionState {
                timer_active: false,
                action_type: action_str.to_string(),
                remaining_seconds: 0,
                total_seconds: 0,
            };
        }

        let elapsed = {
            let start = self.start_time.lock().await;
            start.map(|s| s.elapsed()).unwrap_or(Duration::ZERO)
        };

        let total = *self.total_duration.lock().await;
        let remaining = total.saturating_sub(elapsed);

        AutoActionState {
            timer_active: true,
            action_type: action_str.to_string(),
            remaining_seconds: remaining.as_secs(),
            total_seconds: total.as_secs(),
        }
    }
}

/// Reset auto action config after execution or cancel (one-time use)
fn reset_auto_action_config() {
    let mut config = load_config();
    config.auto_action.enabled = false;
    config.auto_action.action_type = AutoActionType::None;
    if let Err(e) = save_config(&config) {
        tracing::error!("Failed to reset auto action config: {}", e);
    }
}

/// Execute system sleep or shutdown
fn execute_system_action(action_type: &AutoActionType) -> Result<(), String> {
    match action_type {
        AutoActionType::Sleep => {
            #[cfg(target_os = "macos")]
            {
                // pmset sleepnow - works without sudo for sleep
                std::process::Command::new("pmset")
                    .arg("sleepnow")
                    .spawn()
                    .map_err(|e| format!("Failed to sleep: {}", e))?;
            }

            #[cfg(target_os = "windows")]
            {
                // Use powershell for reliable sleep on Windows
                // rundll32 method is unreliable with hybrid sleep enabled
                std::process::Command::new("powershell")
                    .args([
                        "-Command",
                        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)",
                    ])
                    .spawn()
                    .map_err(|e| format!("Failed to sleep: {}", e))?;
            }

            #[cfg(target_os = "linux")]
            {
                std::process::Command::new("systemctl")
                    .arg("suspend")
                    .spawn()
                    .map_err(|e| format!("Failed to sleep: {}", e))?;
            }
        }
        AutoActionType::Shutdown => {
            #[cfg(target_os = "macos")]
            {
                // Use Finder's shut down which shows proper dialog
                // Alternative: osascript -e 'tell app "loginwindow" to «event aevtrsdn»'
                std::process::Command::new("osascript")
                    .args(["-e", "tell application \"Finder\" to shut down"])
                    .spawn()
                    .map_err(|e| format!("Failed to shutdown: {}", e))?;
            }

            #[cfg(target_os = "windows")]
            {
                // shutdown /s /t 60 gives user 60 seconds to cancel
                // User can cancel with: shutdown /a
                std::process::Command::new("shutdown")
                    .args(["/s", "/t", "60", "/c", "Alice: Auto shutdown in 60 seconds. Run 'shutdown /a' to cancel."])
                    .spawn()
                    .map_err(|e| format!("Failed to shutdown: {}", e))?;
            }

            #[cfg(target_os = "linux")]
            {
                std::process::Command::new("systemctl")
                    .arg("poweroff")
                    .spawn()
                    .map_err(|e| format!("Failed to shutdown: {}", e))?;
            }
        }
        AutoActionType::None => {}
    }

    Ok(())
}

/// Global auto action manager instance
static AUTO_ACTION_MANAGER: once_cell::sync::OnceCell<tokio::sync::Mutex<Option<AutoActionManager>>> =
    once_cell::sync::OnceCell::new();

/// Initialize the auto action manager
pub fn init_auto_action(app: &AppHandle) {
    let manager = AutoActionManager::new(app.clone());
    let _ = AUTO_ACTION_MANAGER.set(tokio::sync::Mutex::new(Some(manager)));
}

/// Get the auto action manager
pub async fn get_manager() -> Option<tokio::sync::MutexGuard<'static, Option<AutoActionManager>>> {
    AUTO_ACTION_MANAGER.get().map(|m| m.try_lock().ok()).flatten()
}

/// Start auto action timer (called when queue completes)
pub async fn start_auto_action_timer(app: &AppHandle) -> Result<(), String> {
    let config = load_config();

    if !config.auto_action.enabled || config.auto_action.action_type == AutoActionType::None {
        return Ok(());
    }

    let manager = AutoActionManager::new(app.clone());
    manager.start_timer().await
}

/// Cancel auto action timer
pub async fn cancel_auto_action_timer() -> Result<(), String> {
    if let Some(guard) = get_manager().await {
        if let Some(manager) = guard.as_ref() {
            manager.cancel_timer();
        }
    }
    Ok(())
}

/// Get auto action state
pub async fn get_auto_action_state(_app: &AppHandle) -> AutoActionState {
    if let Some(guard) = get_manager().await {
        if let Some(manager) = guard.as_ref() {
            return manager.get_state().await;
        }
    }

    // Return default state if manager not initialized
    let config = load_config();
    let action_str = match &config.auto_action.action_type {
        AutoActionType::Sleep => "sleep",
        AutoActionType::Shutdown => "shutdown",
        AutoActionType::None => "none",
    };

    AutoActionState {
        timer_active: false,
        action_type: action_str.to_string(),
        remaining_seconds: 0,
        total_seconds: 0,
    }
}
