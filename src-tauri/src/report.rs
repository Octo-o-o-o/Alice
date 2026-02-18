// Daily Report Generator

#![allow(dead_code)]

use crate::database::{self, TaskStatus};
use crate::session::Session;
use chrono::{Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

// ---------------------------------------------------------------------------
// Public data structures
// ---------------------------------------------------------------------------

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
    #[serde(default)]
    pub work_value_score: Option<i32>,
    #[serde(default)]
    pub workload_score: Option<i32>,
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

impl GitCommit {
    fn is_claude_assisted(message: &str) -> bool {
        message.contains("Co-Authored-By: Claude")
            || message.contains("\u{1F916}")
            || message.to_lowercase().contains("claude")
    }
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

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/// Generate daily report for a specific date
pub fn generate_report(app: &AppHandle, date: &str) -> Result<DailyReport, String> {
    let parsed_date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date format: {}", e))?;

    let sessions = database::get_sessions_by_date(app, date)
        .map_err(|e| e.to_string())?;

    let session_summaries = build_session_summaries(&sessions);

    let project_paths: Vec<String> = sessions
        .iter()
        .filter(|s| !s.project_path.is_empty())
        .map(|s| s.project_path.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    let git_commits = get_git_commits_for_date(&project_paths, &parsed_date);
    let usage_summary = calculate_usage_summary(&sessions);
    let pending_tasks = get_pending_tasks(app)?;

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
        work_value_score: None,
        workload_score: None,
    };

    save_report(&report)?;

    Ok(report)
}

/// Generate today's report
pub fn generate_today_report(app: &AppHandle) -> Result<DailyReport, String> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    generate_report(app, &today)
}

/// Generate report with AI analysis
pub async fn generate_report_with_ai(app: &AppHandle, date: &str) -> Result<DailyReport, String> {
    let mut report = generate_report(app, date)?;

    let config = crate::config::load_config();
    match generate_ai_analysis(&report, &config.report_language).await {
        Ok(analysis) => {
            report.ai_summary = Some(analysis.summary);
            report.work_value_score = Some(analysis.work_value_score);
            report.workload_score = Some(analysis.workload_score);
            report.markdown = analysis.markdown_content;
            save_report(&report)?;
            Ok(report)
        }
        Err(e) => {
            tracing::warn!("Failed to generate AI analysis: {}", e);
            Ok(report)
        }
    }
}

// ---------------------------------------------------------------------------
// Report persistence
// ---------------------------------------------------------------------------

/// Load report from disk
pub fn load_report(date: &str) -> Result<DailyReport, String> {
    let json_path = reports_dir().join(format!("{}.json", date));
    let content = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read report: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse report: {}", e))
}

/// List available reports (newest first)
pub fn list_reports() -> Result<Vec<String>, String> {
    let dir = reports_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut dates: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read reports directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.strip_suffix(".json").map(|s| s.to_string())
        })
        .collect();

    dates.sort_by(|a, b| b.cmp(a));
    Ok(dates)
}

fn save_report(report: &DailyReport) -> Result<(), String> {
    let dir = reports_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create reports directory: {}", e))?;

    let report_path = dir.join(format!("{}.md", report.date));
    std::fs::write(&report_path, &report.markdown)
        .map_err(|e| format!("Failed to write report: {}", e))?;

    let json_path = dir.join(format!("{}.json", report.date));
    let json = serde_json::to_string_pretty(report)
        .map_err(|e| format!("Failed to serialize report: {}", e))?;
    std::fs::write(&json_path, json)
        .map_err(|e| format!("Failed to write report JSON: {}", e))?;

    Ok(())
}

fn reports_dir() -> PathBuf {
    crate::platform::get_alice_dir().join("reports")
}

// ---------------------------------------------------------------------------
// Data collection helpers
// ---------------------------------------------------------------------------

fn build_session_summaries(sessions: &[Session]) -> Vec<SessionSummary> {
    sessions
        .iter()
        .map(|s| SessionSummary {
            project_name: s.project_name.clone(),
            prompt: s.first_prompt.clone().unwrap_or_default(),
            status: s.status.as_str().to_string(),
            tokens: s.total_tokens,
            cost_usd: s.total_cost_usd,
            duration_minutes: (s.last_active_at - s.started_at) / 60_000,
        })
        .collect()
}

