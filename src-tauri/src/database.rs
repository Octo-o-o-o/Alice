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
    /// Provider that will execute this task
    #[serde(default)]
    pub provider: crate::providers::ProviderId,
}

/// Global database connection (thread-safe)
static DB: once_cell::sync::OnceCell<Mutex<Connection>> = once_cell::sync::OnceCell::new();

// ============================================================================
// Shared SQL fragments
// ============================================================================

/// The canonical SELECT column list for sessions, used by all session queries.
const SESSION_COLUMNS: &str =
    "session_id, project_path, project_name, first_prompt, label, tags,
     started_at, last_active_at, last_human_message_at, message_count, total_tokens, total_cost_usd,
     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, model, status, provider";

// ============================================================================
// SessionStatus helpers (keeps conversion logic in one place)
// ============================================================================

fn session_status_to_str(status: &SessionStatus) -> &'static str {
    match status {
        SessionStatus::Idle => "idle",
        SessionStatus::Active => "active",
        SessionStatus::Completed => "completed",
        SessionStatus::Error => "error",
        SessionStatus::NeedsInput => "needs_input",
    }
}

fn session_status_from_str(s: &str) -> SessionStatus {
    match s {
        "idle" => SessionStatus::Idle,
        "active" => SessionStatus::Active,
        "error" => SessionStatus::Error,
        "needs_input" => SessionStatus::NeedsInput,
        _ => SessionStatus::Completed,
    }
}

// ============================================================================
// Database initialization
// ============================================================================

/// Get the database path
fn get_db_path() -> PathBuf {
    crate::platform::get_alice_dir().join("alice.db")
}

/// Initialize the database
pub fn init_database(_app: &AppHandle) -> Result<(), DatabaseError> {
    let alice_dir = crate::platform::get_alice_dir();
    std::fs::create_dir_all(&alice_dir)?;

    let db_path = get_db_path();
    let conn = Connection::open(&db_path)?;

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
            last_human_message_at INTEGER,
            message_count INTEGER,
            total_tokens INTEGER,
            total_cost_usd REAL,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cache_read_tokens INTEGER DEFAULT 0,
            cache_write_tokens INTEGER DEFAULT 0,
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

        -- Favorite prompts
        CREATE TABLE IF NOT EXISTS favorites (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            prompt TEXT NOT NULL,
            project_path TEXT,
            tags TEXT,
            sort_order INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_favorites_sort ON favorites(sort_order);
        "#,
    )?;

    // Run migrations (each silently ignores "duplicate column" errors)
    run_migrations(&conn);

    DB.set(Mutex::new(conn))
        .map_err(|_| DatabaseError::NotFound("Database already initialized".to_string()))?;

    tracing::info!("Database initialized at {:?}", db_path);
    Ok(())
}

/// Run all schema migrations. Each ALTER TABLE silently fails if the column
/// already exists, so these are safe to run repeatedly.
fn run_migrations(conn: &Connection) {
    let alter_statements = [
        "ALTER TABLE sessions ADD COLUMN last_human_message_at INTEGER",
        "ALTER TABLE sessions ADD COLUMN input_tokens INTEGER DEFAULT 0",
        "ALTER TABLE sessions ADD COLUMN output_tokens INTEGER DEFAULT 0",
        "ALTER TABLE sessions ADD COLUMN cache_read_tokens INTEGER DEFAULT 0",
        "ALTER TABLE sessions ADD COLUMN cache_write_tokens INTEGER DEFAULT 0",
        "ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'",
        "ALTER TABLE tasks ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'",
    ];

    for sql in &alter_statements {
        let _ = conn.execute(sql, []);
    }

    // Backfill: set last_human_message_at to last_active_at where NULL
    let _ = conn.execute(
        "UPDATE sessions SET last_human_message_at = last_active_at WHERE last_human_message_at IS NULL",
        [],
    );

    // Create indexes for provider filtering
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider)",
        [],
    );
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_provider ON tasks(provider)",
        [],
    );
}

// ============================================================================
// Database connection
// ============================================================================

