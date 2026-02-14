# Alice - Claude Code Desktop Assistant

> A lightweight menu bar application for managing Claude Code tasks, sessions, and workflows across all local projects.

## 1. Project Vision

Alice is a macOS menu bar desktop assistant that wraps around Claude Code (CC), providing a **visual control plane** for the CLI-first workflow. It solves the core pain point: CC is powerful but blind — you can't see what's happening across sessions, can't queue work, can't get notified when done, and can't manage multiple projects from one place.

### Target User

Individual developer using CC daily across 2-5+ local projects, who wants:
- See all CC activity at a glance without switching terminals
- Queue tasks and get notified on completion
- Search history and resume sessions instantly
- Track usage/cost across projects and time
- Manage task backlog and execution queue from one place

---

## 2. Pain Points Addressed (from Community Research)

Based on research from GitHub issues, community discussions, and user workflows:

| # | Pain Point | Source | Alice Solution |
|---|---|---|---|
| 1 | **No task completion notification** — users tab-switch away and miss when CC finishes | [GitHub #7069](https://github.com/anthropics/claude-code/issues/7069) | Native macOS notifications + menu bar status indicator |
| 2 | **No task queue** — can't say "after this, do that" | Community requests | Task queue with chaining and auto-execution |
| 3 | **Session search is painful** — `--resume` shows a list but no search, no preview | [GitHub #4707](https://github.com/anthropics/claude-code/issues/4707) | Full-text search across all sessions with preview |
| 4 | **No per-project usage tracking** — `/cost` only shows current session | [ccusage](https://github.com/ryoppippi/ccusage) | Per-project, per-day, per-session usage dashboards |
| 5 | **Context loss after compact** — CC forgets what it was doing | [GitHub #2954](https://github.com/anthropics/claude-code/issues/2954) | Persistent task backlog external to CC sessions |
| 6 | **No multi-project overview** — each terminal is isolated | [GitHub #4689](https://github.com/anthropics/claude-code/issues/4689) | Unified cross-project dashboard |
| 7 | **No daily reporting** — hard to recall what CC helped with | [GitHub #12455](https://github.com/anthropics/claude-code/issues/12455) | Auto-generated daily report from sessions + git commits |
| 8 | **Todo lists vanish** — CC's TodoWrite is session-scoped | Community workaround: plan.md files | Unified task backlog persisted outside CC sessions |
| 9 | **Background task discovery** — can't list running CC processes | [GitHub #7069](https://github.com/anthropics/claude-code/issues/7069) | Process monitor for all CC instances |
| 10 | **Session naming** — auto-generated names are unusable | [GitHub #4707](https://github.com/anthropics/claude-code/issues/4707) | Custom session labels/tags |

---

## 3. Technical Architecture

### 3.1 Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Desktop Shell** | Tauri 2.0 (Rust) | ~10MB bundle, ~30MB RAM idle, <0.5s startup, native tray support (macOS + Windows) |
| **Frontend** | React + TypeScript + Tailwind CSS | Fast UI dev, rich ecosystem, Tauri has official React template |
| **State Management** | Zustand | Lightweight, no boilerplate, good for menu bar apps |
| **Local DB** | SQLite (via `rusqlite` in Tauri backend) | Fast indexed search over session history, usage data |
| **File Watching** | `notify` crate (Rust, cross-platform FSEvents wrapper) | Watch `~/.claude/` for real-time session changes |
| **CC Integration** | CLI subprocess + local file parsing | Read JSONL transcripts, invoke `claude -p` for headless tasks |
| **Notifications** | Tauri notification plugin (macOS + Windows Toast) | System notifications with action buttons |
| **Target Platforms** | macOS 12+ (primary), Windows 10 1809+ (supported) | macOS-first development, Windows with UI fallbacks (see UI_SPEC.md §6.2) |

### 3.2 System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Alice (Tauri App)                         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  Menu Bar UI │  │   Popup Panel    │  │   Full Window     │  │
│  │  (React)     │  │   (React)        │  │   (React)         │  │
│  │  - Status    │  │   - Task list    │  │   - History       │  │
│  │  - Quick     │  │   - Active CC    │  │   - Usage charts  │  │
│  │    actions   │  │   - Tasks/Queue  │  │   - Daily report  │  │
│  │              │  │   - Notifications│  │   - Settings      │  │
│  └──────┬───────┘  └────────┬─────────┘  └────────┬──────────┘  │
│         │                   │                      │             │
│  ┌──────┴───────────────────┴──────────────────────┴──────────┐  │
│  │                     Tauri IPC Bridge                        │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                             │                                     │
│  ┌──────────────────────────┴──────────────────────────────────┐  │
│  │                    Rust Backend Core                         │  │
│  │                                                              │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────┐  │  │
│  │  │ File Watcher│ │Session Parser│ │ Process Manager      │  │  │
│  │  │ (~/.claude/)│ │ (JSONL→Data) │ │ (spawn/monitor CC)   │  │  │
│  │  └─────────────┘ └──────────────┘ └──────────────────────┘  │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────┐  │  │
│  │  │ SQLite DB   │ │ Usage Calc   │ │ Notification Engine  │  │  │
│  │  │ (index/task)│ │ (token/cost) │ │ (macOS/Win native)   │  │  │
│  │  └─────────────┘ └──────────────┘ └──────────────────────┘  │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────┐  │  │
│  │  │ Task Queue  │ │ Report Gen   │ │ CC CLI Wrapper       │  │  │
│  │  │ (chain/exec)│ │ (daily/week) │ │ (claude -p ...)      │  │  │
│  │  └─────────────┘ └──────────────┘ └──────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                             │                                     │
└─────────────────────────────┼─────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    ┌─────┴──────┐  ┌────────┴───────┐  ┌───────┴────────┐
    │ ~/.claude/  │  │ claude CLI     │  │ git repos      │
    │ sessions/  │  │ (subprocess)   │  │ (commit history)│
    │ history    │  │                │  │                 │
    │ stats      │  │                │  │                 │
    └────────────┘  └────────────────┘  └────────────────┘
```

### 3.3 Data Flow

```
1. File Watcher monitors ~/.claude/ directory
   ↓
2. On change → Session Parser reads JSONL, extracts:
   - Session metadata (project, start time, status)
   - Token usage (input/output/cache per message)
   - Tool calls and results
   - User prompts (for search indexing)
   ↓
3. Data indexed into SQLite for fast search
   ↓
4. Frontend updated via Tauri events (push model)
   ↓
5. User actions → Tauri commands → Rust backend → CLI subprocess
```

---

## 4. Feature Specification

### 4.1 Task Tracking & Completion Notification

**What it does**: Monitor all active CC sessions across all projects, show their status in real-time, and send macOS notifications when tasks complete or need input.

**Implementation**:

```
Data Source: ~/.claude/projects/*/  (file watcher on all project dirs)
Detection:
  - Active session: JSONL file is being written to (mtime changing)
  - Waiting for input: Last message is "assistant" type with no pending tool call
  - Completed: Session file stops updating for >30s after assistant message
  - Error: System type message with error subtype
```

**UI Elements**:
- Menu bar icon changes color: gray(idle) / blue(running) / green(done) / yellow(needs input) / red(error)
- Menu bar shows count of active sessions: `CC ⟨3⟩`
- Popup panel: List of active sessions with project name, prompt preview, duration, status
- macOS notification on completion: "Task completed in ProjectA: Refactored auth module (3m 42s)"

**Notification Types** (configurable):
| Event | Default | Action |
|---|---|---|
| Task completed | ON | Click → copy resume command to clipboard + open Alice |
| Needs user input | ON (with sound) | Click → copy `claude --resume <id>` to clipboard |
| Task error | ON | Click → view error detail in Alice panel |
| Queue item started | ON | Informational |
| Daily report ready | ON | Click → view report in Alice |

> **Terminal integration note**: macOS notifications can't directly activate arbitrary terminal windows. Phase 1 uses clipboard-based workflow (copy resume command). Phase 2 will add AppleScript integration for iTerm2 and Terminal.app to auto-focus the correct window.

### 4.2 Unified Tasks System

**What it does**: A single task management system combining backlog (what you want CC to do later) and execution queue (what CC runs next). Replaces separate "Todo" and "Queue" features with one unified flow.

**Status Flow**:
```
Backlog → Queued → Running → Completed/Failed
```

- **Backlog**: Ideas and tasks to do later. User-managed, no execution.
- **Queued**: Tasks ready for sequential execution. Alice runs them automatically.
- **Running**: Currently being executed by CC subprocess.
- **Completed/Failed**: Done. Results stored for review.

**Data Model**:
```typescript
interface Task {
  id: string;
  prompt: string;                    // The instruction for CC
  project: string;                   // Absolute path to project dir
  status: 'backlog' | 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  priority: 'high' | 'medium' | 'low';
  executionMode: 'continue' | 'new'; // Same session or new
  dependsOn?: string;               // ID of predecessor task
  sessionId?: string;               // Assigned when started
  systemPrompt?: string;            // Optional override
  allowedTools?: string[];           // Tool restrictions
  maxBudget?: number;               // USD limit
  maxTurns?: number;                // Turn limit
  notes?: string;                   // Additional context
  tags?: string[];                  // Categorization
  sortOrder: number;                // Position in list
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: {
    exitCode: number;
    output: string;                  // Summary from --output-format json
    tokensUsed: number;
    costUsd: number;
  };
}
```

**Execution Logic**:
```
1. User moves tasks from Backlog → Queued (drag or button)
2. Alice starts first queued task:
   claude -p "Task prompt" --output-format json --max-turns 50 \
     --cwd /path/to/project
3. On completion → parse JSON output → store result
4. If success → start next queued task (--continue if same session, new if different)
5. If failure → pause queue, notify user, offer: retry / skip / abort
```

**UI**: Tasks view with two sections — Backlog (top, manual ordering) and Queue (bottom, execution chain with drag-to-reorder). Quick-add from keyboard shortcut `Cmd+N`. One-click "Queue" button to move backlog items to execution.

> **Note**: AI-powered task planning (CC reads backlog → generates execution plan) is deferred to Phase 3 as optional enhancement. v1 uses manual drag-to-queue.

### 4.3 Session History Search & Resume

**What it does**: Full-text search across all CC sessions from all projects, with preview and one-click resume.

**Data Source**:
```
~/.claude/history.jsonl          → Master index (prompt, project, sessionId, timestamp)
~/.claude/projects/*//*.jsonl  → Full transcripts (for deep search)
```

**SQLite Index Schema**:
```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,      -- Extracted from path
  first_prompt TEXT,                -- User's opening message
  all_prompts TEXT,                 -- All user messages concatenated (FTS)
  label TEXT,                       -- User-assigned name
  tags TEXT,                        -- User-assigned tags (JSON array)
  started_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  message_count INTEGER,
  total_tokens INTEGER,
  total_cost_usd REAL,
  model TEXT,
  status TEXT                       -- 'active', 'completed', 'error'
);

CREATE VIRTUAL TABLE sessions_fts USING fts5(
  first_prompt, all_prompts, label, tags,
  content=sessions, content_rowid=rowid
);

CREATE TABLE session_messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- 'user', 'assistant', 'system'
  content TEXT,
  timestamp INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
```

**Search Features**:
- Instant fuzzy search as you type
- Filter by: project, date range, model, status
- Preview: first 3 messages of matching session
- Actions: Resume (`claude --resume <id>`), Fork (`--fork-session`), Copy session ID, Delete

**UI**: Search bar at top of popup panel, results as cards showing project badge, prompt preview, date, token count.

### 4.4 Usage Dashboard

**What it does**: Track and visualize CC usage at project, session, and time granularity.

**Data Sources**:
```
1. ~/.claude/stats-cache.json          → Daily aggregate stats
2. ~/.claude/projects/*/*.jsonl        → Per-message token counts from API responses
3. ~/.claude/telemetry/*               → Additional usage data
```

**Token/Cost Extraction** (from each assistant message in JSONL, **verified against actual local files**):
```json
{
  "message": {
    "usage": {
      "input_tokens": 10,
      "cache_creation_input_tokens": 28649,
      "cache_read_input_tokens": 0,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 0,
        "ephemeral_1h_input_tokens": 28649
      },
      "output_tokens": 1,
      "service_tier": "standard",
      "inference_geo": "not_available"
    },
    "model": "claude-opus-4-5-20251101"
  }
}
```
> Note: `cache_creation` sub-object distinguishes 5-minute vs 1-hour cache, enabling precise cost calculation. `service_tier` and `inference_geo` can be used for pricing adjustments.

**Cost Calculation** (using published Anthropic API pricing, per 1M tokens):
```typescript
const PRICING = {
  'claude-opus-4-6': {
    input:        5.0,    output:       25.0,
    cache_5min:   6.25,   cache_1h:    10.0,   cache_read: 0.50,
    // Long context (>200K tokens): input 10.0, output 37.50
    long_input:  10.0,    long_output:  37.5,
  },
  'claude-sonnet-4-5': {
    input:        3.0,    output:       15.0,
    cache_5min:   3.75,   cache_1h:     6.0,   cache_read: 0.30,
    long_input:   6.0,    long_output:  22.5,
  },
  'claude-haiku-4-5': {
    input:        1.0,    output:        5.0,
    cache_5min:   1.25,   cache_1h:     2.0,   cache_read: 0.10,
    long_input:   1.0,    long_output:   5.0,   // No long context surcharge
  },
};
```

**Cache write duration detection** — JSONL usage object includes:
```json
{
  "cache_creation": {
    "ephemeral_5m_input_tokens": 0,    // 5-minute cache (1.25x base)
    "ephemeral_1h_input_tokens": 28649 // 1-hour cache (2x base)
  }
}
```
Alice can distinguish 5min vs 1h cache writes from this field and apply correct pricing.

**Dashboard Views**:
| View | Data | Visualization |
|---|---|---|
| Today | Active sessions, tokens so far, estimated cost | Live counter |
| This Week | Daily breakdown by project | Stacked bar chart |
| This Month | Weekly trends, top projects | Line chart + project table |
| Per Project | All-time stats for selected project | Summary cards |
| Per Session | Token breakdown for specific session | Pie chart (in/out/cache) |

**Note for Max/Pro subscribers**: Show token counts and session counts even if cost is included in subscription, with a toggle to show/hide estimated cost equivalent.

### 4.5 Daily Report

**What it does**: Auto-generate a daily summary of all CC-assisted work across all projects. v1 uses structured auto-generation (no AI API call); AI-powered narrative summaries planned for Phase 3.

**Data Collection** (runs at user-configured time, default 18:00):
```
1. Sessions today:
   - Parse all session JSONLs with today's timestamps
   - Extract: prompts, session duration, status

2. Git commits today:
   - For each tracked project: git log --since="today 00:00" --format="%H|%s|%an|%ai"
   - Filter for CC-assisted commits (Co-Authored-By: Claude)

3. Usage today:
   - Total tokens, cost, session count per project
```

**Report Generation (v1 — auto-generated, no AI call)**:
```markdown
# Daily Report — 2026-02-14

## Sessions (5)
- **ProjectA**: "Refactor auth module" — completed, 12K tokens, $0.32
- **ProjectA**: "Add unit tests for auth" — completed, 8K tokens, $0.21
- **ProjectB**: "Fix login page CSS" — completed, 3K tokens, $0.08
...

## Git Commits (CC-assisted)
- ProjectA: `abc1234` — Refactor auth module to use JWT
- ProjectA: `def5678` — Add auth module tests (95% coverage)
- ProjectB: `ghi9012` — Fix responsive layout on login page

## Usage Summary
| Project | Sessions | Tokens | Cost |
|---------|----------|--------|------|
| ProjectA | 3 | 28K | $0.72 |
| ProjectB | 2 | 5K | $0.13 |
| **Total** | **5** | **33K** | **$0.85** |

## Queued Tasks (3 pending)
- "Optimize database queries" (ProjectA)
- "Add error handling to API" (ProjectA)
- "Write README for new module" (ProjectB)
```

**Delivery**:
- Show in Alice panel (rendered markdown)
- Copy to clipboard as markdown
- Optional: Auto-append to a daily log file (configurable path)

> **Phase 3 Enhancement**: Optional "AI Summary" toggle that calls CC to generate a narrative 2-3 sentence summary at the top of the report. Uses `claude -p --model haiku --max-turns 1` to minimize cost.

---

## 5. Data Architecture

### 5.1 Alice's Own Storage

```
~/.alice/                           # Alice application data
  config.json                       # User preferences
  alice.db                          # SQLite database (sessions index, tasks, usage cache)
  reports/                          # Generated daily reports
    2026-02-14.md
  logs/                             # Application logs
```

### 5.2 SQLite Schema (Complete)

```sql
-- Session index (synced from ~/.claude/)
CREATE TABLE sessions (...);        -- See 4.3 above
CREATE TABLE session_messages (...); -- See 4.3 above

-- Usage tracking
CREATE TABLE usage_records (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  date TEXT NOT NULL,                -- YYYY-MM-DD
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_date ON usage_records(date);
CREATE INDEX idx_usage_project ON usage_records(project_path);
CREATE INDEX idx_sessions_project ON sessions(project_path, last_active_at DESC);

-- Unified tasks system (backlog + queue in one table)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  project_path TEXT,
  status TEXT DEFAULT 'backlog',     -- 'backlog', 'queued', 'running', 'completed', 'failed', 'skipped'
  priority TEXT DEFAULT 'medium',    -- 'high', 'medium', 'low'
  execution_mode TEXT DEFAULT 'new', -- 'continue' (same session) or 'new'
  depends_on TEXT,                   -- ID of predecessor task
  session_id TEXT,                   -- Assigned when execution starts
  system_prompt TEXT,
  allowed_tools TEXT,                -- JSON array
  max_budget_usd REAL,
  max_turns INTEGER,
  notes TEXT,                        -- Additional context
  tags TEXT,                         -- JSON array
  sort_order INTEGER NOT NULL,
  result_exit_code INTEGER,
  result_output TEXT,
  result_tokens INTEGER,
  result_cost_usd REAL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX idx_tasks_status ON tasks(status, sort_order);
CREATE INDEX idx_tasks_project ON tasks(project_path, status);

-- Daily reports
CREATE TABLE daily_reports (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  content_md TEXT NOT NULL,
  sessions_count INTEGER,
  commits_count INTEGER,
  total_tokens INTEGER,
  total_cost_usd REAL,
  generated_at TEXT NOT NULL
);

-- Project registry
CREATE TABLE projects (
  path TEXT PRIMARY KEY,
  display_name TEXT,
  last_active_at TEXT,
  total_sessions INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0
);
```

### 5.3 CC File Parsing Strategy

**JSONL Transcript Parser** (Rust):
```
For each line in .jsonl:
  1. Parse JSON
  2. Match on "type" field:
     - "user" → extract prompt text, timestamp
     - "assistant" → extract usage (tokens), model, content
     - "system" → detect errors, api_error, compaction events
  3. Build session metadata incrementally
  4. Emit events to frontend via Tauri events
```

**Performance Considerations**:
- JSONL files can be large (100KB-10MB+)
- Use incremental parsing: track file offset, only read new lines
- Index in SQLite on first scan, incremental updates after
- File watcher debouncing: batch updates within 500ms window

---

## 6. UI Design

### 6.1 Menu Bar Icon

```
States:
  ● (gray)     — No active sessions
  ● (blue)     — Sessions running
  ● (green)    — Recent completion
  ● (yellow)   — Needs user input
  ● (red)      — Error occurred

With count badge: CC⟨3⟩ = 3 active sessions
```

### 6.2 Popup Panel (click on menu bar icon)

```
┌─────────────────────────────────────┐
│ 🔍 Search sessions...         ⌘K   │
├─────────────────────────────────────┤
│ ▸ ACTIVE (2)                        │
│   ┌─────────────────────────────┐   │
│   │ 🔵 ProjectA                 │   │
│   │ "Refactor auth module..."   │   │
│   │ ⏱ 3m 42s  📊 12K tokens    │   │
│   └─────────────────────────────┘   │
│   ┌─────────────────────────────┐   │
│   │ 🟡 ProjectB                 │   │
│   │ "Fix login page CSS..."     │   │
│   │ ⏱ 1m 15s  ⚠ Needs input    │   │
│   └─────────────────────────────┘   │
├─────────────────────────────────────┤
│ ▸ TASKS (8)                         │
│   ▶ Queue (3): Next → "Add tests…" │
│   ◻ Backlog (5)                     │
├─────────────────────────────────────┤
│ 📊 Today: 45K tokens · $0.82       │
│ ━━━━━━━━━━━━━━━━━━━░░░░░ 3 sessions │
├─────────────────────────────────────┤
│ [📋 Report] [📊 Usage] [⚙ Settings]│
└─────────────────────────────────────┘
```

### 6.3 Full Window (for detailed views)

Tabs: **Active** | **Tasks** | **Usage** | **History** | **Config**

- **Active**: Cross-project session overview with real-time status
- **Tasks**: Unified backlog + queue management
- **Usage**: Charts and tables for token/cost analytics + OAuth meters
- **History**: Full session list with search, filters, session detail view
- **Config**: Notification preferences, project paths, API pricing, hotkeys, report schedule

---

## 7. Cross-Project Architecture

### 7.1 Project Discovery

```
Auto-discover projects from:
1. ~/.claude/projects/ directory → all encoded project paths
2. ~/.claude/history.jsonl → all unique project paths
3. Manual registration in Alice settings

Each discovered project gets:
- Display name (extracted from path, user can rename)
- Color tag (for visual distinction in UI)
- CC config info (from CLAUDE.md if present)
```

### 7.2 Unified Data Model

All features work across projects by default:
- Session search spans all projects (with project filter)
- Usage dashboard shows per-project breakdown
- Tasks can be project-specific or global, queue chains across different projects
- Daily report aggregates all projects

---

## 8. Key Technical Challenges & Solutions

### 8.1 Detecting Session State Without API

**Challenge**: CC doesn't expose a "running sessions" API. How to know what's active?

**Solution**: Layered detection strategy (in priority order):

```
Primary — Hooks-based (most reliable):
  Install CC hooks (SessionStart, Stop, SessionEnd) that write events to
  ~/.alice/hooks-events.jsonl. Real-time, structured state changes.
  Auto-configured in ~/.claude/settings.json on Alice first run.

Secondary — File watching (fallback, always-on):
  1. File mtime: *.jsonl mtime changed in last 10s → likely active
  2. Last message analysis: Parse last JSONL entry:
     - assistant with stop_reason=null → still streaming
     - assistant with stop_reason="end_turn" → completed or waiting
  3. Tail read last 3 entries to determine conversation flow state

Tertiary — Process detection (for cross-validation):
  `ps -eo pid,command | grep "[c]laude"` (bracket trick avoids self-match)
  Match PID to session via lsof on the JSONL file
```

### 8.2 Real-time Updates Without Polling

**Challenge**: Need to update UI when sessions change without expensive polling.

**Solution**: Rust `notify` crate watches `~/.claude/projects/` recursively:
```rust
use notify::{Watcher, RecursiveMode, watcher};

let (tx, rx) = channel();
let mut watcher = watcher(tx, Duration::from_millis(500))?;
watcher.watch(claude_dir, RecursiveMode::Recursive)?;

for event in rx {
    match event {
        DebouncedEvent::Write(path) | DebouncedEvent::Create(path) => {
            if path.extension() == Some("jsonl") {
                // Parse new lines, update index, push to frontend
                tauri_app.emit("session-updated", session_data);
            }
        }
        _ => {}
    }
}
```

### 8.3 Headless CC Execution for Task Queue

**Challenge**: Run CC tasks programmatically, capture results, handle errors.

**Solution**: Subprocess management with output parsing:
```rust
use std::process::Command;

let output = Command::new("claude")
    .args(&[
        "-p", &task.prompt,
        "--output-format", "json",
        "--max-turns", &task.max_turns.to_string(),
        "--cwd", &task.project_path,
    ])
    .output()?;

let result: serde_json::Value = serde_json::from_slice(&output.stdout)?;
let session_id = result["session_id"].as_str();
let response = result["result"].as_str();
```

### 8.4 Large JSONL File Handling

**Challenge**: Session files can be 10MB+, full parsing is expensive.

**Solution**: Timestamp-based incremental parsing (robust against compaction):
```rust
struct SessionTracker {
    path: PathBuf,
    last_processed_ts: i64,  // Timestamp of last processed entry
    file_size: u64,          // For quick "has file grown?" check
}

impl SessionTracker {
    fn read_new_entries(&mut self) -> Vec<JsonLine> {
        let metadata = fs::metadata(&self.path)?;
        let current_size = metadata.len();

        // Fast path: file hasn't changed
        if current_size == self.file_size { return vec![]; }

        // If file shrank (compaction happened), re-parse from start
        if current_size < self.file_size {
            self.last_processed_ts = 0;
        }

        let file = File::open(&self.path)?;
        let reader = BufReader::new(file);
        let mut new_entries = Vec::new();

        for line in reader.lines() {
            let entry: JsonLine = serde_json::from_str(&line?)?;
            if entry.timestamp > self.last_processed_ts {
                self.last_processed_ts = entry.timestamp;
                new_entries.push(entry);
            }
        }

        self.file_size = current_size;
        new_entries
    }
}
```
> Compaction-safe: If a session file is compacted (shrinks), the parser re-scans from scratch using timestamp dedup. Normal appends use the fast "new lines only" path.

### 8.5 Concurrency & Data Safety

**SQLite Write Serialization**:
Multiple Rust threads (file watcher, process monitor, queue executor) may write to SQLite concurrently. Solution: single-writer architecture with channel-based message passing.

```rust
// All DB writes go through a single channel
enum DbCommand {
    UpdateSession(SessionData),
    UpdateUsage(UsageRecord),
    UpdateTask(TaskUpdate),
}

// Single writer thread
fn db_writer(rx: Receiver<DbCommand>, db: Connection) {
    for cmd in rx {
        match cmd {
            DbCommand::UpdateSession(s) => { /* upsert session */ },
            // ...
        }
    }
}
```

**Multi-Instance Prevention**: Lock file at `~/.alice/alice.lock` with PID. On startup, check if existing PID is alive; if so, bring existing instance to front.

**Queue Crash Recovery**: Queue state persisted to DB on every state change. On startup, check for orphaned `running` items → mark as `interrupted`, notify user to retry or skip.

### 8.6 Edge Cases

| Scenario | Handling |
|---|---|
| Project directory deleted | Session marked as "archived project", still searchable |
| Manual CC usage during queue | Queue pauses if conflict detected on same project; parallel on different projects is fine |
| JSONL file corrupted (malformed line) | Skip bad lines, log warning, continue parsing rest |
| CC CLI version mismatch | Version check on startup, warn if incompatible, store version in config |
| `~/.claude/` has 100+ projects | Selective watching: only watch active projects (mtime < 30 days), configurable |
| macOS permissions denied | First-run wizard requests file access; graceful degradation if denied |
| CC subscription (Max/Pro) | Token data is still written to JSONL (verified); show tokens + optional cost equivalent |

### 8.7 Schema Migrations

Use embedded migration system in Rust (e.g., `refinery` crate):
```
migrations/
  V001__initial_schema.sql
  V002__add_session_labels.sql
  V003__add_long_context_pricing.sql
```

On app startup, auto-apply pending migrations. Schema version stored in `alice.db` metadata table.

---

## 9. Development Plan

### Phase 1: Foundation (Week 1-2)

**Goal**: Basic Tauri menu bar app with session monitoring

| Task | Description |
|---|---|
| Project scaffolding | `npm create tauri-app@latest alice -- --template react-ts` |
| Menu bar tray setup | Tauri tray icon with basic context menu |
| Popup panel shell | React popup window with tabs skeleton |
| JSONL parser (Rust) | Parse CC session transcripts, extract metadata (**with streaming dedup by message.id + requestId**) |
| File watcher | Watch `~/.claude/` with `notify` crate |
| Session list UI | Display active/recent sessions from file data |

**Deliverable**: Menu bar app that shows list of recent CC sessions.

### Phase 2: Core Features (Week 3-4)

**Goal**: Notifications, search, usage meters, and task backlog

| Task | Description |
|---|---|
| Notification engine | macOS/Windows native notifications on session events |
| Session state detection | Multi-signal active/idle/done detection |
| SQLite integration | Set up database, indexer, FTS |
| Session search UI | Search bar with instant results |
| Session resume | One-click resume via `claude --resume` |
| Task backlog CRUD | Unified tasks system with backlog + manual queue |
| Quick-add hotkey | Global hotkey `Cmd+N` for task entry |
| **OAuth usage API** | **Fetch live session/weekly usage % from `api.anthropic.com/api/oauth/usage`** (ref: CodexBar) |
| **5-hour window tracking** | **Track session window usage and reset countdown** (ref: ccusage) |
| **Two-bar meter icon** | **Menu bar icon shows session + weekly usage bars** (ref: CodexBar) |

**Deliverable**: Functional assistant with notifications, search, tasks backlog, and live usage meters.

### Phase 3: Power Features (Week 5-7)

**Goal**: Task queue execution, cost tracking, daily report, multi-account

| Task | Description |
|---|---|
| Task queue engine | Queue execution loop: backlog → queued → running, error handling, crash recovery |
| Task queue UI | Visual queue editor with drag-reorder, pause/resume |
| Usage calculator | Token/cost extraction from JSONL transcripts |
| Usage dashboard UI | Charts (CSS-based bars for v1) |
| **Burn rate prediction** | **Estimate when user will hit session/weekly limits** (ref: Claude-Code-Usage-Monitor) |
| Auto daily report | Collect sessions + git commits, generate structured report (no AI call) |
| Report UI | Report viewer with markdown rendering |
| **AI task planning** (optional) | **CC-powered: select backlog items → generate execution plan** (deferred from original Feature 6) |
| **AI report summary** (optional) | **CC call to add narrative summary to daily report** (uses haiku, ~$0.01/call) |
| **Multi-account support** | **Read Keychain/Credential Manager, account switcher UI** (ref: CodexBar) |
| **Anthropic status monitor** | **Poll status.anthropic.com, show incident badges** (ref: CodexBar) |

**Deliverable**: Full-featured assistant with queue execution, auto-reports, and predictive usage.

### Phase 4: Polish (Week 8-10)

**Goal**: Production quality

| Task | Description |
|---|---|
| Settings page | All configuration options |
| Onboarding | First-run project discovery wizard + OAuth credential detection |
| Performance optimization | Incremental parsing, lazy loading, memory profiling |
| Error handling | Graceful degradation, retry logic |
| Auto-update | Tauri updater plugin (Sparkle equivalent) |
| Package & distribute | DMG build, code signing (optional), `brew install --cask` |
| Documentation | README, user guide |
| **Voice notification option** | **Optional TTS alerts via macOS `say` command** (ref: CCNotify) |

**Deliverable**: Distributable macOS application.

---

## 10. Risk Analysis

| Risk | Impact | Mitigation |
|---|---|---|
| CC file format changes | High — breaks parsing | Version detection, adapter pattern, pin to format version |
| CC adds native GUI | Medium — reduces value | Focus on cross-project + queue features CC won't add |
| Large `~/.claude/` dir | Medium — slow indexing | Incremental parsing, background indexer, configurable depth |
| Tauri WebKit quirks on macOS | Low — CSS issues | Use well-supported CSS, test on multiple macOS versions |
| CC CLI breaking changes | Medium — execution fails | Wrap CLI calls in version-checked adapter, fallback logic |
| Rust learning curve | Medium — dev velocity | Frontend-heavy first, Rust for perf-critical paths only |
| macOS permission issues | Medium — can't read files | First-run wizard, graceful degradation, documentation |
| Concurrent manual CC usage | Low — queue conflict | Detect conflict, pause queue, notify user |
| Data privacy (code in DB) | Low — security concern | SQLite local-only, no network; optional DB encryption later |

---

## 11. Decisions Log

All open questions have been resolved:

| # | Question | Decision |
|---|---|---|
| 1 | CC Subscription model | Token data confirmed in JSONL for all users. Show tokens always, cost as optional toggle |
| 2 | Task queue concurrency | Sequential first, cross-project parallel as opt-in later |
| 3 | Report delivery | In-app + clipboard + file. Webhooks in future |
| 4 | Auto-start | Yes, optional via Settings |
| 5 | Product name | **Alice** (confirmed) |
| 6 | Hooks auto-installation | Auto-install with user consent on first run. If skipped, fallback to file watching |
| 7 | Todo + Queue merge | **Merged** into unified Tasks system (backlog → queued → running → done) |
| 8 | Daily report AI call | **Deferred** to Phase 3. v1 uses auto-generated structured stats |
| 9 | QR / Kanban / Cron | **Removed** — out of scope |
| 10 | Platform support | **macOS primary + Windows supported** with UI fallbacks (see UI_SPEC.md §6.2) |

---

## 12. Success Metrics

| Metric | Target |
|---|---|
| Idle memory usage | < 50MB |
| Startup time | < 1 second |
| Session list refresh | < 200ms after file change |
| Search response | < 100ms for 10K+ sessions |
| Notification latency | < 3 seconds from CC completion |
| Bundle size | < 15MB |

---

## 13. Future Enhancements (Post-MVP)

- **Remote session monitoring**: Track `--remote` web sessions
- **Team dashboard**: Aggregate usage across team members
- **AI insights**: "You spent 40% more tokens on ProjectA this week, consider adding more context to CLAUDE.md"
- **Session replay**: Visual playback of CC sessions
- **MCP integration**: Run Alice as an MCP server that CC can call back to
- **iOS companion**: Push notifications to phone when long tasks complete
- **Plugin system**: Community extensions for custom integrations
- **ROI estimation**: Compare CC cost vs estimated human developer hours (ref: PriceyApp)
- **Linux support**: Tauri supports Linux; needs tray + notification testing

---

## Appendix B: Open-Source Ecosystem Analysis & Integration Strategy

### B.1 CodexBar (steipete/CodexBar)

| Attribute | Detail |
|---|---|
| **Stars** | 5,708 |
| **Tech** | Swift native, macOS 14+, SwiftUI |
| **License** | MIT |
| **Focus** | Multi-provider usage meter (Claude, Codex, Cursor, Gemini, etc.) |

**Key Features**:
- Menu bar meter icon with session + weekly usage bars
- Claude usage via 3 data paths (priority order): OAuth API → CLI PTY → Web cookies
- Local cost usage scan from `~/.claude/projects/**/*.jsonl`
- Multi-account switching (tokenAccounts in config)
- Provider status polling with incident badges
- Merge Icons mode (multiple providers → one status item)
- WidgetKit widget
- Bundled CLI: `codexbar cost --provider claude`
- Streaming deduplication via `message.id + requestId`

**Claude OAuth API** (CodexBar's preferred method):
```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <access_token from Keychain "Claude Code-credentials">
anthropic-beta: oauth-2025-04-20

Returns: five_hour (session), seven_day (weekly), seven_day_sonnet, seven_day_opus, extra_usage
```

**Integration Analysis for Alice**:

| Aspect | Recommendation |
|---|---|
| Direct embedding | **Not feasible** — Swift cannot be embedded in Tauri/Rust |
| Use as CLI subprocess | **Viable fallback** — `codexbar cost --provider claude` returns JSON; but adds dependency |
| Port usage logic | **Recommended** — Port JSONL parsing + OAuth API calls to Rust |
| Port multi-account | **Recommended** — Read `~/.claude/.credentials.json` + Keychain for account switching |
| Port meter icon | **Reference** — Adopt two-bar meter concept for Alice's menu bar icon |

**What to adopt from CodexBar**:
1. **OAuth usage API** — Alice should call `api.anthropic.com/api/oauth/usage` directly for live session/weekly % (much more accurate than JSONL-only)
2. **Streaming dedup** — JSONL parsing must dedup by `message.id + requestId` to avoid double-counting cumulative streaming chunks
3. **Multi-account support** — Read Keychain credentials + config file for account switching
4. **Meter icon design** — Two-bar meter (session + weekly) in menu bar icon
5. **Rate limit reset countdown** — Show when session/weekly window resets
6. **Provider status polling** — Check Anthropic status page for incidents

**What NOT to adopt**:
- Multi-provider support (Codex, Cursor, Gemini) — out of scope, Alice focuses on Claude Code workflows
- Browser cookie scraping — adds complexity and permission requirements
- CLI PTY automation — fragile; Alice has better alternatives (hooks + file watching)

### B.2 Other Open-Source Claude Code Tools

#### ccusage (ryoppippi/ccusage)
| Attribute | Detail |
|---|---|
| **Stars** | ~2,000+ |
| **Tech** | TypeScript CLI |
| **What** | JSONL usage analyzer: daily/monthly/session/5-hour block reports |
| **Worth adopting** | Cost calculation logic, 5-hour window tracking, per-model breakdown |
| **Reference** | [github.com/ryoppippi/ccusage](https://github.com/ryoppippi/ccusage) |

#### Claude-Code-Usage-Monitor (Maciek-roboblog)
| Attribute | Detail |
|---|---|
| **Tech** | Python CLI with Rich TUI |
| **What** | Real-time terminal dashboard with ML-based predictions for limit hits |
| **Worth adopting** | **Burn rate prediction** — estimate when you'll hit limits based on current usage velocity |
| **Reference** | [GitHub](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) |

#### ccboard (FlorianBruniaux/ccboard)
| Attribute | Detail |
|---|---|
| **Tech** | Web dashboard |
| **What** | Visual dashboard for CC session monitoring |
| **Worth adopting** | UI layout patterns for session cards and project grouping |
| **Reference** | [GitHub](https://github.com/FlorianBruniaux/ccboard) |

#### CCNotify (Helmi/CCNotify)
| Attribute | Detail |
|---|---|
| **Tech** | Python, uses macOS `say` command |
| **What** | Spoken voice alerts when CC needs attention or finishes |
| **Worth adopting** | **Voice notification option** — configurable TTS alerts beyond visual notifications |
| **Reference** | [GitHub](https://github.com/Helmi/CCNotify) |

#### claude-flow (ruvnet/claude-flow)
| Attribute | Detail |
|---|---|
| **Stars** | ~12,900 |
| **Tech** | TypeScript, MCP-based orchestration |
| **What** | Multi-agent swarm coordinator (60+ agents), task distribution, RAG |
| **Worth adopting** | **Task dependency graph** visualization; not core Alice scope but relevant for queue UI |
| **Reference** | [GitHub](https://github.com/ruvnet/claude-flow) |

#### ClaudeUsageTracker (masorange)
| Attribute | Detail |
|---|---|
| **Tech** | macOS menu bar app |
| **What** | Simple cost tracking in menu bar |
| **Worth adopting** | Minimal menu bar cost display pattern |

#### PriceyApp (mobile-next)
| Attribute | Detail |
|---|---|
| **Tech** | macOS status bar, Swift |
| **What** | Compare AI costs vs human developer costs (ROI tracking) |
| **Worth adopting** | **ROI metric** — "This session saved ~X hours of manual work" estimation |

### B.3 New Features to Add (from ecosystem analysis)

Based on the ecosystem survey, these features are adopted into Alice:

| # | Feature | Source | Priority | Phase |
|---|---|---|---|---|
| 1 | **Live usage % via OAuth API** | CodexBar | **High** | Phase 2 |
| 2 | **Rate limit reset countdown** | CodexBar | **High** | Phase 2 |
| 3 | **Multi-account switching** | CodexBar | **Medium** | Phase 3 |
| 4 | **Burn rate prediction** | Claude-Code-Usage-Monitor | **Medium** | Phase 3 |
| 5 | **5-hour window tracking** | ccusage | **High** | Phase 2 |
| 6 | **Streaming chunk dedup** | CodexBar | **Critical** | Phase 1 |
| 7 | **Voice notification option** | CCNotify | **Low** | Phase 4 |
| 8 | **Anthropic status monitoring** | CodexBar | **Medium** | Phase 3 |
| 9 | **Two-bar meter icon** | CodexBar | **Medium** | Phase 2 |

**Removed** (out of scope): QR code mobile access, Kanban dashboard, Cron scheduled tasks, ROI estimation.

### B.4 Updated Usage Dashboard Design

With CodexBar's insights, the usage section should show:

```
┌───────────────────────────────────┐
│ 📊 USAGE                          │
│                                    │
│ Session (5h window)                │
│ ████████████████░░░░  78% used     │
│ Resets in 2h 14m                   │
│                                    │
│ Weekly                             │
│ ██████████░░░░░░░░░░  48% used     │
│ Resets Mon 00:00                   │
│                                    │
│ Burn rate: ~12%/hour               │
│ ⚠ At current pace, session limit   │
│   in ~1h 50m                       │
│                                    │
│ Today: 45K tokens · $0.82          │
│ This week: 320K tokens · $5.40     │
│                                    │
│ Account: user@email.com (Max)      │
│ [Switch Account ▾]                 │
└───────────────────────────────────┘
```

### B.5 Implementation: OAuth Usage Fetching (Rust)

```rust
use reqwest::Client;
use serde::Deserialize;

#[derive(Deserialize)]
struct UsageResponse {
    five_hour: UsageWindow,
    seven_day: UsageWindow,
    seven_day_sonnet: Option<UsageWindow>,
    seven_day_opus: Option<UsageWindow>,
    extra_usage: Option<ExtraUsage>,
}

#[derive(Deserialize)]
struct UsageWindow {
    percent_used: f64,
    reset_at: String, // ISO 8601
}

async fn fetch_claude_usage(access_token: &str) -> Result<UsageResponse> {
    let client = Client::new();
    let resp = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await?;
    resp.json::<UsageResponse>().await
}

// Credentials: read from Keychain (macOS) or ~/.claude/.credentials.json
fn read_claude_credentials() -> Option<String> {
    // 1. Try Keychain: service="Claude Code-credentials"
    // 2. Fallback: ~/.claude/.credentials.json
    // 3. Check for user:profile scope
}
```

---

## Appendix A: CC Data Format Reference

### history.jsonl entry
```json
{
  "display": "user prompt text",
  "pastedContents": {},
  "timestamp": 1766392515891,
  "project": "/Users/user/WorkSpace/Project",
  "sessionId": "7ce5e7dc-bfe9-4cae-a3aa-e742685fe371"
}
```

### Session JSONL message types
```
type: "user"        → User message with prompt
type: "assistant"   → CC response with usage data
type: "system"      → System events (errors, compaction)
type: "file-history-snapshot" → File state tracking
```

### stats-cache.json
```json
{
  "version": 2,
  "lastComputedDate": "2026-02-13",
  "dailyActivity": [
    { "date": "2026-01-07", "messageCount": 297, "sessionCount": 11, "toolCallCount": 75 }
  ]
}
```

### Hook events useful for Alice
```
SessionStart   → Track new session
Stop           → Task completed
TaskCompleted  → Explicit task completion
SessionEnd     → Session terminated
Notification   → Forward to Alice notification system
```

---

## Appendix C: License Compliance

### Referenced Projects

| Project | License | Obligation |
|---|---|---|
| steipete/CodexBar | MIT | Retain copyright notice if copying code |
| ryoppippi/ccusage | MIT | Retain copyright notice if copying code |
| nicepkg/aide (Opcode) | MIT | Retain copyright notice if copying code |
| anthropics/claude-code | **Proprietary** | Cannot copy source code; CLI usage + file reading OK |

### Alice's Integration Boundaries

- **CLI calls** (`claude -p`, `--resume`): Legal end-user tool usage
- **Reading `~/.claude/` files**: Legal; user's own local data
- **OAuth API calls**: Legal API consumption
- **JSONL parser, hooks integration**: Self-implemented based on public format, not copied from claude-code source
- **Ported logic from CodexBar/ccusage**: MIT-licensed, must include attribution in `THIRD_PARTY_LICENSES`

### Recommended Alice License

**MIT** — consistent with referenced projects, maximizes adoption.

Files to create:
- `LICENSE` (MIT)
- `THIRD_PARTY_LICENSES` (attribution for CodexBar, ccusage)
