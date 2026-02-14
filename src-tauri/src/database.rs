// SQLite database management

use crate::session::{Session, SessionDetail, SessionMessage, SessionStatus, UsageStats, DailyUsage, ProjectUsage};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not found: {0}")]
    NotFound(String),
}

/// Task status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Backlog,
    Queued,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskStatus::Backlog => write!(f, "backlog"),
            TaskStatus::Queued => write!(f, "queued"),
            TaskStatus::Running => write!(f, "running"),
            TaskStatus::Completed => write!(f, "completed"),
            TaskStatus::Failed => write!(f, "failed"),
            TaskStatus::Skipped => write!(f, "skipped"),
        }
    }
}

impl std::str::FromStr for TaskStatus {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "backlog" => Ok(TaskStatus::Backlog),
            "queued" => Ok(TaskStatus::Queued),
            "running" => Ok(TaskStatus::Running),
            "completed" => Ok(TaskStatus::Completed),
            "failed" => Ok(TaskStatus::Failed),
            "skipped" => Ok(TaskStatus::Skipped),
            _ => Err(()),
        }
    }
}

/// Task data model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub prompt: String,
    pub project_path: Option<String>,
    pub status: TaskStatus,
    pub priority: String,
    pub execution_mode: String,
    pub depends_on: Option<String>,
    pub session_id: Option<String>,
    pub system_prompt: Option<String>,
    pub allowed_tools: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<i32>,
    pub notes: Option<String>,
    pub tags: Option<String>,
    pub sort_order: i32,
    pub result_exit_code: Option<i32>,
    pub result_output: Option<String>,
    pub result_tokens: Option<i64>,
    pub result_cost_usd: Option<f64>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

/// Global database connection (thread-safe)
static DB: once_cell::sync::OnceCell<Mutex<Connection>> = once_cell::sync::OnceCell::new();

/// Get the Alice data directory
fn get_alice_dir() -> PathBuf {
    crate::platform::get_alice_dir()
}

/// Get the database path
fn get_db_path() -> PathBuf {
    get_alice_dir().join("alice.db")
}

/// Initialize the database
pub fn init_database(_app: &AppHandle) -> Result<(), DatabaseError> {
    let alice_dir = get_alice_dir();
    std::fs::create_dir_all(&alice_dir)?;

    let db_path = get_db_path();
    let conn = Connection::open(&db_path)?;

    // Create tables
    conn.execute_batch(
        r#"
        -- Session index
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            project_path TEXT NOT NULL,
            project_name TEXT NOT NULL,
            first_prompt TEXT,
            all_prompts TEXT,
            label TEXT,
            tags TEXT,
            started_at INTEGER NOT NULL,
            last_active_at INTEGER NOT NULL,
            message_count INTEGER,
            total_tokens INTEGER,
            total_cost_usd REAL,
            model TEXT,
            status TEXT
        );

        -- Full-text search for sessions
        CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
            first_prompt, all_prompts, label, tags,
            content=sessions, content_rowid=rowid
        );

        -- Session messages
        CREATE TABLE IF NOT EXISTS session_messages (
            id INTEGER PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            timestamp INTEGER,
            tokens_in INTEGER,
            tokens_out INTEGER,
            model TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
        );

        -- Usage records
        CREATE TABLE IF NOT EXISTS usage_records (
            id INTEGER PRIMARY KEY,
            session_id TEXT NOT NULL,
            project_path TEXT NOT NULL,
            date TEXT NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cache_write_tokens INTEGER DEFAULT 0,
            cache_read_tokens INTEGER DEFAULT 0,
            estimated_cost_usd REAL DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_records(date);
        CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_records(project_path);
        CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path, last_active_at DESC);

        -- Tasks (unified backlog + queue)
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            project_path TEXT,
            status TEXT DEFAULT 'backlog',
            priority TEXT DEFAULT 'medium',
            execution_mode TEXT DEFAULT 'new',
            depends_on TEXT,
            session_id TEXT,
            system_prompt TEXT,
            allowed_tools TEXT,
            max_budget_usd REAL,
            max_turns INTEGER,
            notes TEXT,
            tags TEXT,
            sort_order INTEGER NOT NULL,
            result_exit_code INTEGER,
            result_output TEXT,
            result_tokens INTEGER,
            result_cost_usd REAL,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, sort_order);
        CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_path, status);

        -- Daily reports
        CREATE TABLE IF NOT EXISTS daily_reports (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL UNIQUE,
            content_md TEXT NOT NULL,
            sessions_count INTEGER,
            commits_count INTEGER,
            total_tokens INTEGER,
            total_cost_usd REAL,
            generated_at TEXT NOT NULL
        );

        -- Projects registry
        CREATE TABLE IF NOT EXISTS projects (
            path TEXT PRIMARY KEY,
            display_name TEXT,
            last_active_at TEXT,
            total_sessions INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            total_cost_usd REAL DEFAULT 0
        );
        "#,
    )?;

    DB.set(Mutex::new(conn))
        .map_err(|_| DatabaseError::NotFound("Database already initialized".to_string()))?;

    tracing::info!("Database initialized at {:?}", db_path);
    Ok(())
}