fn get_db() -> Result<std::sync::MutexGuard<'static, Connection>, DatabaseError> {
    DB.get()
        .ok_or_else(|| DatabaseError::NotFound("Database not initialized".to_string()))
        .and_then(|m| {
            m.lock()
                .map_err(|_| DatabaseError::NotFound("Database lock poisoned".to_string()))
        })
}

// ============================================================================
// Dynamic WHERE clause builder
// ============================================================================

/// Builds a dynamic WHERE clause from a list of conditions and boxed parameters.
/// Keeps the repeated pattern of (conditions Vec, params Vec, final assembly)
/// in one place.
struct WhereBuilder {
    conditions: Vec<String>,
    params: Vec<Box<dyn rusqlite::ToSql>>,
}

impl WhereBuilder {
    fn new() -> Self {
        Self {
            conditions: Vec::new(),
            params: Vec::new(),
        }
    }

    fn push(&mut self, condition: &str, param: impl rusqlite::ToSql + 'static) {
        self.conditions.push(condition.to_string());
        self.params.push(Box::new(param));
    }

    fn push_condition(&mut self, condition: String) {
        self.conditions.push(condition);
    }

    fn push_param(&mut self, param: impl rusqlite::ToSql + 'static) {
        self.params.push(Box::new(param));
    }

    fn is_empty(&self) -> bool {
        self.conditions.is_empty()
    }

    fn to_where_clause(&self) -> String {
        if self.conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", self.conditions.join(" AND "))
        }
    }

    fn param_refs(&self) -> Vec<&dyn rusqlite::ToSql> {
        self.params.iter().map(|p| p.as_ref()).collect()
    }
}

// ============================================================================
// Search query parsing
// ============================================================================

/// The set of columns searched against for text queries.
const SEARCH_FIELDS: [&str; 3] = ["s.first_prompt", "s.label", "s.project_name"];

/// Build a LIKE/NOT LIKE condition across all search fields.
/// `negate = false` produces `(field1 LIKE ? OR field2 LIKE ? ...)`.
/// `negate = true`  produces `(field1 NOT LIKE ? AND field2 NOT LIKE ? ...)`.
fn like_across_fields(pattern: &str, negate: bool, params: &mut Vec<String>) -> String {
    let (op, join) = if negate { ("NOT LIKE", " AND ") } else { ("LIKE", " OR ") };
    let conditions: Vec<String> = SEARCH_FIELDS
        .iter()
        .map(|field| {
            params.push(pattern.to_string());
            format!("{} {} ?", field, op)
        })
        .collect();
    format!("({})", conditions.join(join))
}

/// Tokenize search query, preserving quoted strings as single tokens.
/// Example: `foo "bar|baz" -test` -> `["foo", "\"bar|baz\"", "-test"]`
fn tokenize_search_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    /// Flush `current` into `tokens` if non-empty.
    fn flush(current: &mut String, tokens: &mut Vec<String>) {
        if !current.is_empty() {
            tokens.push(std::mem::take(current));
        }
    }

    for ch in query.chars() {
        match ch {
            '"' if in_quotes => {
                current.push('"');
                flush(&mut current, &mut tokens);
                in_quotes = false;
            }
            '"' => {
                flush(&mut current, &mut tokens);
                current.push('"');
                in_quotes = true;
            }
            ' ' | '\t' | '\n' if !in_quotes => {
                flush(&mut current, &mut tokens);
            }
            _ => {
                current.push(ch);
            }
        }
    }

    if !current.is_empty() {
        if in_quotes && !current.ends_with('"') {
            current.push('"');
        }
        tokens.push(current);
    }

    tokens
}

