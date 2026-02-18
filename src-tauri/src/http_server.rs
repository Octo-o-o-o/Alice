// HTTP Notification Server
//
// Listens on 127.0.0.1:<port> and accepts POST /notify requests from
// provider hook scripts (Claude Code PreToolUse, Gemini BeforeTool, etc.).
// Inspired by Notifier (https://github.com/XueshiQiao/Notifier).

use axum::{extract::State, http::StatusCode, routing, Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Payload accepted by POST /notify
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NotifyPayload {
    pub title: String,
    pub body: String,
    pub provider: Option<String>,
    pub event_type: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct NotifyResponse {
    success: bool,
    message: String,
}

impl NotifyResponse {
    fn ok(message: &str) -> Self {
        Self { success: true, message: message.to_owned() }
    }

    fn err(message: String) -> Self {
        Self { success: false, message }
    }
}

#[derive(Debug, Serialize)]
struct StatusResponse {
    status: &'static str,
    version: &'static str,
}

/// Start the HTTP notification server.
/// Binds to 127.0.0.1:<port> and writes the port to ~/.alice/http_port for
/// external scripts to discover.
pub async fn start_http_server(app: AppHandle, port: u16) {
    write_port_file(port);

    let router = Router::new()
        .route("/notify", routing::post(handle_notify))
        .route("/status", routing::get(handle_status))
        .with_state(app);

    let addr = format!("127.0.0.1:{}", port);
    tracing::info!("Starting HTTP notification server on {}", addr);

    match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => {
            if let Err(e) = axum::serve(listener, router).await {
                tracing::error!("HTTP notification server error: {}", e);
            }
        }
        Err(e) => {
            tracing::error!("Failed to bind HTTP notification server on {}: {}", addr, e);
        }
    }
}

/// Write the port number to ~/.alice/http_port so external scripts can discover it.
fn write_port_file(port: u16) {
    let alice_dir = crate::platform::get_alice_dir();
    let _ = std::fs::create_dir_all(&alice_dir);
    let _ = std::fs::write(alice_dir.join("http_port"), port.to_string());
}

async fn handle_status() -> Json<StatusResponse> {
    Json(StatusResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn handle_notify(
    State(app): State<AppHandle>,
    Json(payload): Json<NotifyPayload>,
) -> (StatusCode, Json<NotifyResponse>) {
    if payload.title.trim().is_empty() || payload.body.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(NotifyResponse::err("title and body must not be empty".to_owned())),
        );
    }

    let _ = app.emit("hook-notification", &payload);

    match crate::notification::send_hook_notification(&app, &payload.title, &payload.body) {
        Ok(()) => (StatusCode::OK, Json(NotifyResponse::ok("Notification sent"))),
        Err(e) => {
            tracing::error!("Failed to send hook notification: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(NotifyResponse::err(e)))
        }
    }
}
