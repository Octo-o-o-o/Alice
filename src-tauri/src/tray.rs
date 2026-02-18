use crate::session::SessionStatus;
use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum TrayState {
    Idle = 0,
    Active = 1,
    Success = 2,
    Warning = 3,
    Error = 4,
}

impl TrayState {
    pub fn tooltip(self) -> &'static str {
        match self {
            Self::Idle => "Alice - No active sessions",
            Self::Active => "Alice - Session in progress",
            Self::Success => "Alice - Task completed",
            Self::Warning => "Alice - Waiting for input",
            Self::Error => "Alice - Error occurred",
        }
    }
}

impl From<u8> for TrayState {
    fn from(v: u8) -> Self {
        match v {
            1 => Self::Active,
            2 => Self::Success,
            3 => Self::Warning,
            4 => Self::Error,
            _ => Self::Idle,
        }
    }
}

impl From<SessionStatus> for TrayState {
    fn from(status: SessionStatus) -> Self {
        match status {
            SessionStatus::Active => Self::Active,
            SessionStatus::NeedsInput => Self::Warning,
            SessionStatus::Error => Self::Error,
            SessionStatus::Completed => Self::Success,
            SessionStatus::Idle => Self::Idle,
        }
    }
}

static CURRENT_STATE: AtomicU8 = AtomicU8::new(0);

#[derive(Clone, serde::Serialize)]
struct TrayStateEvent {
    state: TrayState,
    tooltip: &'static str,
}

/// Update the tray icon state and emit a change event to the frontend.
pub fn set_tray_state(app: &AppHandle, state: TrayState) {
    let prev = current_state();
    if prev == state {
        return;
    }

    CURRENT_STATE.store(state as u8, Ordering::SeqCst);

    let tooltip = state.tooltip();

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
    }

    let _ = app.emit("tray-state-changed", TrayStateEvent { state, tooltip });

    tracing::debug!("Tray state changed: {:?} -> {:?}", prev, state);
}

/// Reset tray state to idle after a delay.
pub fn reset_tray_state_delayed(app: AppHandle, delay_ms: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        set_tray_state(&app, TrayState::Idle);
    });
}

fn current_state() -> TrayState {
    TrayState::from(CURRENT_STATE.load(Ordering::SeqCst))
}