/// Get the database connection
fn get_db() -> Result<std::sync::MutexGuard<'static, Connection>, DatabaseError> {
    DB.get()
        .ok_or_else(|| DatabaseError::NotFound("Database not initialized".to_string()))
        .and_then(|m| {
            m.lock()
                .map_err(|_| DatabaseError::NotFound("Database lock poisoned".to_string()))
        })
}

/// Get sessions from database
pub fn get_sessions(
    _app: &AppHandle,
    project: Option<&str>,
    limit: i64,
) -> Result<Vec<Session>, DatabaseError> {
    let conn = get_db()?;

    let sql = if project.is_some() {
        "SELECT session_id, project_path, project_name, first_prompt, label, tags,
                started_at, last_active_at, message_count, total_tokens, total_cost_usd, model, status
         FROM sessions WHERE project_path = ?1
         ORDER BY last_active_at DESC LIMIT ?2"
    } else {
        "SELECT session_id, project_path, project_name, first_prompt, label, tags,
                started_at, last_active_at, message_count, total_tokens, total_cost_usd, model, status
         FROM sessions
         ORDER BY last_active_at DESC LIMIT ?1"
    };

    let mut stmt = conn.prepare(sql)?;

    let rows = if let Some(proj) = project {
        stmt.query_map(params![proj, limit], map_session_row)?
    } else {
        stmt.query_map(params![limit], map_session_row)?
    };

    let sessions: Vec<Session> = rows.filter_map(|r| r.ok()).collect();
    Ok(sessions)
}

/// Map a database row to a Session
fn map_session_row(row: &rusqlite::Row) -> Result<Session, rusqlite::Error> {
    let status_str: String = row.get(12)?;
    let status = match status_str.as_str() {
        "idle" => SessionStatus::Idle,
        "active" => SessionStatus::Active,
        "error" => SessionStatus::Error,
        "needs_input" => SessionStatus::NeedsInput,
        _ => SessionStatus::Completed,
    };

    let tags_str: Option<String> = row.get(5)?;
    let tags: Vec<String> = tags_str
        .map(|s| serde_json::from_str(&s).unwrap_or_default())
        .unwrap_or_default();

    Ok(Session {
        session_id: row.get(0)?,
        project_path: row.get(1)?,
        project_name: row.get(2)?,
        first_prompt: row.get(3)?,
        label: row.get(4)?,
        tags,
        started_at: row.get(6)?,
        last_active_at: row.get(7)?,
        message_count: row.get(8)?,
        total_tokens: row.get(9)?,
        total_cost_usd: row.get(10)?,
        model: row.get(11)?,
        status,
    })
}

