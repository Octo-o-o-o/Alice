// Task Queue Engine - Execute tasks via Claude CLI subprocess

use crate::database::{self, Task, TaskStatus};
use crate::notification;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

/// Queue executor state
pub struct QueueExecutor {
    app: AppHandle,
    running: Arc<AtomicBool>,
    current_task: Arc<Mutex<Option<String>>>,
}

/// Task execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub task_id: String,
    pub exit_code: i32,
    pub output: String,
    pub tokens_used: i64,
    pub cost_usd: f64,
    pub duration_secs: u64,
}

/// Queue status event for frontend
#[derive(Debug, Clone, Serialize)]
pub struct QueueStatusEvent {
    pub is_running: bool,
    pub current_task_id: Option<String>,
    pub queued_count: usize,
}

impl QueueExecutor {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            running: Arc::new(AtomicBool::new(false)),
            current_task: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the queue executor
    pub async fn start(&self) -> Result<(), String> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err("Queue already running".to_string());
        }

        self.emit_status().await;
        self.run_queue().await;

        self.running.store(false, Ordering::SeqCst);
        self.emit_status().await;

        Ok(())
    }

    /// Stop the queue executor
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    /// Check if queue is running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Get current task ID
    pub async fn current_task_id(&self) -> Option<String> {
        self.current_task.lock().await.clone()
    }

    /// Emit queue status to frontend
    async fn emit_status(&self) {
        let queued = database::get_tasks(&self.app, Some(TaskStatus::Queued), None)
            .map(|tasks| tasks.len())
            .unwrap_or(0);

        let event = QueueStatusEvent {
            is_running: self.running.load(Ordering::SeqCst),
            current_task_id: self.current_task.lock().await.clone(),
            queued_count: queued,
        };

        let _ = self.app.emit("queue-status", &event);
    }

    /// Run the queue loop
    async fn run_queue(&self) {
        while self.running.load(Ordering::SeqCst) {
            // Get next queued task
            let tasks = match database::get_tasks(&self.app, Some(TaskStatus::Queued), None) {
                Ok(tasks) => tasks,
                Err(e) => {
                    tracing::error!("Failed to get queued tasks: {}", e);
                    break;
                }
            };

            let task = match tasks.into_iter().next() {
                Some(t) => t,
                None => {
                    // No more tasks, stop queue
                    tracing::info!("Queue empty, stopping executor");
                    break;
                }
            };

            // Execute the task
            match self.execute_task(&task).await {
                Ok(result) => {
                    tracing::info!("Task {} completed with exit code {}", task.id, result.exit_code);

                    // Notify completion
                    let project_name = task.project_path
                        .as_ref()
                        .and_then(|p| p.split('/').last())
                        .unwrap_or("Unknown")
                        .to_string();

                    let _ = notification::notify_task_completed(
                        &self.app,
                        &project_name,
                        &task.prompt,
                        result.cost_usd,
                        result.duration_secs,
                    );
                }
                Err(e) => {
                    tracing::error!("Task {} failed: {}", task.id, e);

                    // Notify error
                    let project_name = task.project_path
                        .as_ref()
                        .and_then(|p| p.split('/').last())
                        .unwrap_or("Unknown")
                        .to_string();

                    let _ = notification::notify_task_error(&self.app, &project_name, &e);

                    // Stop queue on failure (user can resume)
                    break;
                }
            }

            self.emit_status().await;
        }
    }

    /// Execute a single task
    async fn execute_task(&self, task: &Task) -> Result<TaskResult, String> {
        // Update task status to running
        *self.current_task.lock().await = Some(task.id.clone());
        database::update_task(&self.app, &task.id, Some(TaskStatus::Running), None, None, None)
            .map_err(|e| e.to_string())?;

        self.emit_status().await;

        // Emit queue started notification
        let project_name = task.project_path
            .as_ref()
            .and_then(|p| p.split('/').last())
            .unwrap_or("Unknown")
            .to_string();
        let _ = notification::notify_queue_started(&self.app, &project_name, &task.prompt);

        let start_time = std::time::Instant::now();

        // Build command
        let mut cmd = Command::new("claude");
        cmd.arg("-p")
            .arg(&task.prompt)
            .arg("--output-format")
            .arg("json")
            .arg("--max-turns")
            .arg("50");

        // Set working directory if project path is specified
        if let Some(ref project_path) = task.project_path {
            cmd.current_dir(project_path);
        }

        // Capture output
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Spawn process
        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn claude: {}", e))?;

        // Read stdout
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let mut reader = BufReader::new(stdout).lines();
        let mut output = String::new();

        while let Ok(Some(line)) = reader.next_line().await {
            output.push_str(&line);
            output.push('\n');

            // Emit progress to frontend
            let _ = self.app.emit("task-output", serde_json::json!({
                "task_id": task.id,
                "line": line,
            }));
        }

        // Wait for process
        let status = child.wait().await.map_err(|e| format!("Process error: {}", e))?;
        let exit_code = status.code().unwrap_or(-1);
        let duration_secs = start_time.elapsed().as_secs();

        // Parse output for token usage (if JSON output)
        let (tokens_used, cost_usd) = parse_output_stats(&output);

        // Update task status
        let new_status = if exit_code == 0 {
            TaskStatus::Completed
        } else {
            TaskStatus::Failed
        };

        database::update_task(&self.app, &task.id, Some(new_status), None, None, None)
            .map_err(|e| e.to_string())?;

        *self.current_task.lock().await = None;

        Ok(TaskResult {
            task_id: task.id.clone(),
            exit_code,
            output,
            tokens_used,
            cost_usd,
            duration_secs,
        })
    }
}

/// Parse output for token usage stats
fn parse_output_stats(output: &str) -> (i64, f64) {
    // Try to parse JSON output from claude CLI
    // Format: {"result": ..., "usage": {"input_tokens": N, "output_tokens": M}}
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(output) {
        if let Some(usage) = json.get("usage") {
            let input = usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
            let output = usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
            let total = input + output;

            // Estimate cost (simplified, using Sonnet pricing)
            let cost = (input as f64 * 3.0 / 1_000_000.0) + (output as f64 * 15.0 / 1_000_000.0);

            return (total, cost);
        }
    }

    (0, 0.0)
}

/// Global queue executor instance
static QUEUE_EXECUTOR: once_cell::sync::OnceCell<tokio::sync::Mutex<Option<QueueExecutor>>> =
    once_cell::sync::OnceCell::new();

/// Initialize the queue executor
pub fn init_queue(app: &AppHandle) {
    let executor = QueueExecutor::new(app.clone());
    let _ = QUEUE_EXECUTOR.set(tokio::sync::Mutex::new(Some(executor)));
}

/// Get the queue executor
pub async fn get_executor() -> Option<tokio::sync::MutexGuard<'static, Option<QueueExecutor>>> {
    QUEUE_EXECUTOR.get().map(|m| m.try_lock().ok()).flatten()
}

/// Start queue execution
pub async fn start_queue(app: &AppHandle) -> Result<(), String> {
    let executor = QueueExecutor::new(app.clone());
    executor.start().await
}

/// Stop queue execution
pub async fn stop_queue() -> Result<(), String> {
    if let Some(guard) = get_executor().await {
        if let Some(executor) = guard.as_ref() {
            executor.stop();
        }
    }
    Ok(())
}

/// Check if queue is running
pub async fn is_queue_running() -> bool {
    if let Some(guard) = get_executor().await {
        if let Some(executor) = guard.as_ref() {
            return executor.is_running();
        }
    }
    false
}
