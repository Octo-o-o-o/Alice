// Daily Report Generator

#![allow(dead_code)]

use crate::database::{self, TaskStatus};
use crate::session::Session;
use chrono::{Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

/// Daily report structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyReport {
    pub date: String,
    pub sessions: Vec<SessionSummary>,
    pub git_commits: Vec<GitCommit>,
    pub usage_summary: UsageSummary,
    pub pending_tasks: Vec<TaskSummary>,
    pub generated_at: i64,
    pub markdown: String,
    #[serde(default)]
    pub ai_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub project_name: String,
    pub prompt: String,
    pub status: String,
    pub tokens: i64,
    pub cost_usd: f64,
    pub duration_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    pub project_name: String,
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: String,
    pub is_cc_assisted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    pub total_sessions: i32,
    pub total_tokens: i64,
    pub total_cost_usd: f64,
    pub by_project: Vec<ProjectUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectUsage {
    pub project_name: String,
    pub sessions: i32,
    pub tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSummary {
    pub prompt: String,
    pub project_name: Option<String>,
    pub priority: String,
}

/// Generate daily report for a specific date
pub fn generate_report(app: &AppHandle, date: &str) -> Result<DailyReport, String> {
    let parsed_date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date format: {}", e))?;

    // Get sessions for the date
    let sessions = get_sessions_for_date(app, date)?;
    let session_summaries: Vec<SessionSummary> = sessions
        .iter()
        .map(|s| SessionSummary {
            project_name: s.project_name.clone(),
            prompt: s.first_prompt.clone().unwrap_or_default(),
            status: format!("{:?}", s.status).to_lowercase(),
            tokens: s.total_tokens,
            cost_usd: s.total_cost_usd,
            duration_minutes: (s.last_active_at - s.started_at) / 60_000,
        })
        .collect();

    // Get unique project paths for git commits
    let project_paths: Vec<String> = sessions
        .iter()
        .filter_map(|s| {
            if s.project_path.is_empty() {
                None
            } else {
                Some(s.project_path.clone())
            }
        })
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    // Get git commits for the date
    let git_commits = get_git_commits_for_date(&project_paths, &parsed_date);

    // Calculate usage summary
    let usage_summary = calculate_usage_summary(&sessions);

    // Get pending tasks
    let pending_tasks = get_pending_tasks(app)?;

    // Generate markdown
    let markdown = generate_markdown(
        date,
        &session_summaries,
        &git_commits,
        &usage_summary,
        &pending_tasks,
    );

    let report = DailyReport {
        date: date.to_string(),
        sessions: session_summaries,
        git_commits,
        usage_summary,
        pending_tasks,
        generated_at: Utc::now().timestamp_millis(),
        markdown,
        ai_summary: None,
    };

    // Save report to disk
    save_report(&report)?;

    Ok(report)
}

/// Get sessions for a specific date
fn get_sessions_for_date(app: &AppHandle, date: &str) -> Result<Vec<Session>, String> {
    database::get_sessions_by_date(app, date).map_err(|e| e.to_string())
}

/// Get git commits for a date from project directories
fn get_git_commits_for_date(project_paths: &[String], date: &NaiveDate) -> Vec<GitCommit> {
    let mut commits = Vec::new();
    let date_str = date.format("%Y-%m-%d").to_string();

    // Check if git is available on this platform
    let git_cmd = match crate::platform::get_git_command() {
        Some(cmd) => cmd,
        None => {
            tracing::warn!("Git not found on PATH, skipping commit collection");
            return commits;
        }
    };

    for project_path in project_paths {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            continue;
        }

        // Extract project name from path
        let project_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        // Run git log
        let output = Command::new(git_cmd)
            .current_dir(&path)
            .args([
                "log",
                &format!("--since={} 00:00:00", date_str),
                &format!("--until={} 23:59:59", date_str),
                "--format=%H|%s|%an|%ai",
            ])
            .output();

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split('|').collect();
                if parts.len() >= 4 {
                    let message = parts[1].to_string();
                    let is_cc_assisted = message.contains("Co-Authored-By: Claude")
                        || message.contains("🤖")
                        || message.to_lowercase().contains("claude");

                    commits.push(GitCommit {
                        project_name: project_name.clone(),
                        hash: parts[0][..7].to_string(), // Short hash
                        message,
                        author: parts[2].to_string(),
                        timestamp: parts[3].to_string(),
                        is_cc_assisted,
                    });
                }
            }
        }
    }

    commits
}

