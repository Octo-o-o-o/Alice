// Tray icon management for Alice

#![allow(dead_code)]

use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{AppHandle, Emitter};

/// Tray icon states
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TrayState {
    Idle = 0,
    Active = 1,
    Success = 2,
    Warning = 3,
    Error = 4,
}

impl TrayState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Active => "active",
            Self::Success => "success",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }

    pub fn tooltip(self) -> &'static str {
        match self {
            Self::Idle => "Alice - No active sessions",
            Self::Active => "Alice - Session in progress",
            Self::Success => "Alice - Task completed",
            Self::Warning => "Alice - Waiting for input",
            Self::Error => "Alice - Error occurred",
        }
    }

    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Active,
            2 => Self::Success,
            3 => Self::Warning,
            4 => Self::Error,
            _ => Self::Idle,
        }
    }
}

static CURRENT_STATE: AtomicU8 = AtomicU8::new(0);

/// Event emitted when tray state changes
#[derive(Clone, serde::Serialize)]
pub struct TrayStateEvent {
    pub state: String,
    pub tooltip: String,
}

/// Update the tray icon state
pub fn set_tray_state(app: &AppHandle, state: TrayState) {
    let prev = get_tray_state();
    if prev == state {
        return;
    }

    CURRENT_STATE.store(state as u8, Ordering::SeqCst);

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(state.tooltip()));
    }

    let _ = app.emit(
        "tray-state-changed",
        TrayStateEvent {
            state: state.as_str().to_string(),
            tooltip: state.tooltip().to_string(),
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