/// Parse search query with advanced syntax support.
///
/// Syntax:
/// - AND: `term1 term2` (space-separated, all must match)
/// - OR: `term1|term2` (pipe-separated, any can match)
/// - NOT: `-term` (exclude matches containing this term)
/// - LITERAL: `"term|with|pipes"` (quoted text, ignoring operators)
///
/// Returns (SQL condition string, parameter values).
fn parse_search_query(query: &str) -> (String, Vec<String>) {
    let mut and_conditions: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();

    for token in tokenize_search_query(query) {
        if token.is_empty() {
            continue;
        }

        if token.starts_with('"') && token.ends_with('"') && token.len() > 1 {
            // Literal search - remove quotes and search as-is
            let literal = &token[1..token.len()-1];
            if !literal.is_empty() {
                let pattern = format!("%{}%", literal);
                and_conditions.push(like_across_fields(&pattern, false, &mut params));
            }
        } else if let Some(term) = token.strip_prefix('-') {
            // NOT condition
            if !term.is_empty() {
                let pattern = format!("%{}%", term);
                and_conditions.push(like_across_fields(&pattern, true, &mut params));
            }
        } else if token.contains('|') {
            // OR condition
            let or_terms: Vec<&str> = token.split('|').filter(|t| !t.is_empty()).collect();
            if !or_terms.is_empty() {
                let or_conditions: Vec<String> = or_terms
                    .iter()
                    .map(|term| {
                        let pattern = format!("%{}%", term);
                        like_across_fields(&pattern, false, &mut params)
                    })
                    .collect();
                and_conditions.push(format!("({})", or_conditions.join(" OR ")));
            }
        } else {
            // Regular AND term
            let pattern = format!("%{}%", token);
            and_conditions.push(like_across_fields(&pattern, false, &mut params));
        }
    }

    if and_conditions.is_empty() {
        return (String::new(), Vec::new());
    }

    let condition = format!("({})", and_conditions.join(" AND "));
    (condition, params)
}

// ============================================================================
// Row mappers
// ============================================================================

/// Parse a provider column value, defaulting to Claude when absent or unrecognized.
fn parse_provider(row: &rusqlite::Row, index: usize) -> crate::providers::ProviderId {
    row.get::<_, String>(index)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(crate::providers::ProviderId::Claude)
}

/// Map a database row to a Session.
fn map_session_row(row: &rusqlite::Row) -> Result<Session, rusqlite::Error> {
    let status_str: String = row.get(17)?;
    let tags_str: Option<String> = row.get(5)?;
    let last_active_at: i64 = row.get(7)?;

    Ok(Session {
        session_id: row.get(0)?,
        project_path: row.get(1)?,
        project_name: row.get(2)?,
        first_prompt: row.get(3)?,
        label: row.get(4)?,
        tags: tags_str
            .map(|s| serde_json::from_str(&s).unwrap_or_default())
            .unwrap_or_default(),
        started_at: row.get(6)?,
        last_active_at,
        last_human_message_at: row.get::<_, Option<i64>>(8)?.unwrap_or(last_active_at),
        message_count: row.get(9)?,
        total_tokens: row.get(10)?,
        total_cost_usd: row.get(11)?,
        input_tokens: row.get::<_, Option<i64>>(12)?.unwrap_or(0),
        output_tokens: row.get::<_, Option<i64>>(13)?.unwrap_or(0),
        cache_read_tokens: row.get::<_, Option<i64>>(14)?.unwrap_or(0),
        cache_write_tokens: row.get::<_, Option<i64>>(15)?.unwrap_or(0),
        model: row.get(16)?,
        status: session_status_from_str(&status_str),
        provider: parse_provider(row, 18),
    })
}

fn map_task_row(row: &rusqlite::Row) -> Result<Task, rusqlite::Error> {
    let status_str: String = row.get(3)?;

    Ok(Task {
        id: row.get(0)?,
        prompt: row.get(1)?,
        project_path: row.get(2)?,
        status: status_str.parse().unwrap_or(TaskStatus::Backlog),
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
        provider: parse_provider(row, 22),
    })
}