fn get_git_commits_for_date(project_paths: &[String], date: &NaiveDate) -> Vec<GitCommit> {
    let git_cmd = match crate::platform::get_git_command() {
        Some(cmd) => cmd,
        None => {
            tracing::warn!("Git not found on PATH, skipping commit collection");
            return Vec::new();
        }
    };

    let date_str = date.format("%Y-%m-%d").to_string();
    let mut commits = Vec::new();

    for project_path in project_paths {
        let path = PathBuf::from(project_path);
        if !path.exists() {
            continue;
        }

        let project_name = project_name_from_path(&path);

        let output = Command::new(git_cmd)
            .current_dir(&path)
            .args([
                "log",
                &format!("--since={} 00:00:00", date_str),
                &format!("--until={} 23:59:59", date_str),
                "--format=%H|%s|%an|%ai",
            ])
            .output();

        let Ok(output) = output else { continue };

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() < 4 {
                continue;
            }

            let message = parts[1].to_string();
            commits.push(GitCommit {
                project_name: project_name.clone(),
                hash: parts[0][..7].to_string(),
                is_cc_assisted: GitCommit::is_claude_assisted(&message),
                message,
                author: parts[2].to_string(),
                timestamp: parts[3].to_string(),
            });
        }
    }

    commits
}

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

fn get_pending_tasks(app: &AppHandle) -> Result<Vec<TaskSummary>, String> {
    let mut all_tasks = Vec::new();
    for status in [TaskStatus::Backlog, TaskStatus::Queued] {
        let tasks = database::get_tasks(app, Some(status), None)
            .map_err(|e| e.to_string())?;
        all_tasks.extend(tasks);
    }

    let summaries = all_tasks
        .into_iter()
        .map(|t| TaskSummary {
            prompt: t.prompt,
            project_name: t.project_path.as_deref().map(|p| project_name_from_path(Path::new(p))),
            priority: format!("{:?}", t.priority).to_lowercase(),
        })
        .collect();

    Ok(summaries)
}

// ---------------------------------------------------------------------------
// Markdown report generation
// ---------------------------------------------------------------------------

fn generate_markdown(
    date: &str,
    sessions: &[SessionSummary],
    commits: &[GitCommit],
    usage: &UsageSummary,
    tasks: &[TaskSummary],
) -> String {
    let mut md = String::new();

    writeln!(md, "# Daily Report \u{2014} {}\n", date).unwrap();

    write_sessions_section(&mut md, sessions);
    write_cc_commits_section(&mut md, commits);
    write_usage_table(&mut md, usage);
    write_pending_tasks_section(&mut md, tasks);

    md
}

fn write_sessions_section(md: &mut String, sessions: &[SessionSummary]) {
    writeln!(md, "## Sessions ({})\n", sessions.len()).unwrap();
    for s in sessions {
        writeln!(
            md,
            "- **{}**: \"{}\" \u{2014} {}, {} tokens, ${:.2}",
            s.project_name,
            truncate(&s.prompt, 50),
            s.status,
            format_tokens(s.tokens),
            s.cost_usd
        )
        .unwrap();
    }
    md.push('\n');
}

fn write_cc_commits_section(md: &mut String, commits: &[GitCommit]) {
    let cc_commits: Vec<_> = cc_assisted_commits(commits);
    if cc_commits.is_empty() {
        return;
    }

    writeln!(md, "## Git Commits (CC-assisted: {})\n", cc_commits.len()).unwrap();
    for c in &cc_commits {
        writeln!(md, "- {}: `{}` \u{2014} {}", c.project_name, c.hash, c.message).unwrap();
    }
    md.push('\n');
}

fn write_usage_table(md: &mut String, usage: &UsageSummary) {
    writeln!(md, "## Usage Summary\n").unwrap();
    writeln!(md, "| Project | Sessions | Tokens | Cost |").unwrap();
    writeln!(md, "|---------|----------|--------|------|").unwrap();
    for p in &usage.by_project {
        writeln!(
            md,
            "| {} | {} | {} | ${:.2} |",
            p.project_name,
            p.sessions,
            format_tokens(p.tokens),
            p.cost_usd
        )
        .unwrap();
    }
    writeln!(
        md,
        "| **Total** | **{}** | **{}** | **${:.2}** |\n",
        usage.total_sessions,
        format_tokens(usage.total_tokens),
        usage.total_cost_usd
    )
    .unwrap();
}

