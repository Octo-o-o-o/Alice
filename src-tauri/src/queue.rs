// Task Queue Engine - Execute tasks via provider CLI subprocesses

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

// ============================================================================
// Helpers
// ============================================================================

/// Extract the project display name from a task, falling back to "Unknown".
fn task_project_name(task: &Task) -> String {
    task.project_path
        .as_ref()
        .map(|p| crate::platform::path_file_name(p))
        .unwrap_or("Unknown")
        .to_string()
}

/// Yield the `(ENV_VAR_NAME, value)` pairs that should be set for this environment.
/// Skips entries whose value is empty or absent.
fn env_entries(env: &crate::config::ClaudeEnvironment) -> Vec<(&'static str, &str)> {
    let candidates: [(&str, Option<&str>); 3] = [
        ("CLAUDE_CONFIG_DIR", Some(&env.config_dir)),
        ("ANTHROPIC_API_KEY", env.api_key.as_deref()),
        ("ANTHROPIC_MODEL", env.model.as_deref()),
    ];

    candidates
        .into_iter()
        .filter_map(|(name, value)| {
            let v = value.filter(|s| !s.is_empty())?;
            Some((name, v))
        })
        .collect()
}

/// Apply environment config variables to a `tokio::process::Command`.
fn apply_env_config(cmd: &mut Command, env: &crate::config::ClaudeEnvironment) {
    for (name, value) in env_entries(env) {
        cmd.env(name, value);
    }
}

/// Build a shell-compatible env prefix string for terminal execution.
fn build_env_prefix(env: &crate::config::ClaudeEnvironment) -> String {
    env_entries(env)
        .into_iter()
        .map(|(name, value)| format!("{}='{}' ", name, value))
        .collect()
}