fn map_favorite_row(row: &rusqlite::Row) -> Result<Favorite, rusqlite::Error> {
    Ok(Favorite {
        id: row.get(0)?,
        name: row.get(1)?,
        prompt: row.get(2)?,
        project_path: row.get(3)?,
        tags: row.get(4)?,
        sort_order: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

// ============================================================================
// Helpers
// ============================================================================

/// Check if file was modified within the last N seconds.
fn is_file_recently_modified(path: &std::path::Path, seconds: u64) -> bool {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| t.elapsed().unwrap_or_default().as_secs() < seconds)
        .unwrap_or(false)
}

/// Parse a date string (YYYY-MM-DD) into a millisecond timestamp at the given time.
fn date_to_ms(date_str: &str, h: u32, m: u32, s: u32) -> Option<i64> {
    chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(h, m, s))
        .map(|dt| dt.and_utc().timestamp_millis())
}

/// Parse a date string (YYYY-MM-DD) into a start-of-day millisecond timestamp.
fn date_to_start_ms(date_str: &str) -> Option<i64> {
    date_to_ms(date_str, 0, 0, 0)
}

/// Parse a date string (YYYY-MM-DD) into an end-of-day millisecond timestamp.
fn date_to_end_ms(date_str: &str) -> Option<i64> {
    date_to_ms(date_str, 23, 59, 59)
}

/// Get the next sort_order value for a table.
fn next_sort_order(conn: &Connection, table: &str) -> i32 {
    conn.query_row(
        &format!("SELECT COALESCE(MAX(sort_order), 0) FROM {}", table),
        [],
        |row| row.get::<_, i32>(0),
    )
    .unwrap_or(0) + 1
}

/// Update the FTS index for a session.
fn update_session_fts(conn: &Connection, session_id: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR REPLACE INTO sessions_fts (rowid, first_prompt, all_prompts, label, tags)
         SELECT rowid, first_prompt, first_prompt, label, tags FROM sessions WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(())
}

// ============================================================================
// Sessions
// ============================================================================

/// Get sessions from database
pub fn get_sessions(
    _app: &AppHandle,
    project: Option<&str>,
    limit: i64,
) -> Result<Vec<Session>, DatabaseError> {
    let conn = get_db()?;

    let mut wb = WhereBuilder::new();
    if let Some(proj) = project {
        wb.push("project_path = ?", proj.to_string());
    }
    wb.push_param(limit);

    let sql = format!(
        "SELECT {} FROM sessions {} ORDER BY last_human_message_at DESC LIMIT ?",
        SESSION_COLUMNS,
        wb.to_where_clause()
    );

    let mut stmt = conn.prepare(&sql)?;
    let sessions = stmt
        .query_map(rusqlite::params_from_iter(wb.param_refs()), map_session_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

/// Get session detail
pub fn get_session_detail(
    _app: &AppHandle,
    session_id: &str,
) -> Result<SessionDetail, DatabaseError> {
    let conn = get_db()?;

    let sql = format!(
        "SELECT {} FROM sessions WHERE session_id = ?1",
        SESSION_COLUMNS
    );
    let session = conn.query_row(&sql, params![session_id], map_session_row)?;

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
                images: vec![], // Images are loaded separately via get_session_images
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(SessionDetail { session, messages })
}

/// Get active sessions - scans file system to find truly active sessions.
/// This is the source of truth since database status can be stale.
pub fn get_active_sessions(_app: &AppHandle) -> Result<Vec<Session>, DatabaseError> {
    let conn = get_db()?;
    let projects_dir = crate::platform::get_claude_dir().join("projects");

    // Scan file system to find recently modified session files
    let active_session_ids = find_active_session_ids(&projects_dir);

    if active_session_ids.is_empty() {
        let _ = conn.execute("UPDATE sessions SET status = 'completed' WHERE status = 'active'", []);
        return Ok(Vec::new());
    }

    // Update these sessions to active status
    for session_id in &active_session_ids {
        let _ = conn.execute(
            "UPDATE sessions SET status = 'active' WHERE session_id = ?",
            params![session_id]
        );
    }

    // Mark stale "active" sessions as completed
    let placeholders: String = active_session_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        "UPDATE sessions SET status = 'completed' WHERE status = 'active' AND session_id NOT IN ({})",
        placeholders
    );
    let params: Vec<&dyn rusqlite::ToSql> = active_session_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let _ = conn.execute(&query, params.as_slice());

    // Fetch the active sessions
    let sql = format!(
        "SELECT {} FROM sessions WHERE session_id = ?",
        SESSION_COLUMNS
    );
    let mut result: Vec<Session> = Vec::new();
    for session_id in &active_session_ids {
        let mut stmt = conn.prepare(&sql)?;
        if let Ok(session) = stmt.query_row(params![session_id], map_session_row) {
            result.push(session);
        }
    }

    result.sort_by(|a, b| b.last_human_message_at.cmp(&a.last_human_message_at));
    Ok(result)
}

/// Scan the projects directory for recently modified .jsonl session files.
fn find_active_session_ids(projects_dir: &std::path::Path) -> Vec<String> {
    let mut ids = Vec::new();
    if !projects_dir.exists() {
        return ids;
    }

    let project_entries = match std::fs::read_dir(projects_dir) {
        Ok(entries) => entries,
        Err(_) => return ids,
    };

    for project_entry in project_entries.filter_map(|e| e.ok()) {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }

        let session_entries = match std::fs::read_dir(&project_path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for session_entry in session_entries.filter_map(|e| e.ok()) {
            let file_path = session_entry.path();
            let is_jsonl = file_path.extension().map(|e| e == "jsonl").unwrap_or(false);
            if is_jsonl && is_file_recently_modified(&file_path, 30) {
                if let Some(session_id) = file_path.file_stem().and_then(|s| s.to_str()) {
                    ids.push(session_id.to_string());
                }
            }
        }
    }

    ids
}

/// Insert or update a session
pub fn upsert_session(session: &Session) -> Result<(), DatabaseError> {
    let conn = get_db()?;

    let tags_json = serde_json::to_string(&session.tags).unwrap_or_default();
    let provider_str = session.provider.to_string().to_lowercase();

    conn.execute(
        &format!(
            "INSERT OR REPLACE INTO sessions ({})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            SESSION_COLUMNS
        ),
        params![
            session.session_id,
            session.project_path,
            session.project_name,
            session.first_prompt,
            session.label,
            tags_json,
            session.started_at,
            session.last_active_at,
            session.last_human_message_at,
            session.message_count,
            session.total_tokens,
            session.total_cost_usd,
            session.input_tokens,
            session.output_tokens,
            session.cache_read_tokens,
            session.cache_write_tokens,
            session.model,
            session_status_to_str(&session.status),
            provider_str,
        ],
    )?;

    update_session_fts(&conn, &session.session_id)?;
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

    update_session_fts(&conn, session_id)?;
    Ok(())
}

/// Delete a session and its messages
pub fn delete_session(
    _app: &AppHandle,
    session_id: &str,
) -> Result<(), DatabaseError> {
    let conn = get_db()?;

    conn.execute(
        "DELETE FROM sessions_fts WHERE rowid = (SELECT rowid FROM sessions WHERE session_id = ?1)",
        params![session_id],
    )?;
    conn.execute(
        "DELETE FROM session_messages WHERE session_id = ?1",
        params![session_id],
    )?;
    conn.execute(
        "DELETE FROM sessions WHERE session_id = ?1",
        params![session_id],
    )?;

    Ok(())
}

/// Get sessions for a specific date (for daily reports)
pub fn get_sessions_by_date(_app: &AppHandle, date: &str) -> Result<Vec<Session>, DatabaseError> {
    let conn = get_db()?;

    let start_ms = date_to_start_ms(date).unwrap_or(0);
    let end_ms = date_to_end_ms(date).unwrap_or(i64::MAX);

    let sql = format!(
        "SELECT {} FROM sessions
         WHERE started_at >= ?1 AND started_at <= ?2
         ORDER BY last_human_message_at DESC",
        SESSION_COLUMNS
    );

    let mut stmt = conn.prepare(&sql)?;
    let sessions: Vec<Session> = stmt
        .query_map(params![start_ms, end_ms], map_session_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

// ============================================================================
// Session search
// ============================================================================

/// Search sessions with advanced syntax support.
/// Syntax: `term1 term2` (AND), `term1|term2` (OR), `-term` (NOT)
pub fn search_sessions(
    _app: &AppHandle,
    query: &str,
    project: Option<&str>,
    limit: i64,
) -> Result<Vec<Session>, DatabaseError> {
    let conn = get_db()?;

    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let (search_condition, search_params) = parse_search_query(trimmed);
    if search_condition.is_empty() {
        return Ok(Vec::new());
    }

    let mut params: Vec<Box<dyn rusqlite::ToSql>> = search_params
        .into_iter()
        .map(|p| Box::new(p) as Box<dyn rusqlite::ToSql>)
        .collect();

    let where_clause = if let Some(proj) = project {
        params.push(Box::new(proj.to_string()));
        format!("{} AND s.project_path = ?", search_condition)
    } else {
        search_condition
    };

    params.push(Box::new(limit));

    let sql = format!(
        "SELECT {} FROM sessions s WHERE {} ORDER BY last_human_message_at DESC LIMIT ?",
        SESSION_COLUMNS, where_clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let sessions: Vec<Session> = stmt
        .query_map(rusqlite::params_from_iter(param_refs), map_session_row)?
        .filter_map(|r| r.ok())
        .collect();

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

    let mut wb = WhereBuilder::new();

    // Text search with advanced syntax
    if let Some(q) = query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            let (search_condition, search_params) = parse_search_query(trimmed);
            if !search_condition.is_empty() {
                wb.push_condition(search_condition);
                for p in search_params {
                    wb.push_param(p);
                }
            }
        }
    }

    if let Some(p) = project {
        wb.push("s.project_path = ?", p.to_string());
    }

    if let Some(s) = status {
        wb.push("s.status = ?", s.to_string());
    }

    if let Some(m) = model {
        wb.push("s.model LIKE ?", format!("%{}%", m));
    }

    if let Some(from) = date_from {
        if let Some(ts) = date_to_start_ms(from) {
            wb.push("s.last_active_at >= ?", ts);
        }
    }

    if let Some(to) = date_to {
        if let Some(ts) = date_to_end_ms(to) {
            wb.push("s.last_active_at <= ?", ts);
        }
    }

    let where_clause = wb.to_where_clause();
    wb.push_param(limit);

    let sql = format!(
        "SELECT {} FROM sessions s {} ORDER BY last_human_message_at DESC LIMIT ?",
        SESSION_COLUMNS, where_clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let sessions: Vec<Session> = stmt
        .query_map(rusqlite::params_from_iter(wb.param_refs()), map_session_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

// ============================================================================
// Usage stats
// ============================================================================

/// Get usage statistics from sessions table
pub fn get_usage_stats(
    _app: &AppHandle,
    project: Option<&str>,
    provider: Option<&str>,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<UsageStats, DatabaseError> {
    let conn = get_db()?;

    let mut wb = WhereBuilder::new();

    if let Some(proj) = project {
        wb.push("project_path = ?", proj.to_string());
    }
    if let Some(prov) = provider {
        wb.push("provider = ?", prov.to_string());
    }
    if let Some(start) = start_date {
        if let Some(ts) = date_to_start_ms(start) {
            wb.push("started_at >= ?", ts);
        }
    }
    if let Some(end) = end_date {
        if let Some(ts) = date_to_end_ms(end) {
            wb.push("started_at <= ?", ts);
        }
    }

    let where_clause = wb.to_where_clause();
    let param_refs = wb.param_refs();

    // Totals
    let totals_sql = format!(
        "SELECT COALESCE(SUM(total_tokens), 0),
                COALESCE(SUM(total_cost_usd), 0),
                COUNT(session_id),
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(cache_read_tokens), 0),
                COALESCE(SUM(cache_write_tokens), 0)
         FROM sessions {}",
        where_clause
    );

    let (total_tokens, total_cost_usd, session_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) =
        conn.query_row(&totals_sql, param_refs.as_slice(), |row| {
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

    // Daily breakdown
    let daily_sql = format!(
        "SELECT DATE(started_at / 1000, 'unixepoch') as date,
                SUM(total_tokens),
                SUM(total_cost_usd),
                COUNT(session_id)
         FROM sessions {}
         GROUP BY DATE(started_at / 1000, 'unixepoch')
         ORDER BY date DESC LIMIT 30",
        where_clause
    );

    let param_refs = wb.param_refs();
    let mut stmt = conn.prepare(&daily_sql)?;
    let daily_usage: Vec<DailyUsage> = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(DailyUsage {
                date: row.get(0)?,
                tokens: row.get(1)?,
                cost_usd: row.get(2)?,
                session_count: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Project breakdown
    let project_sql = format!(
        "SELECT project_path,
                SUM(total_tokens),
                SUM(total_cost_usd),
                COUNT(session_id)
         FROM sessions {}
         GROUP BY project_path
         ORDER BY SUM(total_cost_usd) DESC LIMIT 20",
        where_clause
    );

    let param_refs = wb.param_refs();
    let mut stmt = conn.prepare(&project_sql)?;
    let project_usage: Vec<ProjectUsage> = stmt
        .query_map(param_refs.as_slice(), |row| {
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

// ============================================================================
// Projects
// ============================================================================

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

// ============================================================================
// Tasks
// ============================================================================

/// Get tasks
pub fn get_tasks(
    _app: &AppHandle,
    status: Option<TaskStatus>,
    project: Option<&str>,
) -> Result<Vec<Task>, DatabaseError> {
    let conn = get_db()?;

    let mut wb = WhereBuilder::new();
    if let Some(s) = status {
        wb.push("status = ?", s.to_string());
    }
    if let Some(p) = project {
        wb.push("project_path = ?", p.to_string());
    }

    let order_by = if wb.is_empty() {
        "ORDER BY status, sort_order ASC"
    } else {
        "ORDER BY sort_order ASC"
    };

    let sql = format!("SELECT * FROM tasks {} {}", wb.to_where_clause(), order_by);
    let mut stmt = conn.prepare(&sql)?;
    let tasks = stmt
        .query_map(rusqlite::params_from_iter(wb.param_refs()), map_task_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tasks)
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
    let sort_order = next_sort_order(&conn, "tasks");

    conn.execute(
        "INSERT INTO tasks (id, prompt, project_path, status, priority, execution_mode, sort_order, created_at, notes)
         VALUES (?1, ?2, ?3, 'backlog', ?4, 'new', ?5, ?6, ?7)",
        params![id, prompt, project, priority, sort_order, now, notes],
    )?;

    Ok(Task {
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
        sort_order,
        result_exit_code: None,
        result_output: None,
        result_tokens: None,
        result_cost_usd: None,
        created_at: now,
        started_at: None,
        completed_at: None,
        provider: crate::providers::ProviderId::Claude,
    })
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

/// Update sort_order for rows in `table` based on the order of `ids`.
fn reorder_items(conn: &Connection, table: &str, ids: &[String]) -> Result<(), DatabaseError> {
    let sql = format!("UPDATE {} SET sort_order = ?1 WHERE id = ?2", table);
    for (index, id) in ids.iter().enumerate() {
        conn.execute(&sql, params![index as i32, id])?;
    }
    Ok(())
}

/// Reorder tasks by updating sort_order based on the order of task_ids
pub fn reorder_tasks(_app: &AppHandle, task_ids: Vec<String>) -> Result<(), DatabaseError> {
    let conn = get_db()?;
    reorder_items(&conn, "tasks", &task_ids)
}

// ============================================================================
// Favorites
// ============================================================================

/// Favorite prompt data model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Favorite {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub project_path: Option<String>,
    pub tags: Option<String>,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// Get all favorites
pub fn get_favorites(_app: &AppHandle) -> Result<Vec<Favorite>, DatabaseError> {
    let conn = get_db()?;

    let mut stmt = conn.prepare(
        "SELECT id, name, prompt, project_path, tags, sort_order, created_at, updated_at
         FROM favorites ORDER BY sort_order ASC"
    )?;

    let favorites: Vec<Favorite> = stmt
        .query_map([], map_favorite_row)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(favorites)
}

/// Create a new favorite
pub fn create_favorite(
    _app: &AppHandle,
    name: &str,
    prompt: &str,
    project_path: Option<&str>,
    tags: Option<&str>,
) -> Result<Favorite, DatabaseError> {
    let conn = get_db()?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let sort_order = next_sort_order(&conn, "favorites");

    conn.execute(
        "INSERT INTO favorites (id, name, prompt, project_path, tags, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, name, prompt, project_path, tags, sort_order, now, now],
    )?;

    Ok(Favorite {
        id,
        name: name.to_string(),
        prompt: prompt.to_string(),
        project_path: project_path.map(|s| s.to_string()),
        tags: tags.map(|s| s.to_string()),
        sort_order,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Update a favorite using a single dynamic UPDATE query.
pub fn update_favorite(
    _app: &AppHandle,
    id: &str,
    name: Option<&str>,
    prompt: Option<&str>,
    project_path: Option<Option<&str>>,
    tags: Option<&str>,
) -> Result<Favorite, DatabaseError> {
    let conn = get_db()?;
    let now = chrono::Utc::now().to_rfc3339();

    let mut set_clauses: Vec<String> = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(n) = name {
        set_clauses.push("name = ?".to_string());
        params_vec.push(Box::new(n.to_string()));
    }

    if let Some(p) = prompt {
        set_clauses.push("prompt = ?".to_string());
        params_vec.push(Box::new(p.to_string()));
    }

    if let Some(pp) = project_path {
        set_clauses.push("project_path = ?".to_string());
        params_vec.push(Box::new(pp.map(|s| s.to_string())));
    }

    if let Some(t) = tags {
        set_clauses.push("tags = ?".to_string());
        params_vec.push(Box::new(t.to_string()));
    }

    if !set_clauses.is_empty() {
        set_clauses.push("updated_at = ?".to_string());
        params_vec.push(Box::new(now));
        params_vec.push(Box::new(id.to_string()));

        let sql = format!(
            "UPDATE favorites SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    let favorite = conn.query_row(
        "SELECT id, name, prompt, project_path, tags, sort_order, created_at, updated_at
         FROM favorites WHERE id = ?1",
        params![id],
        map_favorite_row,
    )?;

    Ok(favorite)
}

/// Delete a favorite
pub fn delete_favorite(_app: &AppHandle, id: &str) -> Result<(), DatabaseError> {
    let conn = get_db()?;
    conn.execute("DELETE FROM favorites WHERE id = ?1", params![id])?;
    Ok(())
}

/// Reorder favorites
pub fn reorder_favorites(_app: &AppHandle, favorite_ids: Vec<String>) -> Result<(), DatabaseError> {
    let conn = get_db()?;
    reorder_items(&conn, "favorites", &favorite_ids)
}

/// Get all images from a session by parsing its JSONL file
pub fn get_session_images(
    _app: &AppHandle,
    session_id: &str,
) -> Result<Vec<crate::session::ImageContent>, DatabaseError> {
    let conn = get_db()?;

    // Get project_path for this session
    let project_path: String = conn.query_row(
        "SELECT project_path FROM sessions WHERE session_id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;

    // Find JSONL file
    let projects_dir = crate::platform::get_claude_dir().join("projects");
    let session_file = projects_dir
        .join(urlencoding::encode(&project_path).into_owned())
        .join(format!("{}.jsonl", session_id));

    if !session_file.exists() {
        return Ok(vec![]);
    }

    // Parse JSONL and extract images from both message.content and line.content (older format)
    let lines = crate::session::parse_session_file(&session_file)?;
    let images = lines
        .iter()
        .flat_map(|line| {
            let msg_content = line.message.as_ref().and_then(|m| m.content.as_ref());
            let line_content = line.content.as_ref();
            msg_content.into_iter().chain(line_content).flat_map(extract_images_from_json)
        })
        .collect();

    Ok(images)
}

/// Helper function to extract images from JSON content
fn extract_images_from_json(content: &serde_json::Value) -> Vec<crate::session::ImageContent> {
    /// Get a string field from a JSON object, returning an owned String.
    fn str_field(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
        obj.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
    }

    let arr = match content {
        serde_json::Value::Array(arr) => arr,
        _ => return Vec::new(),
    };

    arr.iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            if obj.get("type").and_then(|t| t.as_str()) != Some("image") {
                return None;
            }
            let source = obj.get("source").and_then(|s| s.as_object())?;
            Some(crate::session::ImageContent {
                source_type: str_field(source, "type").unwrap_or_else(|| "base64".to_string()),
                media_type: str_field(source, "media_type"),
                data: str_field(source, "data"),
                path: str_field(source, "path"),
            })
        })
        .collect()
}