fn write_pending_tasks_section(md: &mut String, tasks: &[TaskSummary]) {
    if tasks.is_empty() {
        return;
    }

    writeln!(md, "## Queued Tasks ({} pending)\n", tasks.len()).unwrap();
    for t in tasks.iter().take(5) {
        let project = t.project_name.as_deref().unwrap_or("No project");
        writeln!(md, "- \"{}\" ({})", truncate(&t.prompt, 50), project).unwrap();
    }
    if tasks.len() > 5 {
        writeln!(md, "- ...and {} more", tasks.len() - 5).unwrap();
    }
}

// ---------------------------------------------------------------------------
// AI analysis
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AiAnalysis {
    summary: String,
    work_value_score: i32,
    workload_score: i32,
    markdown_content: String,
}

async fn generate_ai_analysis(report: &DailyReport, language: &str) -> Result<AiAnalysis, String> {
    let prompt = build_ai_prompt(report, language);

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

    let response = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let json_str = strip_code_fences(&response);

    let analysis: AiAnalysis = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse AI response as JSON: {}. Response was: {}", e, json_str))?;

    validate_score(analysis.work_value_score, "work_value_score")?;
    validate_score(analysis.workload_score, "workload_score")?;

    Ok(analysis)
}

/// Validate that a score falls within the expected 1-10 range.
fn validate_score(score: i32, name: &str) -> Result<(), String> {
    if (1..=10).contains(&score) {
        Ok(())
    } else {
        Err(format!("Invalid {}: {}", name, score))
    }
}

/// Strip optional markdown code fences (```json ... ```) from an AI response.
fn strip_code_fences(s: &str) -> &str {
    s.trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}

fn build_ai_prompt(report: &DailyReport, language: &str) -> String {
    let mut p = String::new();

    writeln!(p, "You are analyzing a developer's daily work activity. Generate a comprehensive daily report.\n").unwrap();

    write_language_instruction(&mut p, language);

    writeln!(p, "# Input Data\n").unwrap();
    writeln!(p, "**Date:** {}\n", report.date).unwrap();

    write_sessions_by_project(&mut p, &report.sessions);
    write_cc_commits_by_project(&mut p, &report.git_commits);
    write_summary_statistics(&mut p, report);

    write!(p, "{}", AI_TASK_INSTRUCTIONS).unwrap();

    p
}

fn write_language_instruction(p: &mut String, language: &str) {
    if language == "auto" {
        return;
    }

    let instruction = match language {
        "en" => "IMPORTANT: Generate the report in English.",
        "zh" => "\u{91CD}\u{8981}\u{63D0}\u{793A}\u{FF1A}\u{8BF7}\u{4F7F}\u{7528}\u{4E2D}\u{6587}\u{751F}\u{6210}\u{62A5}\u{544A}\u{3002}",
        "ja" => "\u{91CD}\u{8981}\u{FF1A}\u{30EC}\u{30DD}\u{30FC}\u{30C8}\u{306F}\u{65E5}\u{672C}\u{8A9E}\u{3067}\u{751F}\u{6210}\u{3057}\u{3066}\u{304F}\u{3060}\u{3055}\u{3044}\u{3002}",
        "es" => "IMPORTANTE: Genere el informe en espa\u{00F1}ol.",
        "fr" => "IMPORTANT : G\u{00E9}n\u{00E9}rez le rapport en fran\u{00E7}ais.",
        "de" => "WICHTIG: Erstellen Sie den Bericht auf Deutsch.",
        "ko" => "\u{C911}\u{C694}: \u{BCF4}\u{ACE0}\u{C11C}\u{B97C} \u{D55C}\u{AD6D}\u{C5B4}\u{B85C} \u{C0DD}\u{C131}\u{D558}\u{C138}\u{C694}.",
        _ => "IMPORTANT: Generate the report in the specified language.",
    };
    writeln!(p, "{}\n", instruction).unwrap();
}