/// Calculate usage summary from sessions
fn calculate_usage_summary(sessions: &[Session]) -> UsageSummary {
    let mut by_project: HashMap<String, (i32, i64, f64)> = HashMap::new();

    for session in sessions {
        let entry = by_project
            .entry(session.project_name.clone())
            .or_insert((0, 0, 0.0));
        entry.0 += 1;
        entry.1 += session.total_tokens;
        entry.2 += session.total_cost_usd;
    }

    let project_usage: Vec<ProjectUsage> = by_project
        .into_iter()
        .map(|(name, (sessions, tokens, cost))| ProjectUsage {
            project_name: name,
            sessions,
            tokens,
            cost_usd: cost,
        })
        .collect();

    UsageSummary {
        total_sessions: sessions.len() as i32,
        total_tokens: sessions.iter().map(|s| s.total_tokens).sum(),
        total_cost_usd: sessions.iter().map(|s| s.total_cost_usd).sum(),
        by_project: project_usage,
    }
}

/// Get pending tasks
fn get_pending_tasks(app: &AppHandle) -> Result<Vec<TaskSummary>, String> {
    let backlog = database::get_tasks(app, Some(TaskStatus::Backlog), None)
        .map_err(|e| e.to_string())?;
    let queued = database::get_tasks(app, Some(TaskStatus::Queued), None)
        .map_err(|e| e.to_string())?;

    let tasks: Vec<TaskSummary> = backlog
        .into_iter()
        .chain(queued.into_iter())
        .map(|t| TaskSummary {
            prompt: t.prompt,
            project_name: t.project_path.and_then(|p| {
                PathBuf::from(&p)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string())
            }),
            priority: format!("{:?}", t.priority).to_lowercase(),
        })
        .collect();

    Ok(tasks)
}

/// Generate markdown report
fn generate_markdown(
    date: &str,
    sessions: &[SessionSummary],
    commits: &[GitCommit],
    usage: &UsageSummary,
    tasks: &[TaskSummary],
) -> String {
    let mut md = String::new();

    // Header
    md.push_str(&format!("# Daily Report — {}\n\n", date));

    // Sessions
    md.push_str(&format!("## Sessions ({})\n\n", sessions.len()));
    for s in sessions {
        let tokens_str = format_tokens(s.tokens);
        md.push_str(&format!(
            "- **{}**: \"{}\" — {}, {} tokens, ${:.2}\n",
            s.project_name,
            truncate(&s.prompt, 50),
            s.status,
            tokens_str,
            s.cost_usd
        ));
    }
    md.push('\n');

    // Git Commits
    let cc_commits: Vec<_> = commits.iter().filter(|c| c.is_cc_assisted).collect();
    if !cc_commits.is_empty() {
        md.push_str(&format!("## Git Commits (CC-assisted: {})\n\n", cc_commits.len()));
        for c in cc_commits {
            md.push_str(&format!(
                "- {}: `{}` — {}\n",
                c.project_name, c.hash, c.message
            ));
        }
        md.push('\n');
    }

    // Usage Summary
    md.push_str("## Usage Summary\n\n");
    md.push_str("| Project | Sessions | Tokens | Cost |\n");
    md.push_str("|---------|----------|--------|------|\n");
    for p in &usage.by_project {
        md.push_str(&format!(
            "| {} | {} | {} | ${:.2} |\n",
            p.project_name,
            p.sessions,
            format_tokens(p.tokens),
            p.cost_usd
        ));
    }
    md.push_str(&format!(
        "| **Total** | **{}** | **{}** | **${:.2}** |\n\n",
        usage.total_sessions,
        format_tokens(usage.total_tokens),
        usage.total_cost_usd
    ));

    // Pending Tasks
    if !tasks.is_empty() {
        md.push_str(&format!("## Queued Tasks ({} pending)\n\n", tasks.len()));
        for t in tasks.iter().take(5) {
            let project = t.project_name.as_deref().unwrap_or("No project");
            md.push_str(&format!("- \"{}\" ({})\n", truncate(&t.prompt, 50), project));
        }
        if tasks.len() > 5 {
            md.push_str(&format!("- ...and {} more\n", tasks.len() - 5));
        }
    }

    md
}

/// Format token count
fn format_tokens(tokens: i64) -> String {
    if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.1}K", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}

/// Truncate string
fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len - 3])
    }
}