// ============================================================================
// QueueExecutor
// ============================================================================

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

        // Start auto-action timer if all tasks have been processed
        let remaining = database::get_tasks(&self.app, Some(TaskStatus::Queued), None)
            .map(|t| t.len())
            .unwrap_or(0);

        if remaining == 0 {
            if let Err(e) = crate::auto_action::start_auto_action_timer(&self.app).await {
                tracing::debug!("Auto action timer not started: {}", e);
            }
        }

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
    #[allow(dead_code)]
    pub async fn current_task_id(&self) -> Option<String> {
        self.current_task.lock().await.clone()
    }

    /// Find the next task whose dependencies are satisfied.
    /// Tasks with failed/skipped dependencies are automatically marked as skipped.
    fn find_next_executable_task(&self, tasks: &[Task]) -> Option<Task> {
        let all_tasks = database::get_tasks(&self.app, None, None).ok()?;

        for task in tasks {
            let depends_on_id = match task.depends_on {
                Some(ref id) => id,
                None => return Some(task.clone()),
            };

            let dependency = all_tasks.iter().find(|t| &t.id == depends_on_id);

            match dependency {
                None => {
                    // Dependency deleted -- treat as satisfied
                    tracing::warn!(
                        "Dependency {} for task {} not found, proceeding anyway",
                        depends_on_id, task.id
                    );
                    return Some(task.clone());
                }
                Some(dep) if dep.status == TaskStatus::Completed => {
                    return Some(task.clone());
                }
                Some(dep) if dep.status == TaskStatus::Failed || dep.status == TaskStatus::Skipped => {
                    tracing::warn!(
                        "Skipping task {} because dependency {} has status {:?}",
                        task.id, depends_on_id, dep.status
                    );
                    let _ = database::update_task(
                        &self.app, &task.id, Some(TaskStatus::Skipped), None, None, None,
                    );
                }
                // Dependency still pending/running -- skip to next candidate
                _ => {}
            }
        }

        None
    }

    /// Emit queue status to frontend
    async fn emit_status(&self) {
        let queued_count = database::get_tasks(&self.app, Some(TaskStatus::Queued), None)
            .map(|t| t.len())
            .unwrap_or(0);

        let event = QueueStatusEvent {
            is_running: self.running.load(Ordering::SeqCst),
            current_task_id: self.current_task.lock().await.clone(),
            queued_count,
        };

        let _ = self.app.emit("queue-status", &event);
    }

    /// Run the queue loop
    async fn run_queue(&self) {
        while self.running.load(Ordering::SeqCst) {
            let tasks = match database::get_tasks(&self.app, Some(TaskStatus::Queued), None) {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!("Failed to get queued tasks: {}", e);
                    break;
                }
            };

            let task = match self.find_next_executable_task(&tasks) {
                Some(t) => t,
                None => {
                    if tasks.is_empty() {
                        tracing::info!("Queue empty, stopping executor");
                    } else {
                        tracing::info!("All queued tasks have unmet dependencies, stopping executor");
                    }
                    break;
                }
            };

            let project_name = task_project_name(&task);

            match self.execute_task(&task).await {
                Ok(result) => {
                    tracing::info!("Task {} completed with exit code {}", task.id, result.exit_code);
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
                    let _ = notification::notify_task_error(&self.app, &project_name, &e);
                    break;
                }
            }

            self.emit_status().await;
        }
    }

    /// Mark a task as finished (completed/failed) and clear the current-task slot.
    async fn finalize_task(&self, task_id: &str, status: TaskStatus) -> Result<(), String> {
        database::update_task(&self.app, task_id, Some(status), None, None, None)
            .map_err(|e| e.to_string())?;
        *self.current_task.lock().await = None;
        Ok(())
    }

    /// Execute a single task
    async fn execute_task(&self, task: &Task) -> Result<TaskResult, String> {
        *self.current_task.lock().await = Some(task.id.clone());
        database::update_task(&self.app, &task.id, Some(TaskStatus::Running), None, None, None)
            .map_err(|e| e.to_string())?;
        self.emit_status().await;

        let project_name = task_project_name(task);
        let _ = notification::notify_queue_started(&self.app, &project_name, &task.prompt);

        let start_time = std::time::Instant::now();

        // Validate provider CLI is installed
        let provider = crate::providers::get_provider(task.provider);
        if !provider.is_installed() {
            let error_msg = format!(
                "Provider {} CLI not installed. Please install '{}' first.",
                task.provider,
                provider.get_cli_command()
            );
            self.finalize_task(&task.id, TaskStatus::Failed).await?;
            return Err(error_msg);
        }

        tracing::info!("Executing task {} with provider {}", task.id, task.provider);

        let config = crate::config::load_config();
        let env_config = crate::config::get_active_environment();
        let cli_command = provider.get_cli_command();
        let cmd_name = env_config.command.as_deref().unwrap_or(&cli_command);
        let max_turns = task.max_turns.unwrap_or(50);
        let args = build_provider_args(task, max_turns);
        let working_dir = task.project_path.as_deref();

        if config.terminal_app != crate::config::TerminalApp::Background {
            return self
                .execute_in_terminal(task, cmd_name, &args, &env_config, &config, working_dir, start_time)
                .await;
        }

        self.execute_in_background(task, cmd_name, &args, &env_config, &cli_command, working_dir, start_time)
            .await
    }

    /// Execute a task in a visible terminal window.
    async fn execute_in_terminal(
        &self,
        task: &Task,
        cmd_name: &str,
        args: &[String],
        env_config: &crate::config::ClaudeEnvironment,
        config: &crate::config::AppConfig,
        working_dir: Option<&str>,
        start_time: std::time::Instant,
    ) -> Result<TaskResult, String> {
        let args_str: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let env_prefix = build_env_prefix(env_config);

        // Wrap in a shell command when env vars are needed and no custom command is set
        let (final_cmd, final_args) = if !env_prefix.is_empty() && env_config.command.is_none() {
            let full_cmd = format!("{}{} {}", env_prefix, cmd_name, args_str.join(" "));
            ("sh".to_string(), vec!["-c".to_string(), full_cmd])
        } else {
            (cmd_name.to_string(), args.to_vec())
        };

        let final_args_str: Vec<&str> = final_args.iter().map(|s| s.as_str()).collect();
        crate::platform::execute_in_terminal(
            &config.terminal_app,
            &config.custom_terminal_command,
            working_dir,
            &final_cmd,
            &final_args_str,
        )?;

        // Wait briefly to let the terminal open
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        let duration_secs = start_time.elapsed().as_secs();
        self.finalize_task(&task.id, TaskStatus::Completed).await?;

        Ok(TaskResult {
            task_id: task.id.clone(),
            exit_code: 0,
            output: "Task opened in terminal window".to_string(),
            tokens_used: 0,
            cost_usd: 0.0,
            duration_secs,
        })
    }

    /// Execute a task as a background subprocess, streaming output to the frontend.
    async fn execute_in_background(
        &self,
        task: &Task,
        cmd_name: &str,
        args: &[String],
        env_config: &crate::config::ClaudeEnvironment,
        cli_command: &str,
        working_dir: Option<&str>,
        start_time: std::time::Instant,
    ) -> Result<TaskResult, String> {
        let mut cmd = Command::new(cmd_name);
        cmd.args(args);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        apply_env_config(&mut cmd, env_config);

        if let Some(dir) = working_dir {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn {}: {}", cli_command, e))?;

        // Stream stdout to the frontend
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let mut reader = BufReader::new(stdout).lines();
        let mut output = String::new();

        while let Ok(Some(line)) = reader.next_line().await {
            output.push_str(&line);
            output.push('\n');

            let _ = self.app.emit("task-output", serde_json::json!({
                "task_id": task.id,
                "line": line,
            }));
        }

        let status = child.wait().await.map_err(|e| format!("Process error: {}", e))?;
        let exit_code = status.code().unwrap_or(-1);
        let duration_secs = start_time.elapsed().as_secs();
        let (tokens_used, cost_usd) = parse_output_stats(&output);

        let task_status = if exit_code == 0 {
            TaskStatus::Completed
        } else {
            TaskStatus::Failed
        };
        self.finalize_task(&task.id, task_status).await?;

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

// ============================================================================
// Provider argument builders
// ============================================================================

/// Push `--flag value` onto `args` when `value` is `Some`.
fn push_optional(args: &mut Vec<String>, flag: &str, value: Option<&str>) {
    if let Some(v) = value {
        args.push(flag.to_string());
        args.push(v.to_string());
    }
}

/// Build CLI arguments based on provider type.
fn build_provider_args(task: &Task, max_turns: i32) -> Vec<String> {
    use crate::providers::ProviderId;

    let system_prompt = task.system_prompt.as_deref();

    match task.provider {
        ProviderId::Claude => {
            let mut args = vec![
                "-p".to_string(),
                task.prompt.clone(),
                "--output-format".to_string(),
                "json".to_string(),
                "--max-turns".to_string(),
                max_turns.to_string(),
            ];
            push_optional(&mut args, "--system-prompt", system_prompt);

            if let Some(ref allowed_tools) = task.allowed_tools {
                if let Ok(tools) = serde_json::from_str::<Vec<String>>(allowed_tools) {
                    for tool in tools {
                        args.push("--allowedTools".to_string());
                        args.push(tool);
                    }
                }
            }
            args
        }
        ProviderId::Codex => {
            let mut args = vec![task.prompt.clone(), "--json".to_string()];
            if max_turns > 0 {
                args.push("--max-turns".to_string());
                args.push(max_turns.to_string());
            }
            push_optional(&mut args, "--system", system_prompt);
            args
        }
        ProviderId::Gemini => {
            let mut args = vec![
                task.prompt.clone(),
                "--format".to_string(),
                "json".to_string(),
            ];
            if max_turns > 0 {
                args.push("--max-iterations".to_string());
                args.push(max_turns.to_string());
            }
            push_optional(&mut args, "--system-instruction", system_prompt);
            args
        }
    }
}

/// Parse JSON output for token usage stats.
/// Returns `(total_tokens, estimated_cost_usd)`.
fn parse_output_stats(output: &str) -> (i64, f64) {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(output) else {
        return (0, 0.0);
    };
    let Some(usage) = json.get("usage") else {
        return (0, 0.0);
    };

    let input = usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
    let output_tokens = usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
    let total = input + output_tokens;

    // Estimate cost (simplified, using Sonnet pricing)
    let cost = (input as f64 * 3.0 / 1_000_000.0) + (output_tokens as f64 * 15.0 / 1_000_000.0);

    (total, cost)
}

// ============================================================================
// Global queue management
// ============================================================================

static QUEUE_EXECUTOR: once_cell::sync::OnceCell<tokio::sync::Mutex<Option<QueueExecutor>>> =
    once_cell::sync::OnceCell::new();

/// Initialize the queue executor
pub fn init_queue(app: &AppHandle) {
    let executor = QueueExecutor::new(app.clone());
    let _ = QUEUE_EXECUTOR.set(tokio::sync::Mutex::new(Some(executor)));
}

/// Try to acquire the global queue executor, returning a reference if available.
async fn with_executor<T>(f: impl FnOnce(&QueueExecutor) -> T) -> Option<T> {
    let guard = QUEUE_EXECUTOR.get()?.try_lock().ok()?;
    guard.as_ref().map(f)
}

/// Start queue execution
pub async fn start_queue(app: &AppHandle) -> Result<(), String> {
    let executor = QueueExecutor::new(app.clone());
    executor.start().await
}

/// Stop queue execution
pub async fn stop_queue() -> Result<(), String> {
    with_executor(|e| e.stop()).await;
    Ok(())
}

/// Check if queue is running
pub async fn is_queue_running() -> bool {
    with_executor(|e| e.is_running()).await.unwrap_or(false)
}