/// Get session detail
pub fn get_session_detail(
    _app: &AppHandle,
    session_id: &str,
) -> Result<SessionDetail, DatabaseError> {
    let conn = get_db()?;

    // Get session
    let session = conn.query_row(
        "SELECT session_id, project_path, project_name, first_prompt, label, tags,
                started_at, last_active_at, message_count, total_tokens, total_cost_usd, model, status
         FROM sessions WHERE session_id = ?1",
        params![session_id],
        map_session_row,
    )?;

    // Get messages
    let mut stmt = conn.prepare(
        "SELECT id, role, content, timestamp, tokens_in, tokens_out, model
         FROM session_messages WHERE session_id = ?1 ORDER BY timestamp ASC"
    )?;

    let messages: Vec<SessionMessage> = stmt
        .query_map(params![session_id], |row| {
            Ok(SessionMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                timestamp: row.get(3)?,
                tokens_in: row.get(4)?,
                tokens_out: row.get(5)?,
                model: row.get(6)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(SessionDetail { session, messages })
}

/// Get active sessions
pub fn get_active_sessions(_app: &AppHandle) -> Result<Vec<Session>, DatabaseError> {
    let conn = get_db()?;

    let mut stmt = conn.prepare(
        "SELECT session_id, project_path, project_name, first_prompt, label, tags,
                started_at, last_active_at, message_count, total_tokens, total_cost_usd, model, status
         FROM sessions WHERE status = 'active'
         ORDER BY last_active_at DESC"
    )?;

    let sessions: Vec<Session> = stmt
        .query_map([], map_session_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

/// Get usage statistics
pub fn get_usage_stats(
    _app: &AppHandle,
    project: Option<&str>,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<UsageStats, DatabaseError> {
    let conn = get_db()?;

    // Build query conditions
    let mut conditions = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(proj) = project {
        conditions.push("project_path = ?");
        params_vec.push(Box::new(proj.to_string()));
    }
    if let Some(start) = start_date {
        conditions.push("date >= ?");
        params_vec.push(Box::new(start.to_string()));
    }
    if let Some(end) = end_date {
        conditions.push("date <= ?");
        params_vec.push(Box::new(end.to_string()));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // Get totals
    let sql = format!(
        "SELECT COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens), 0),
                COALESCE(SUM(estimated_cost_usd), 0),
                COUNT(DISTINCT session_id),
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(cache_read_tokens), 0),
                COALESCE(SUM(cache_write_tokens), 0)
         FROM usage_records {}",
        where_clause
    );

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let (total_tokens, total_cost_usd, session_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) =
        conn.query_row(&sql, params_refs.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, i32>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?;

    // Get daily breakdown
    let daily_sql = format!(
        "SELECT date, SUM(input_tokens + output_tokens + cache_read_tokens),
                SUM(estimated_cost_usd), COUNT(DISTINCT session_id)
         FROM usage_records {} GROUP BY date ORDER BY date DESC LIMIT 30",
        where_clause
    );

    let mut stmt = conn.prepare(&daily_sql)?;
    let daily_usage: Vec<DailyUsage> = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(DailyUsage {
                date: row.get(0)?,
                tokens: row.get(1)?,
                cost_usd: row.get(2)?,
                session_count: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Get project breakdown
    let project_sql = format!(
        "SELECT project_path, SUM(input_tokens + output_tokens + cache_read_tokens),
                SUM(estimated_cost_usd), COUNT(DISTINCT session_id)
         FROM usage_records {} GROUP BY project_path ORDER BY SUM(estimated_cost_usd) DESC LIMIT 20",
        where_clause
    );

    let mut stmt = conn.prepare(&project_sql)?;
    let project_usage: Vec<ProjectUsage> = stmt
        .query_map(params_refs.as_slice(), |row| {
            let path: String = row.get(0)?;
            let name = std::path::Path::new(&path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            Ok(ProjectUsage {
                project_name: name,
                project_path: path,
                tokens: row.get(1)?,
                cost_usd: row.get(2)?,
                session_count: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(UsageStats {
        total_tokens,
        total_cost_usd,
        session_count,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        daily_usage,
        project_usage,
    })
}

/// Search sessions
pub fn search_sessions(
    _app: &AppHandle,
    query: &str,
    project: Option<&str>,
    limit: i64,
) -> Result<Vec<Session>, DatabaseError> {
    let conn = get_db()?;

    let sql = if project.is_some() {
        "SELECT s.session_id, s.project_path, s.project_name, s.first_prompt, s.label, s.tags,
                s.started_at, s.last_active_at, s.message_count, s.total_tokens, s.total_cost_usd, s.model, s.status
         FROM sessions s
         JOIN sessions_fts fts ON s.rowid = fts.rowid
         WHERE sessions_fts MATCH ?1 AND s.project_path = ?2
         ORDER BY s.last_active_at DESC LIMIT ?3"
    } else {
        "SELECT s.session_id, s.project_path, s.project_name, s.first_prompt, s.label, s.tags,
                s.started_at, s.last_active_at, s.message_count, s.total_tokens, s.total_cost_usd, s.model, s.status
         FROM sessions s
         JOIN sessions_fts fts ON s.rowid = fts.rowid
         WHERE sessions_fts MATCH ?1
         ORDER BY s.last_active_at DESC LIMIT ?2"
    };

    let mut stmt = conn.prepare(sql)?;

    let rows = if let Some(proj) = project {
        stmt.query_map(params![query, proj, limit], map_session_row)?
    } else {
        stmt.query_map(params![query, limit], map_session_row)?
    };

    let sessions: Vec<Session> = rows.filter_map(|r| r.ok()).collect();
    Ok(sessions)
}

/// Search sessions with advanced filters
pub fn search_sessions_filtered(
    _app: &AppHandle,
    query: Option<&str>,
    project: Option<&str>,
    status: Option<&str>,
    model: Option<&str>,
    date_from: Option<&str>,
    date_to: Option<&str>,
    limit: i64,
) -> Result<Vec<Session>, DatabaseError> {
    let conn = get_db()?;

    // Build dynamic WHERE clause
    let mut conditions = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    // FTS query
    if let Some(q) = query {
        if !q.trim().is_empty() {
            conditions.push("s.rowid IN (SELECT rowid FROM sessions_fts WHERE sessions_fts MATCH ?)");
            params.push(Box::new(q.to_string()));
        }
    }

    // Project filter
    if let Some(p) = project {
        conditions.push("s.project_path = ?");
        params.push(Box::new(p.to_string()));
    }

    // Status filter
    if let Some(s) = status {
        conditions.push("s.status = ?");
        params.push(Box::new(s.to_string()));
    }

    // Model filter
    if let Some(m) = model {
        conditions.push("s.model LIKE ?");
        params.push(Box::new(format!("%{}%", m)));
    }

    // Date range filters (timestamps are in milliseconds)
    if let Some(from) = date_from {
        // Parse date string and convert to timestamp
        if let Ok(date) = chrono::NaiveDate::parse_from_str(from, "%Y-%m-%d") {
            let timestamp = date.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis();
            conditions.push("s.last_active_at >= ?");
            params.push(Box::new(timestamp));
        }
    }

    if let Some(to) = date_to {
        if let Ok(date) = chrono::NaiveDate::parse_from_str(to, "%Y-%m-%d") {
            let timestamp = date.and_hms_opt(23, 59, 59).unwrap().and_utc().timestamp_millis();
            conditions.push("s.last_active_at <= ?");
            params.push(Box::new(timestamp));
        }
    }

    // Build SQL
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT session_id, project_path, project_name, first_prompt, label, tags,
                started_at, last_active_at, message_count, total_tokens, total_cost_usd, model, status
         FROM sessions s
         {}
         ORDER BY last_active_at DESC LIMIT ?",
        where_clause
    );

    params.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql)?;

    // Convert params to references for query_map
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(rusqlite::params_from_iter(param_refs), map_session_row)?;

    let sessions: Vec<Session> = rows.filter_map(|r| r.ok()).collect();
    Ok(sessions)
}

/// Insert or update a session
pub fn upsert_session(session: &Session) -> Result<(), DatabaseError> {
    let conn = get_db()?;

    let status_str = match session.status {
        SessionStatus::Idle => "idle",
        SessionStatus::Active => "active",
        SessionStatus::Completed => "completed",
        SessionStatus::Error => "error",
        SessionStatus::NeedsInput => "needs_input",
    };

    let tags_json = serde_json::to_string(&session.tags).unwrap_or_default();

    conn.execute(
        "INSERT OR REPLACE INTO sessions
         (session_id, project_path, project_name, first_prompt, label, tags,
          started_at, last_active_at, message_count, total_tokens, total_cost_usd, model, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            session.session_id,
            session.project_path,
            session.project_name,
            session.first_prompt,
            session.label,
            tags_json,
            session.started_at,
            session.last_active_at,
            session.message_count,
            session.total_tokens,
            session.total_cost_usd,
            session.model,
            status_str,
        ],
    )?;

    // Update FTS index
    conn.execute(
        "INSERT OR REPLACE INTO sessions_fts (rowid, first_prompt, all_prompts, label, tags)
         SELECT rowid, first_prompt, first_prompt, label, tags FROM sessions WHERE session_id = ?1",
        params![session.session_id],
    )?;

    Ok(())
}

/// Get tasks
pub fn get_tasks(
    _app: &AppHandle,
    status: Option<TaskStatus>,
    project: Option<&str>,
) -> Result<Vec<Task>, DatabaseError> {
    let conn = get_db()?;

    let sql = match (status.is_some(), project.is_some()) {
        (true, true) => {
            "SELECT * FROM tasks WHERE status = ?1 AND project_path = ?2 ORDER BY sort_order ASC"
        }
        (true, false) => "SELECT * FROM tasks WHERE status = ?1 ORDER BY sort_order ASC",
        (false, true) => "SELECT * FROM tasks WHERE project_path = ?1 ORDER BY sort_order ASC",
        (false, false) => "SELECT * FROM tasks ORDER BY status, sort_order ASC",
    };

    let mut stmt = conn.prepare(sql)?;

    let tasks: Vec<Task> = match (status, project) {
        (Some(s), Some(p)) => stmt
            .query_map(params![s.to_string(), p], map_task_row)?
            .filter_map(|r| r.ok())
            .collect(),
        (Some(s), None) => stmt
            .query_map(params![s.to_string()], map_task_row)?
            .filter_map(|r| r.ok())
            .collect(),
        (None, Some(p)) => stmt
            .query_map(params![p], map_task_row)?
            .filter_map(|r| r.ok())
            .collect(),
        (None, None) => stmt
            .query_map([], map_task_row)?
            .filter_map(|r| r.ok())
            .collect(),
    };

    Ok(tasks)
}

fn map_task_row(row: &rusqlite::Row) -> Result<Task, rusqlite::Error> {
    let status_str: String = row.get(3)?;
    let status = status_str.parse().unwrap_or(TaskStatus::Backlog);

    Ok(Task {
        id: row.get(0)?,
        prompt: row.get(1)?,
        project_path: row.get(2)?,
        status,
        priority: row.get(4)?,
        execution_mode: row.get(5)?,
        depends_on: row.get(6)?,
        session_id: row.get(7)?,
        system_prompt: row.get(8)?,
        allowed_tools: row.get(9)?,
        max_budget_usd: row.get(10)?,
        max_turns: row.get(11)?,
        notes: row.get(12)?,
        tags: row.get(13)?,
        sort_order: row.get(14)?,
        result_exit_code: row.get(15)?,
        result_output: row.get(16)?,
        result_tokens: row.get(17)?,
        result_cost_usd: row.get(18)?,
        created_at: row.get(19)?,
        started_at: row.get(20)?,
        completed_at: row.get(21)?,
    })
}

/// Create a new task
pub fn create_task(
    _app: &AppHandle,
    prompt: &str,
    project: Option<&str>,
    priority: Option<&str>,
    notes: Option<&str>,
) -> Result<Task, DatabaseError> {
    let conn = get_db()?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let priority = priority.unwrap_or("medium");

    // Get max sort_order
    let max_order: i32 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), 0) FROM tasks", [], |row| row.get(0))
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO tasks (id, prompt, project_path, status, priority, execution_mode, sort_order, created_at, notes)
         VALUES (?1, ?2, ?3, 'backlog', ?4, 'new', ?5, ?6, ?7)",
        params![id, prompt, project, priority, max_order + 1, now, notes],
    )?;

    let task = Task {
        id,
        prompt: prompt.to_string(),
        project_path: project.map(|s| s.to_string()),
        status: TaskStatus::Backlog,
        priority: priority.to_string(),
        execution_mode: "new".to_string(),
        depends_on: None,
        session_id: None,
        system_prompt: None,
        allowed_tools: None,
        max_budget_usd: None,
        max_turns: None,
        notes: notes.map(|s| s.to_string()),
        tags: None,
        sort_order: max_order + 1,
        result_exit_code: None,
        result_output: None,
        result_tokens: None,
        result_cost_usd: None,
        created_at: now,
        started_at: None,
        completed_at: None,
    };

    Ok(task)
}

/// Update a task
pub fn update_task(
    _app: &AppHandle,
    id: &str,
    status: Option<TaskStatus>,
    prompt: Option<&str>,
    priority: Option<&str>,
    sort_order: Option<i32>,
) -> Result<Task, DatabaseError> {
    let conn = get_db()?;

    if let Some(s) = status {
        let now = chrono::Utc::now().to_rfc3339();
        match s {
            TaskStatus::Running => {
                conn.execute(
                    "UPDATE tasks SET status = ?1, started_at = ?2 WHERE id = ?3",
                    params![s.to_string(), now, id],
                )?;
            }
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Skipped => {
                conn.execute(
                    "UPDATE tasks SET status = ?1, completed_at = ?2 WHERE id = ?3",
                    params![s.to_string(), now, id],
                )?;
            }
            _ => {
                conn.execute(
                    "UPDATE tasks SET status = ?1 WHERE id = ?2",
                    params![s.to_string(), id],
                )?;
            }
        }
    }

    if let Some(p) = prompt {
        conn.execute("UPDATE tasks SET prompt = ?1 WHERE id = ?2", params![p, id])?;
    }

    if let Some(p) = priority {
        conn.execute("UPDATE tasks SET priority = ?1 WHERE id = ?2", params![p, id])?;
    }

    if let Some(o) = sort_order {
        conn.execute("UPDATE tasks SET sort_order = ?1 WHERE id = ?2", params![o, id])?;
    }

    // Fetch and return updated task
    let task = conn.query_row(
        "SELECT * FROM tasks WHERE id = ?1",
        params![id],
        map_task_row,
    )?;

    Ok(task)
}

/// Delete a task
pub fn delete_task(_app: &AppHandle, id: &str) -> Result<(), DatabaseError> {
    let conn = get_db()?;
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

/// Get sessions for a specific date (for daily reports)
pub fn get_sessions_by_date(_app: &AppHandle, date: &str) -> Result<Vec<Session>, DatabaseError> {
    let conn = get_db()?;

    // Convert date to timestamp range
    // date is in format YYYY-MM-DD
    let start_of_day = format!("{} 00:00:00", date);
    let end_of_day = format!("{} 23:59:59", date);

    // Parse to milliseconds
    let start_ms = chrono::NaiveDateTime::parse_from_str(&start_of_day, "%Y-%m-%d %H:%M:%S")
        .map(|dt| dt.and_utc().timestamp_millis())
        .unwrap_or(0);
    let end_ms = chrono::NaiveDateTime::parse_from_str(&end_of_day, "%Y-%m-%d %H:%M:%S")
        .map(|dt| dt.and_utc().timestamp_millis())
        .unwrap_or(i64::MAX);

    let mut stmt = conn.prepare(
        "SELECT session_id, project_path, project_name, first_prompt, label, tags,
                started_at, last_active_at, message_count, total_tokens, total_cost_usd, model, status
         FROM sessions
         WHERE started_at >= ?1 AND started_at <= ?2
         ORDER BY started_at DESC"
    )?;

    let sessions: Vec<Session> = stmt
        .query_map(params![start_ms, end_ms], map_session_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

/// Get list of unique projects from sessions
pub fn get_projects(_app: &AppHandle) -> Result<Vec<String>, DatabaseError> {
    let conn = get_db()?;

    let mut stmt = conn.prepare(
        "SELECT DISTINCT project_path FROM sessions WHERE project_path IS NOT NULL ORDER BY project_path"
    )?;

    let projects: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}

/// Reorder tasks by updating sort_order based on the order of task_ids
pub fn reorder_tasks(_app: &AppHandle, task_ids: Vec<String>) -> Result<(), DatabaseError> {
    let conn = get_db()?;

    for (index, task_id) in task_ids.iter().enumerate() {
        conn.execute(
            "UPDATE tasks SET sort_order = ?1 WHERE id = ?2",
            params![index as i32, task_id],
        )?;
    }

    Ok(())
}

/// Update session label
pub fn update_session_label(
    _app: &AppHandle,
    session_id: &str,
    label: Option<&str>,
) -> Result<(), DatabaseError> {
    let conn = get_db()?;

    conn.execute(
        "UPDATE sessions SET label = ?1 WHERE session_id = ?2",
        params![label, session_id],
    )?;

    // Update FTS index
    conn.execute(
        "INSERT OR REPLACE INTO sessions_fts (rowid, first_prompt, all_prompts, label, tags)
         SELECT rowid, first_prompt, first_prompt, label, tags FROM sessions WHERE session_id = ?1",
        params![session_id],
    )?;

    Ok(())
}

/// Delete a session and its messages
pub fn delete_session(
    _app: &AppHandle,
    session_id: &str,
) -> Result<(), DatabaseError> {
    let conn = get_db()?;

    // Delete from FTS index first
    conn.execute(
        "DELETE FROM sessions_fts WHERE rowid = (SELECT rowid FROM sessions WHERE session_id = ?1)",
        params![session_id],
    )?;

    // Delete messages
    conn.execute(
        "DELETE FROM session_messages WHERE session_id = ?1",
        params![session_id],
    )?;

    // Delete session
    conn.execute(
        "DELETE FROM sessions WHERE session_id = ?1",
        params![session_id],
    )?;

    Ok(())
}