/// Save report to disk
fn save_report(report: &DailyReport) -> Result<(), String> {
    let reports_dir = crate::platform::get_alice_dir().join("reports");

    std::fs::create_dir_all(&reports_dir)
        .map_err(|e| format!("Failed to create reports directory: {}", e))?;

    let report_path = reports_dir.join(format!("{}.md", report.date));
    std::fs::write(&report_path, &report.markdown)
        .map_err(|e| format!("Failed to write report: {}", e))?;

    // Also save JSON version for structured access
    let json_path = reports_dir.join(format!("{}.json", report.date));
    let json = serde_json::to_string_pretty(report)
        .map_err(|e| format!("Failed to serialize report: {}", e))?;
    std::fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write report JSON: {}", e))?;

    Ok(())
}

/// Load report from disk
pub fn load_report(date: &str) -> Result<DailyReport, String> {
    let json_path = crate::platform::get_alice_dir().join("reports").join(format!("{}.json", date));

    let content = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read report: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse report: {}", e))
}

/// List available reports
pub fn list_reports() -> Result<Vec<String>, String> {
    let reports_dir = crate::platform::get_alice_dir().join("reports");

    if !reports_dir.exists() {
        return Ok(Vec::new());
    }

    let mut dates: Vec<String> = std::fs::read_dir(&reports_dir)
        .map_err(|e| format!("Failed to read reports directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".json") {
                Some(name.trim_end_matches(".json").to_string())
            } else {
                None
            }
        })
        .collect();

    dates.sort_by(|a, b| b.cmp(a)); // Newest first
    Ok(dates)
}

/// Generate today's report
pub fn generate_today_report(app: &AppHandle) -> Result<DailyReport, String> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    generate_report(app, &today)
}

/// Generate AI summary for a report using Claude Haiku
pub async fn generate_ai_summary(report: &DailyReport) -> Result<String, String> {
    // Build a prompt with the report data
    let mut prompt = String::new();
    prompt.push_str("Based on the following daily coding activity, write a concise 2-3 sentence summary highlighting the key accomplishments and work done. Be specific about what was achieved.\n\n");

    prompt.push_str(&format!("Date: {}\n", report.date));
    prompt.push_str(&format!("Sessions: {}\n", report.usage_summary.total_sessions));
    prompt.push_str(&format!("Total tokens used: {}\n", report.usage_summary.total_tokens));
    prompt.push_str(&format!("Total cost: ${:.2}\n\n", report.usage_summary.total_cost_usd));

    if !report.sessions.is_empty() {
        prompt.push_str("Session topics:\n");
        for s in report.sessions.iter().take(10) {
            prompt.push_str(&format!("- {}: {}\n", s.project_name, truncate(&s.prompt, 100)));
        }
        prompt.push('\n');
    }

    if !report.git_commits.is_empty() {
        let cc_commits: Vec<_> = report.git_commits.iter().filter(|c| c.is_cc_assisted).collect();
        if !cc_commits.is_empty() {
            prompt.push_str("CC-assisted commits:\n");
            for c in cc_commits.iter().take(5) {
                prompt.push_str(&format!("- {}: {}\n", c.project_name, c.message));
            }
        }
    }

    prompt.push_str("\nWrite only the summary, no explanations or extra text.");

    // Call claude CLI with haiku model (use platform-appropriate executable name)
    let output = tokio::process::Command::new(crate::platform::get_claude_command())
        .args([
            "-p", &prompt,
            "--model", "haiku",
            "--max-turns", "1",
            "--output-format", "text",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run claude: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Claude failed: {}", stderr));
    }

    let summary = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Clean up any markdown formatting from the response
    let summary = summary
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    Ok(summary)
}

/// Update report with AI summary
pub fn update_report_with_summary(date: &str, summary: &str) -> Result<DailyReport, String> {
    let mut report = load_report(date)?;
    report.ai_summary = Some(summary.to_string());

    // Regenerate markdown with AI summary at the top
    let mut new_markdown = String::new();
    new_markdown.push_str(&format!("# Daily Report — {}\n\n", report.date));
    new_markdown.push_str(&format!("> **AI Summary**: {}\n\n", summary));

    // Add the rest of the markdown (skip the original header)
    let original_content = report.markdown
        .lines()
        .skip(2) // Skip "# Daily Report — ..." and empty line
        .collect::<Vec<_>>()
        .join("\n");
    new_markdown.push_str(&original_content);

    report.markdown = new_markdown;

    // Save updated report
    save_report(&report)?;

    Ok(report)
}
