// Task Queue Engine - Execute tasks via Claude CLI subprocess

#![allow(dead_code)]

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

        // Check if we should start auto action timer (all tasks completed)
        let remaining_tasks = database::get_tasks(&self.app, Some(TaskStatus::Queued), None)
            .map(|tasks| tasks.len())
            .unwrap_or(0);

        if remaining_tasks == 0 {
            // All tasks completed, start auto action timer if enabled
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
    pub async fn current_task_id(&self) -> Option<String> {
        self.current_task.lock().await.clone()
    }

    /// Find the next task that has all dependencies satisfied
    fn find_next_executable_task(&self, tasks: &[Task]) -> Option<Task> {
        // Get all tasks to check dependency status
        let all_tasks = database::get_tasks(&self.app, None, None).ok()?;

        for task in tasks {
            if let Some(ref depends_on_id) = task.depends_on {
                // Find the dependency task
                let dependency = all_tasks.iter().find(|t| &t.id == depends_on_id);

                match dependency {
                    Some(dep) => {
                        // Check if dependency is completed
                        if dep.status == TaskStatus::Completed {
                            // Dependency is satisfied, this task can run
                            return Some(task.clone());
                        } else if dep.status == TaskStatus::Failed || dep.status == TaskStatus::Skipped {
                            // Dependency failed, skip this task
                            tracing::warn!(
                                "Skipping task {} because dependency {} has status {:?}",
                                task.id, depends_on_id, dep.status
                            );
                            let _ = database::update_task(
                                &self.app,
                                &task.id,
                                Some(TaskStatus::Skipped),
                                None,
                                None,
                                None,
                            );
                            continue;
                        }
                        // Dependency not yet completed, skip to next task
                        continue;
                    }
                    None => {
                        // Dependency task not found, treat as satisfied (may have been deleted)
                        tracing::warn!(
                            "Dependency {} for task {} not found, proceeding anyway",
                            depends_on_id, task.id
                        );
                        return Some(task.clone());
                    }
                }
            } else {
                // No dependency, this task can run
                return Some(task.clone());
            }
        }

        None
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

            // Find the next task that has all dependencies satisfied
            let task = self.find_next_executable_task(&tasks);

            let task = match task {
                Some(t) => t,
                None => {
                    if tasks.is_empty() {
                        // No more tasks, stop queue
                        tracing::info!("Queue empty, stopping executor");
                    } else {
                        // Tasks exist but all have unmet dependencies
                        tracing::info!("All queued tasks have unmet dependencies, stopping executor");
                    }
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
                        .map(|p| crate::platform::path_file_name(p))
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
                        .map(|p| crate::platform::path_file_name(p))
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
            .map(|p| crate::platform::path_file_name(p))
            .unwrap_or("Unknown")
            .to_string();
        let _ = notification::notify_queue_started(&self.app, &project_name, &task.prompt);

        let start_time = std::time::Instant::now();

        // Load config to check terminal preference
        let config = crate::config::load_config();

        // Build command arguments
        let claude_cmd = crate::platform::get_claude_command();
        let max_turns = task.max_turns.unwrap_or(50);

        let mut args: Vec<String> = vec![
            "-p".to_string(),
            task.prompt.clone(),
            "--output-format".to_string(),
            "json".to_string(),
            "--max-turns".to_string(),
            max_turns.to_string(),
        ];

        // Add system prompt if specified
        if let Some(ref system_prompt) = task.system_prompt {
            args.push("--system-prompt".to_string());
            args.push(system_prompt.clone());
        }

        // Add allowed tools if specified
        if let Some(ref allowed_tools) = task.allowed_tools {
            if let Ok(tools) = serde_json::from_str::<Vec<String>>(allowed_tools) {
                for tool in tools {
                    args.push("--allowedTools".to_string());
                    args.push(tool);
                }
            }
        }

        let working_dir = task.project_path.as_deref();

        // Get active environment for custom settings
        let env_config = crate::config::get_active_environment();

        // Check if we should use a visible terminal
        if config.terminal_app != crate::config::TerminalApp::Background {
            // Build command with environment variables for terminal execution
            let cmd_name = env_config.command.as_deref().unwrap_or(claude_cmd);
            let args_str: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

            // Build env prefix for shell execution
            let mut env_prefix = String::new();
            if !env_config.config_dir.is_empty() {
                env_prefix.push_str(&format!("CLAUDE_CONFIG_DIR='{}' ", env_config.config_dir));
            }
            if let Some(ref api_key) = env_config.api_key {
                if !api_key.is_empty() {
                    env_prefix.push_str(&format!("ANTHROPIC_API_KEY='{}' ", api_key));
                }
            }
            if let Some(ref model) = env_config.model {
                if !model.is_empty() {
                    env_prefix.push_str(&format!("ANTHROPIC_MODEL='{}' ", model));
                }
            }

            // If we have env vars and using default command, prepend them
            let (final_cmd, final_args) = if !env_prefix.is_empty() && env_config.command.is_none() {
                // For shell execution with env vars, we need to use shell wrapper
                let full_cmd = format!("{}{} {}", env_prefix, cmd_name, args_str.join(" "));
                ("sh".to_string(), vec!["-c".to_string(), full_cmd])
            } else {
                (cmd_name.to_string(), args.clone())
            };

            let final_args_str: Vec<&str> = final_args.iter().map(|s| s.as_str()).collect();
            crate::platform::execute_in_terminal(
                &config.terminal_app,
                &config.custom_terminal_command,
                working_dir,
                &final_cmd,
                &final_args_str,
            )?;

            // For terminal execution, we can't track the output directly
            // Mark task as completed immediately (user can see result in terminal)
            // Note: In the future, we could use a wrapper script to capture results

            // Wait a moment to let terminal open
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

            let duration_secs = start_time.elapsed().as_secs();

            // Mark as completed (we assume success since we can't track terminal output)
            database::update_task(&self.app, &task.id, Some(TaskStatus::Completed), None, None, None)
                .map_err(|e| e.to_string())?;

            *self.current_task.lock().await = None;

            return Ok(TaskResult {
                task_id: task.id.clone(),
                exit_code: 0,
                output: "Task opened in terminal window".to_string(),
                tokens_used: 0,
                cost_usd: 0.0,
                duration_secs,
            });
        }

        // Background execution (original behavior)
        // Use custom command if specified, otherwise use platform default
        let cmd_name = env_config.command.as_deref().unwrap_or(claude_cmd);
        let mut cmd = Command::new(cmd_name);

        for arg in &args {
            cmd.arg(arg);
        }

        // Set environment variables based on environment config
        if !env_config.config_dir.is_empty() {
            cmd.env("CLAUDE_CONFIG_DIR", &env_config.config_dir);
        }
        if let Some(ref api_key) = env_config.api_key {
            if !api_key.is_empty() {
                cmd.env("ANTHROPIC_API_KEY", api_key);
            }
        }
        if let Some(ref model) = env_config.model {
            if !model.is_empty() {
                cmd.env("ANTHROPIC_MODEL", model);
            }
        }

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
