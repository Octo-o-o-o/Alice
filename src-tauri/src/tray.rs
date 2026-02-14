// Tray icon management for Alice

use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{AppHandle, Emitter};

/// Tray icon states
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TrayState {
    Idle = 0,      // Gray - No active sessions
    Active = 1,    // Blue - Session in progress
    Success = 2,   // Green - Task completed successfully
    Warning = 3,   // Yellow - Waiting for user input
    Error = 4,     // Red - Error occurred
}

impl TrayState {
    pub fn as_str(&self) -> &'static str {
        match self {
            TrayState::Idle => "idle",
            TrayState::Active => "active",
            TrayState::Success => "success",
            TrayState::Warning => "warning",
            TrayState::Error => "error",
        }
    }

    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => TrayState::Active,
            2 => TrayState::Success,
            3 => TrayState::Warning,
            4 => TrayState::Error,
            _ => TrayState::Idle,
        }
    }
}

// Global state for tray icon
static CURRENT_STATE: AtomicU8 = AtomicU8::new(0);

/// Event emitted when tray state changes
#[derive(Clone, serde::Serialize)]
pub struct TrayStateEvent {
    pub state: String,
    pub tooltip: String,
}

/// Update the tray icon state
pub fn set_tray_state(app: &AppHandle, state: TrayState) {
    let prev = TrayState::from_u8(CURRENT_STATE.load(Ordering::SeqCst));

    if prev == state {
        return;
    }

    CURRENT_STATE.store(state as u8, Ordering::SeqCst);

    let tooltip = match state {
        TrayState::Idle => "Alice - No active sessions",
        TrayState::Active => "Alice - Session in progress",
        TrayState::Success => "Alice - Task completed",
        TrayState::Warning => "Alice - Waiting for input",
        TrayState::Error => "Alice - Error occurred",
    };

    // Update tray tooltip
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
    }

    // Emit event to frontend for UI sync
    let _ = app.emit(
        "tray-state-changed",
        TrayStateEvent {
            state: state.as_str().to_string(),
            tooltip: tooltip.to_string(),
        },
    );

    tracing::debug!("Tray state changed: {:?} -> {:?}", prev, state);
}

/// Get current tray state
pub fn get_tray_state() -> TrayState {
    TrayState::from_u8(CURRENT_STATE.load(Ordering::SeqCst))
}

/// Reset tray state to idle after a delay
pub fn reset_tray_state_delayed(app: AppHandle, delay_ms: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        set_tray_state(&app, TrayState::Idle);
    });
}