fn write_sessions_by_project(p: &mut String, sessions: &[SessionSummary]) {
    if sessions.is_empty() {
        return;
    }

    writeln!(p, "## Work Sessions by Project\n").unwrap();

    let project_sessions = group_by(sessions, |s| &s.project_name);
    for (project, sessions) in &project_sessions {
        let total_tokens: i64 = sessions.iter().map(|s| s.tokens).sum();
        let total_cost: f64 = sessions.iter().map(|s| s.cost_usd).sum();
        let total_duration: i64 = sessions.iter().map(|s| s.duration_minutes).sum();

        writeln!(p, "### {}", project).unwrap();
        writeln!(p, "- Sessions: {}", sessions.len()).unwrap();
        writeln!(p, "- Duration: {} minutes", total_duration).unwrap();
        writeln!(p, "- Tokens: {} ({} tokens)", format_tokens(total_tokens), total_tokens).unwrap();
        writeln!(p, "- Cost: ${:.2}\n", total_cost).unwrap();

        writeln!(p, "**Session prompts:**").unwrap();
        for s in sessions {
            writeln!(p, "- \"{}\"", s.prompt).unwrap();
        }
        p.push('\n');
    }
}

fn write_cc_commits_by_project(p: &mut String, commits: &[GitCommit]) {
    let cc_commits = cc_assisted_commits(commits);
    if cc_commits.is_empty() {
        return;
    }

    writeln!(p, "## Claude Code Assisted Git Commits\n").unwrap();

    let commit_groups = group_by(&cc_commits, |c| &c.project_name);
    for (project, commits) in &commit_groups {
        writeln!(p, "### {}", project).unwrap();
        for c in commits {
            writeln!(p, "- `{}` {}", c.hash, c.message).unwrap();
        }
        p.push('\n');
    }
}

fn write_summary_statistics(p: &mut String, report: &DailyReport) {
    let cc_count = report.git_commits.iter().filter(|c| c.is_cc_assisted).count();

    writeln!(p, "## Summary Statistics\n").unwrap();
    writeln!(p, "- Total sessions: {}", report.usage_summary.total_sessions).unwrap();
    writeln!(p, "- Total tokens: {} ({})", format_tokens(report.usage_summary.total_tokens), report.usage_summary.total_tokens).unwrap();
    writeln!(p, "- Total cost: ${:.2}", report.usage_summary.total_cost_usd).unwrap();
    writeln!(
        p,
        "- Git commits: {} ({} CC-assisted)\n",
        report.git_commits.len(),
        cc_count
    )
    .unwrap();
}

const AI_TASK_INSTRUCTIONS: &str = "\
# Task

Generate a professional daily work report in the following JSON format:

```json
{
  \"summary\": \"A concise 2-3 sentence executive summary of the day's work\",
  \"work_value_score\": 7,
  \"workload_score\": 8,
  \"markdown_content\": \"## Daily Report\\n\\nDetailed markdown report...\"
}
```

**Scoring Guidelines:**
- `work_value_score` (1-10): Business/technical value created (new features, critical fixes, architecture improvements)
- `workload_score` (1-10): Amount of work done (sessions, commits, time spent, complexity)

**Markdown Content Requirements:**
- Group all work by project
- Highlight key accomplishments and outcomes
- Include specific details from prompts and commits
- Use clear headings, bullet points, and formatting
- Be professional but concise
- Focus on WHAT was achieved, not just metrics

Return ONLY the JSON object, no other text.";

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/// Filter commits to only those assisted by Claude Code.
fn cc_assisted_commits(commits: &[GitCommit]) -> Vec<&GitCommit> {
    commits.iter().filter(|c| c.is_cc_assisted).collect()
}

fn format_tokens(tokens: i64) -> String {
    if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.1}K", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}

/// Truncate string (UTF-8 safe -- works correctly with multibyte characters)
fn truncate(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_len.saturating_sub(3)).collect();
        format!("{}...", truncated)
    }
}

/// Extract the project name from a filesystem path
fn project_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string()
}

/// Group a slice of items by a key extracted from each item.
/// Preserves insertion order of first-seen keys via Vec of pairs.
fn group_by<'a, T, K>(items: &'a [T], key_fn: impl Fn(&'a T) -> &'a K) -> Vec<(&'a K, Vec<&'a T>)>
where
    K: Eq + std::hash::Hash,
{
    let mut map: HashMap<&'a K, Vec<&'a T>> = HashMap::new();
    let mut order: Vec<&'a K> = Vec::new();

    for item in items {
        let k = key_fn(item);
        if !map.contains_key(k) {
            order.push(k);
        }
        map.entry(k).or_default().push(item);
    }

    order
        .into_iter()
        .filter_map(|k| map.remove(k).map(|v| (k, v)))
        .collect()
}
