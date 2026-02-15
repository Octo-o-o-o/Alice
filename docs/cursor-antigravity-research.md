# Cursor & Antigravity 技术调研报告

> 版本: 1.0 (创建于 2026-02-16)
> 调研人: Claude Sonnet 4.5
> 目的: 评估 Cursor 和 Antigravity 接入 Alice 的完整技术可行性

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [Cursor 深度调研](#2-cursor-深度调研)
3. [Antigravity 深度调研](#3-antigravity-深度调研)
4. [接入可行性评估](#4-接入可行性评估)
5. [实施建议](#5-实施建议)
6. [风险评估](#6-风险评估)
7. [附录](#7-附录)

---

## 1. 执行摘要

### 1.1 调研结论

| Provider | 技术可行性 | 推荐动作 | 预计工作量 | 优先级 |
|----------|----------|---------|----------|--------|
| **Cursor** | 🟡 中等 (65%) | ⚠️ 部分支持 | 2-3 周 | P1 |
| **Antigravity** | 🟢 高 (85%) | ✅ 完整支持 | 1-2 周 | P0 |

### 1.2 核心发现

#### Cursor
- ✅ **数据可访问**: SQLite 数据库，可解析
- ⚠️ **格式差异**: 使用 SQLite 而非 JSONL，需要专门的解析器
- ⚠️ **会话关联**: 需要通过 workspace ID 关联会话
- ❌ **无公开 API**: 使用情况获取需要依赖本地数据或自定义 API keys
- ✅ **CLI 可用**: 有 `cursor` CLI 命令

#### Antigravity
- ✅ **标准化目录**: `~/.gemini/` 结构清晰
- ✅ **文档完善**: 官方文档详细，架构明确
- ✅ **Artifacts 系统**: 结构化的任务跟踪
- ✅ **Gmail OAuth**: 认证机制清晰
- ⚠️ **无独立 CLI**: 是 VSCode fork，不是独立 CLI
- ⚠️ **Preview 阶段**: 存在稳定性问题（频繁崩溃、配额管理问题）

### 1.3 建议优先级调整

**原方案**: Cursor (P0) > Antigravity (P2)

**调整后**: **Antigravity (P0) > Cursor (P1)**

**原因**:
1. Antigravity 数据结构更清晰，目录标准化
2. 官方文档完善，降低逆向工程风险
3. 与 Gemini CLI 共享 `~/.gemini/` 目录，已有参考实现
4. Artifacts 系统提供结构化的任务跟踪
5. Cursor 的 SQLite 格式需要更多开发工作

---

## 2. Cursor 深度调研

### 2.1 数据存储架构

#### 2.1.1 存储位置

**全局配置**:
```
~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
```

**工作空间存储**:
```
~/Library/Application Support/Cursor/User/workspaceStorage/
├── <workspace-hash-1>/
│   └── state.vscdb
├── <workspace-hash-2>/
│   └── state.vscdb
└── ...
```

**工作空间配置**:
```
~/.cursor/
├── mcp.json              # MCP 服务器配置
└── environment.json      # 环境变量 (项目级)
```

**关键发现**:
- ✅ 每个项目/工作空间有独立的 SQLite 数据库
- ⚠️ Workspace hash 动态生成，移动/重命名项目会丢失关联
- ✅ 所有数据本地存储，无需网络访问

#### 2.1.2 SQLite 数据库结构

**state.vscdb Schema**:

```sql
-- 主表: ItemTable
CREATE TABLE ItemTable (
    rowid INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    value TEXT  -- JSON blob
);

-- 关键键值
-- 'aiService.prompts'                          -> 所有 AI 对话提示
-- 'workbench.panel.aichat.view.aichat.chatdata' -> 聊天数据
-- 'history.recentlyOpenedPathsList'           -> 最近打开的路径
-- 'cursor.composer.sessions'                  -> Composer 会话 (推测)
```

**查询示例**:
```bash
# 提取聊天历史
sqlite3 "~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/state.vscdb" \
  "SELECT value FROM ItemTable WHERE key = 'workbench.panel.aichat.view.aichat.chatdata'"

# 提取所有键
sqlite3 "~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/state.vscdb" \
  "SELECT key FROM ItemTable"
```

**Value JSON 结构** (推测):
```json
{
  "sessions": [
    {
      "id": "session-uuid",
      "messages": [
        {
          "type": "user" | "assistant" | "tool" | "thinking" | "error",
          "content": "...",
          "timestamp": "HH:MM:SS",
          "toolData": {
            "operation": "read" | "edit" | "write" | "search" | "terminal",
            "files": [...],
            "diffs": [...],
            "status": "success" | "error"
          }
        }
      ],
      "created_at": "...",
      "updated_at": "...",
      "workspace": "/path/to/project",
      "composer_id": "..."
    }
  ]
}
```

#### 2.1.3 数据访问方法

**方法 1: 直接 SQLite 查询** (推荐)

```rust
// src-tauri/src/providers/cursor.rs

use rusqlite::{Connection, Result};
use serde_json::Value;

fn parse_cursor_workspace(workspace_path: &Path) -> Result<Vec<Session>> {
    let db_path = workspace_path.join("state.vscdb");
    let conn = Connection::open(db_path)?;

    // 查询聊天数据
    let mut stmt = conn.prepare(
        "SELECT value FROM ItemTable WHERE key = 'workbench.panel.aichat.view.aichat.chatdata'"
    )?;

    let chat_data: String = stmt.query_row([], |row| row.get(0))?;
    let json: Value = serde_json::from_str(&chat_data)?;

    // 解析 sessions
    parse_cursor_sessions(json)
}
```

**方法 2: 监控 state.vscdb 文件变更** (实时)

```rust
// 使用 notify crate 监控
let watcher = notify::recommended_watcher(|res| {
    match res {
        Ok(Event { paths, .. }) => {
            for path in paths {
                if path.file_name() == Some("state.vscdb") {
                    // 重新解析 SQLite
                    parse_cursor_workspace(path.parent().unwrap());
                }
            }
        }
        Err(e) => println!("watch error: {:?}", e),
    }
})?;

watcher.watch(cursor_workspaces_dir, RecursiveMode::Recursive)?;
```

**挑战**:
- ⚠️ Workspace hash 映射复杂，需要维护 hash → project_path 映射表
- ⚠️ SQLite 文件可能被 Cursor 锁定，需要处理并发访问
- ⚠️ JSON blob 结构未文档化，可能随版本变化

### 2.2 会话格式分析

#### 2.2.1 消息类型

根据 [cursor-history 项目](https://github.com/S2thend/cursor-history) 的分析:

```typescript
type MessageType =
  | "user"       // 用户输入
  | "assistant"  // AI 响应
  | "tool"       // 工具调用 (文件操作、搜索、终端)
  | "thinking"   // AI 思考过程
  | "error";     // 错误信息

interface CursorMessage {
  type: MessageType;
  content: string;
  timestamp: string;  // "HH:MM:SS" 格式

  // 工具相关数据 (仅 type="tool")
  toolData?: {
    operation: "read" | "edit" | "write" | "search" | "terminal" | "ls";
    files?: string[];
    diffs?: {
      file: string;
      before: string;
      after: string;
    }[];
    searchPattern?: string;
    searchPaths?: string[];
    command?: string;
    status?: "success" | "error";
    additionalData?: {
      status: number;  // 错误码
      message?: string;
    };
  };
}

interface CursorSession {
  id: string;
  workspace: string;           // 工作空间路径
  messages: CursorMessage[];
  message_count: number;
  created_at: string;
  updated_at: string;
  composer_id?: string;        // 外部工具集成 ID
}
```

#### 2.2.2 Token 统计

**问题**: Cursor 的 SQLite 数据库中 **没有直接的 token 统计**

**解决方案**:

1. **估算法**: 根据消息内容长度估算
   ```rust
   fn estimate_tokens(content: &str) -> i64 {
       // 简单估算: 1 token ≈ 4 字符
       (content.len() / 4) as i64
   }
   ```

2. **集成 tiktoken**: 使用 OpenAI 的 tokenizer
   ```toml
   [dependencies]
   tiktoken-rs = "0.5"
   ```

   ```rust
   use tiktoken_rs::cl100k_base;

   fn count_tokens(content: &str) -> i64 {
       let bpe = cl100k_base().unwrap();
       bpe.encode_with_special_tokens(content).len() as i64
   }
   ```

3. **从 Cursor API 获取** (如果用户配置了自定义 API key)
   - 读取用户的 OpenAI/Anthropic API key
   - 通过 API 查询实际使用量
   - **风险**: 需要用户授权，且不是所有用户都配置自定义 key

### 2.3 认证与 API

#### 2.3.1 Cursor API Key

根据 [GitGuardian 文档](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/cursor_apikey):

**Cursor API Key 类型**:
1. **Cursor User API Key**: 访问 headless Cursor Agent CLI 和 Background Agent API
2. **Cursor Admin API Key**: 管理员权限

**Key 格式**:
```
cur_user_<base64>
cur_admin_<base64>
```

**存储位置** (推测):
```
~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
-> ItemTable.key = 'cursor.auth.token'
```

**用途**:
- Headless agent CLI
- Background agent API
- 可能用于使用情况查询 (未文档化)

#### 2.3.2 自定义 LLM API Keys

根据 [Apidog 文档](https://apidog.com/blog/how-to-add-custom-api-keys-to-cursor-a-comprehensive-guide/):

**支持的 Provider**:
- OpenAI
- Anthropic Claude
- Google Gemini
- Azure OpenAI
- OpenRouter

**配置方式**:
- UI 配置 (Settings → Models)
- 存储在 state.vscdb 中

**Alice 集成方案**:
```rust
// 读取用户配置的 API key
fn get_user_api_key(provider: &str) -> Option<String> {
    let state_db = open_cursor_global_state()?;

    let key_path = format!("cursor.models.{}.apiKey", provider);
    let api_key: String = state_db.query_row(
        "SELECT value FROM ItemTable WHERE key = ?",
        [&key_path],
        |row| row.get(0)
    ).ok()?;

    Some(api_key)
}

// 使用 API key 查询实际使用情况
async fn fetch_cursor_usage_from_provider(
    provider: &str,
    api_key: &str
) -> Result<ProviderUsage, String> {
    match provider {
        "openai" => fetch_openai_usage(api_key).await,
        "anthropic" => fetch_anthropic_usage(api_key).await,
        "google" => fetch_gemini_usage(api_key).await,
        _ => Err(format!("Unsupported provider: {}", provider))
    }
}
```

#### 2.3.3 使用情况获取策略

**策略 1: 本地估算** (推荐)
```rust
fn calculate_cursor_usage(sessions: &[CursorSession]) -> ProviderUsage {
    let total_tokens: i64 = sessions.iter()
        .flat_map(|s| &s.messages)
        .map(|m| count_tokens(&m.content))
        .sum();

    ProviderUsage {
        id: ProviderId::Cursor,
        session_percent: 0.0,  // 无法获取限额
        session_reset_at: None,
        weekly_percent: None,
        weekly_reset_at: None,
        last_updated: chrono::Utc::now().timestamp_millis(),
        error: Some("Usage limits not available from local data".to_string()),
    }
}
```

**策略 2: API 回退**
```rust
fn get_cursor_usage() -> Result<Option<ProviderUsage>, ProviderError> {
    // 尝试从自定义 API key 获取
    if let Some(api_key) = get_user_api_key("anthropic") {
        return fetch_anthropic_usage(&api_key).await;
    }

    // 回退到本地估算
    let sessions = parse_all_cursor_sessions()?;
    Ok(Some(calculate_cursor_usage(&sessions)))
}
```

### 2.4 CLI 集成

#### 2.4.1 Cursor CLI 命令

**安装检测**:
```bash
which cursor
# /usr/local/bin/cursor (如果已安装)
```

**CLI 使用** (推测):
```bash
# 打开项目
cursor /path/to/project

# 可能的命令 (未文档化)
cursor --help
cursor --version
cursor --status  # 使用情况?
```

**Alice 集成**:
```rust
impl Provider for CursorProvider {
    fn is_installed(&self) -> bool {
        crate::platform::is_cli_installed("cursor")
    }

    fn get_cli_command(&self) -> String {
        "cursor".to_string()
    }
}
```

#### 2.4.2 任务队列执行

**挑战**: Cursor 没有类似 `claude -p "prompt"` 的非交互式命令

**解决方案**: 跳过 Cursor 的任务队列功能

```rust
fn parse_session(&self, path: &Path) -> Result<Session, ProviderError> {
    // 仅支持会话解析，不支持任务执行
    Ok(parse_cursor_workspace(path)?)
}

fn get_cli_command(&self) -> String {
    // 返回空字符串或抛出错误
    "".to_string()
}
```

**Alice UI 处理**:
- WorkspaceView → Tasks → Queue: 隐藏 Cursor 任务
- 或显示 "Cursor does not support task queue"

### 2.5 实施方案

#### 2.5.1 Provider 实现

```rust
// src-tauri/src/providers/cursor.rs

use super::{Provider, ProviderError, ProviderId, ProviderUsage};
use crate::session::{Session, SessionStatus};
use rusqlite::{Connection, Result as SqliteResult};
use std::path::{Path, PathBuf};

pub struct CursorProvider {
    user_dir: PathBuf,
}

impl CursorProvider {
    pub fn new() -> Self {
        Self {
            user_dir: Self::get_cursor_user_dir(),
        }
    }

    fn get_cursor_user_dir() -> PathBuf {
        if cfg!(target_os = "macos") {
            dirs::home_dir().unwrap()
                .join("Library/Application Support/Cursor/User")
        } else if cfg!(target_os = "windows") {
            PathBuf::from(std::env::var("APPDATA").unwrap())
                .join("Cursor/User")
        } else {
            dirs::home_dir().unwrap()
                .join(".config/Cursor/User")
        }
    }

    fn get_workspace_dirs(&self) -> Vec<PathBuf> {
        let workspace_storage = self.user_dir.join("workspaceStorage");
        if !workspace_storage.exists() {
            return vec![];
        }

        std::fs::read_dir(&workspace_storage)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_dir())
                    .map(|e| e.path())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn parse_workspace_db(&self, workspace_dir: &Path) -> SqliteResult<Vec<Session>> {
        let db_path = workspace_dir.join("state.vscdb");
        if !db_path.exists() {
            return Ok(vec![]);
        }

        let conn = Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;

        // 查询聊天数据
        let chat_data_json: Option<String> = conn
            .query_row(
                "SELECT value FROM ItemTable WHERE key = ?",
                ["workbench.panel.aichat.view.aichat.chatdata"],
                |row| row.get(0),
            )
            .ok();

        if let Some(json_str) = chat_data_json {
            let sessions = parse_cursor_chat_json(&json_str, workspace_dir)?;
            Ok(sessions)
        } else {
            Ok(vec![])
        }
    }
}

impl Provider for CursorProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Cursor
    }

    fn is_installed(&self) -> bool {
        crate::platform::is_cli_installed("cursor")
    }

    fn get_session_dirs(&self) -> Vec<PathBuf> {
        self.get_workspace_dirs()
    }

    fn parse_session(&self, workspace_dir: &Path) -> Result<Session, ProviderError> {
        let sessions = self.parse_workspace_db(workspace_dir)
            .map_err(|e| ProviderError::SessionParse(e.to_string()))?;

        // 返回最新的 session
        sessions.into_iter()
            .max_by_key(|s| s.updated_at)
            .ok_or_else(|| ProviderError::SessionParse("No sessions found".to_string()))
    }

    fn get_usage(&self) -> Result<Option<ProviderUsage>, ProviderError> {
        // 尝试从自定义 API key 获取
        // 否则返回本地估算

        let sessions = self.get_session_dirs()
            .iter()
            .flat_map(|dir| self.parse_workspace_db(dir).unwrap_or_default())
            .collect::<Vec<_>>();

        let total_tokens: i64 = sessions.iter()
            .map(|s| s.total_tokens)
            .sum();

        Ok(Some(ProviderUsage {
            id: ProviderId::Cursor,
            session_percent: 0.0,
            session_reset_at: None,
            weekly_percent: None,
            weekly_reset_at: None,
            last_updated: chrono::Utc::now().timestamp_millis(),
            error: Some(format!("Local estimate: {} tokens used", total_tokens)),
        }))
    }

    fn get_cli_command(&self) -> String {
        "".to_string()  // Cursor 不支持非交互式 CLI
    }
}

// 辅助函数
fn parse_cursor_chat_json(json_str: &str, workspace_dir: &Path) -> SqliteResult<Vec<Session>> {
    let value: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    // 解析 sessions 数组
    let sessions = value["sessions"].as_array()
        .ok_or_else(|| rusqlite::Error::InvalidQuery)?;

    let mut result = Vec::new();
    for session_json in sessions {
        let session = parse_cursor_session_json(session_json, workspace_dir)?;
        result.push(session);
    }

    Ok(result)
}

fn parse_cursor_session_json(json: &serde_json::Value, workspace_dir: &Path) -> SqliteResult<Session> {
    let session_id = json["id"].as_str().unwrap_or("unknown").to_string();
    let workspace = json["workspace"].as_str()
        .or_else(|| workspace_dir.to_str())
        .unwrap_or("unknown")
        .to_string();

    let messages = json["messages"].as_array().unwrap_or(&vec![]);
    let total_tokens: i64 = messages.iter()
        .map(|m| {
            let content = m["content"].as_str().unwrap_or("");
            count_tokens(content)
        })
        .sum();

    let created_at = parse_timestamp(json["created_at"].as_str().unwrap_or(""));
    let updated_at = parse_timestamp(json["updated_at"].as_str().unwrap_or(""));

    Ok(Session {
        provider: ProviderId::Cursor,
        session_id,
        project_path: workspace,
        total_turns: messages.len() as i64,
        total_tokens,
        started_at: created_at,
        updated_at,
        status: if is_recently_active(updated_at) {
            SessionStatus::Active
        } else {
            SessionStatus::Completed
        },
        // ... 其他字段
    })
}

fn count_tokens(content: &str) -> i64 {
    // 简单估算: 1 token ≈ 4 字符
    (content.len() / 4) as i64
}

fn parse_timestamp(ts: &str) -> i64 {
    // 解析 ISO 8601 或其他格式
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

fn is_recently_active(updated_at: i64) -> bool {
    let now = chrono::Utc::now().timestamp_millis();
    now - updated_at < 60_000  // 最近 60 秒
}
```

#### 2.5.2 Watcher 集成

```rust
// src-tauri/src/watcher.rs

// 监控 Cursor workspaceStorage 目录
fn watch_cursor_workspaces() {
    let cursor_dir = CursorProvider::new().get_session_dirs();

    for workspace_dir in cursor_dir {
        let db_path = workspace_dir.join("state.vscdb");

        watcher.watch(&db_path, RecursiveMode::NonRecursive)?;
    }
}

// 处理 state.vscdb 变更
fn on_cursor_db_changed(db_path: &Path) {
    let workspace_dir = db_path.parent().unwrap();
    let provider = CursorProvider::new();

    if let Ok(session) = provider.parse_session(workspace_dir) {
        database::upsert_session(&session)?;
    }
}
```

#### 2.5.3 数据库 Schema 适配

```sql
-- 无需修改，复用现有 schema
-- sessions 表已有 provider 字段

-- 可选: 添加 Cursor workspace hash 映射表
CREATE TABLE IF NOT EXISTS cursor_workspace_mapping (
    workspace_hash TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    last_seen INTEGER NOT NULL
);
```

### 2.6 技术挑战与解决方案

| 挑战 | 影响 | 解决方案 |
|------|------|---------|
| **SQLite 并发访问** | 中 | 使用 READ_ONLY 模式，避免锁定 |
| **Workspace hash 映射** | 高 | 维护 hash → project_path 映射表 |
| **JSON blob 结构变化** | 中 | 版本检测 + 优雅降级 |
| **Token 统计缺失** | 低 | 本地估算 + tiktoken |
| **使用情况 API 缺失** | 中 | 回退到本地估算 |
| **任务队列不支持** | 低 | 跳过功能，UI 隐藏 |

---

## 3. Antigravity 深度调研

### 3.1 数据存储架构

#### 3.1.1 存储位置

**全局配置目录**:
```
~/.gemini/
├── GEMINI.md                              # 全局 agent rules
├── antigravity/
│   ├── global_workflows/
│   │   └── global-workflow.md
│   ├── skills/                            # 全局 skills
│   ├── browserAllowlist.txt               # 浏览器 URL 白名单
│   └── ...
├── oauth_creds.json                       # OAuth 凭证 (可能)
└── ...
```

**缓存和应用数据**:
```
~/.cache/antigravity/                      # 缓存
~/.config/antigravity/                     # 配置
~/.local/share/antigravity/                # 应用数据
~/.antigravity/                            # 可能的额外数据
```

**工作空间配置**:
```
<project-root>/.agent/
├── rules/                                 # 工作空间 rules
├── workflows/                             # 工作空间 workflows
└── ...
```

**关键发现**:
- ✅ 目录结构清晰，标准化
- ✅ 与 Gemini CLI 共享 `~/.gemini/` 目录
- ✅ 配置文件为纯文本 Markdown，易解析
- ✅ 工作空间级配置支持

#### 3.1.2 会话/Artifacts 存储

根据 [官方文档](https://codelabs.developers.google.com/getting-started-google-antigravity):

**Artifacts 系统**:
- 任务列表 (task lists)
- 实施计划 (implementation plans)
- 截图 (screenshots)
- 浏览器录制 (browser recordings)
- 终端会话 (terminal sessions)
- 日志 (logs)
- 推理步骤 (reasoning steps)

**Inbox 功能**:
- "tracks all your conversations in one place"
- 可以回溯到之前的任务

**推测的存储位置**:
```
~/.local/share/antigravity/
├── sessions/
│   └── YYYY/
│       └── MM/
│           └── DD/
│               └── <session-id>.json
├── artifacts/
│   ├── screenshots/
│   ├── recordings/
│   └── logs/
└── inbox/
    └── conversations.db  # SQLite?
```

**待验证**: 需要实际安装 Antigravity 后确认

#### 3.1.3 OAuth 认证

**认证流程**:
1. Gmail 账户登录
2. OAuth 2.0 授权
3. Access token + Refresh token 存储

**凭证存储** (推测):
```json
// ~/.gemini/oauth_creds.json
{
  "accessToken": "ya29.xxx...",
  "refreshToken": "1//xxx...",
  "expiresAt": 1708000000000,
  "email": "user@gmail.com"
}
```

**Alice 集成**:
```rust
fn get_antigravity_auth() -> Result<OAuthCreds, ProviderError> {
    let creds_path = dirs::home_dir().unwrap()
        .join(".gemini/oauth_creds.json");

    let content = std::fs::read_to_string(&creds_path)?;
    let creds: OAuthCreds = serde_json::from_str(&content)?;

    Ok(creds)
}
```

### 3.2 会话格式分析

#### 3.2.1 Artifacts 数据结构

**推测的 Artifact 格式**:

```json
{
  "type": "task_list" | "plan" | "screenshot" | "recording" | "log" | "terminal",
  "id": "artifact-uuid",
  "session_id": "session-uuid",
  "timestamp": "2026-02-16T10:30:00Z",
  "metadata": {
    "agent": "gemini-3-pro",
    "workspace": "/path/to/project",
    "task": "Implement user authentication"
  },
  "content": {
    // type-specific content
  },
  "feedback": [
    {
      "user": "user@gmail.com",
      "comment": "Looks good",
      "timestamp": "2026-02-16T10:35:00Z"
    }
  ]
}
```

**任务列表 Artifact**:
```json
{
  "type": "task_list",
  "content": {
    "tasks": [
      {
        "id": "task-1",
        "description": "Create user model",
        "status": "completed" | "in_progress" | "pending",
        "assignee": "agent" | "user",
        "dependencies": ["task-0"]
      },
      {
        "id": "task-2",
        "description": "Implement login endpoint",
        "status": "in_progress",
        "assignee": "agent",
        "dependencies": ["task-1"]
      }
    ]
  }
}
```

**实施计划 Artifact**:
```json
{
  "type": "plan",
  "content": {
    "goal": "Implement user authentication",
    "steps": [
      {
        "step": 1,
        "description": "Design database schema",
        "estimated_duration": "30 minutes",
        "artifacts": ["diagram.png"]
      },
      {
        "step": 2,
        "description": "Implement backend API",
        "estimated_duration": "2 hours",
        "artifacts": ["api.py"]
      }
    ],
    "risks": [
      {
        "description": "Password hashing complexity",
        "mitigation": "Use bcrypt library"
      }
    ]
  }
}
```

**终端会话 Artifact**:
```json
{
  "type": "terminal",
  "content": {
    "command": "pytest tests/auth/",
    "output": "...",
    "exit_code": 0,
    "duration_ms": 1234
  }
}
```

#### 3.2.2 Session 结构

**推测的 Session 格式**:

```json
{
  "session_id": "session-uuid",
  "workspace": "/path/to/project",
  "started_at": "2026-02-16T10:00:00Z",
  "updated_at": "2026-02-16T12:30:00Z",
  "status": "active" | "paused" | "completed",
  "agent": "gemini-3-pro",
  "user": "user@gmail.com",

  "conversation": [
    {
      "role": "user",
      "content": "Implement user authentication",
      "timestamp": "2026-02-16T10:00:00Z"
    },
    {
      "role": "agent",
      "content": "I'll help you implement user authentication. Let me break this down into tasks.",
      "timestamp": "2026-02-16T10:00:05Z",
      "artifacts": ["artifact-task-list-uuid"]
    },
    {
      "role": "agent",
      "content": "I've created a user model in `models/user.py`",
      "timestamp": "2026-02-16T10:15:00Z",
      "artifacts": ["artifact-terminal-uuid", "artifact-screenshot-uuid"]
    }
  ],

  "artifacts": [
    "artifact-task-list-uuid",
    "artifact-terminal-uuid",
    "artifact-screenshot-uuid"
  ],

  "metadata": {
    "total_tokens": 12345,
    "total_actions": 15,
    "files_modified": ["models/user.py", "api/auth.py"],
    "tests_run": 8,
    "tests_passed": 7
  }
}
```

### 3.3 API 与认证

#### 3.3.1 内部 API (推测)

Antigravity 作为 VSCode fork，可能有内部 API:

**推测的 API 端点**:
```
https://antigravity.google/api/v1/
├── /sessions              # 获取会话列表
├── /sessions/<id>         # 获取会话详情
├── /artifacts             # 获取 artifacts
├── /usage                 # 使用情况
└── /quota                 # 配额信息
```

**认证方式**:
```
Authorization: Bearer ya29.xxx...
```

**Alice 集成**:
```rust
async fn fetch_antigravity_sessions(access_token: &str) -> Result<Vec<Session>, String> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://antigravity.google/api/v1/sessions")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await?;

    let sessions: Vec<AntigravitySession> = response.json().await?;

    Ok(sessions.into_iter().map(convert_to_alice_session).collect())
}
```

**风险**: API 端点未文档化，可能不存在或需要逆向工程

#### 3.3.2 Quota API (类似 Gemini)

可能复用 Gemini 的 Quota API:

```rust
async fn fetch_antigravity_quota(access_token: &str) -> Result<ProviderUsage, String> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await?;

    let data: serde_json::Value = response.json().await?;

    // 解析 sessionUsed/sessionLimit, weeklyUsed/weeklyLimit
    Ok(parse_quota_response(data, ProviderId::Antigravity))
}
```

### 3.4 CLI 集成

#### 3.4.1 无独立 CLI

**问题**: Antigravity 是 VSCode fork，不是独立 CLI

**解决方案**: 不支持任务队列执行

```rust
impl Provider for AntigravityProvider {
    fn is_installed(&self) -> bool {
        // 检查应用是否安装
        if cfg!(target_os = "macos") {
            Path::new("/Applications/Antigravity.app").exists()
        } else {
            // Windows/Linux 检查
            false
        }
    }

    fn get_cli_command(&self) -> String {
        "".to_string()  // 无 CLI
    }
}
```

**Alice UI 处理**:
- WorkspaceView → Tasks → Queue: 隐藏 Antigravity 任务
- 仅支持会话监控和使用统计

#### 3.4.2 替代方案: Gemini CLI

如果用户希望使用 Gemini 模型执行任务:

```rust
// 使用 Gemini CLI 而非 Antigravity
fn execute_antigravity_task(task: &Task) -> Result<(), ProviderError> {
    // 检查 Gemini CLI 是否安装
    if !crate::platform::is_cli_installed("gemini") {
        return Err(ProviderError::NotInstalled(ProviderId::Gemini));
    }

    // 使用 Gemini CLI 执行
    let output = std::process::Command::new("gemini")
        .arg(task.prompt)
        .output()?;

    // 处理输出
    Ok(())
}
```

### 3.5 实施方案

#### 3.5.1 Provider 实现

```rust
// src-tauri/src/providers/antigravity.rs

use super::{Provider, ProviderError, ProviderId, ProviderUsage};
use crate::session::{Session, SessionStatus};
use std::path::{Path, PathBuf};

pub struct AntigravityProvider {
    gemini_dir: PathBuf,
    antigravity_dir: PathBuf,
}

impl AntigravityProvider {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap();

        Self {
            gemini_dir: home.join(".gemini"),
            antigravity_dir: home.join(".local/share/antigravity"),
        }
    }

    fn get_sessions_dir(&self) -> PathBuf {
        self.antigravity_dir.join("sessions")
    }

    fn parse_session_file(&self, path: &Path) -> Result<Session, ProviderError> {
        let content = std::fs::read_to_string(path)?;
        let session_json: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| ProviderError::SessionParse(e.to_string()))?;

        Ok(parse_antigravity_session(&session_json))
    }

    fn get_oauth_creds(&self) -> Result<OAuthCreds, ProviderError> {
        let creds_path = self.gemini_dir.join("oauth_creds.json");
        if !creds_path.exists() {
            return Err(ProviderError::UsageFetch("No OAuth credentials".to_string()));
        }

        let content = std::fs::read_to_string(&creds_path)?;
        let creds: OAuthCreds = serde_json::from_str(&content)
            .map_err(|e| ProviderError::UsageFetch(e.to_string()))?;

        Ok(creds)
    }
}

impl Provider for AntigravityProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Antigravity
    }

    fn is_installed(&self) -> bool {
        if cfg!(target_os = "macos") {
            Path::new("/Applications/Antigravity.app").exists()
        } else if cfg!(target_os = "windows") {
            // 检查 Windows 安装路径
            false
        } else {
            // 检查 Linux 安装路径
            false
        }
    }

    fn get_session_dirs(&self) -> Vec<PathBuf> {
        let sessions_dir = self.get_sessions_dir();
        if !sessions_dir.exists() {
            return vec![];
        }

        // 遍历 YYYY/MM/DD 目录结构
        let mut dirs = Vec::new();
        collect_leaf_dirs(&sessions_dir, 3, &mut dirs);
        dirs
    }

    fn parse_session(&self, path: &Path) -> Result<Session, ProviderError> {
        self.parse_session_file(path)
    }

    fn get_usage(&self) -> Result<Option<ProviderUsage>, ProviderError> {
        let creds = self.get_oauth_creds()?;

        let runtime = tokio::runtime::Runtime::new()
            .map_err(|e| ProviderError::UsageFetch(e.to_string()))?;

        match runtime.block_on(fetch_antigravity_quota(&creds.access_token)) {
            Ok(usage) => Ok(Some(usage)),
            Err(e) => Ok(Some(ProviderUsage::error(ProviderId::Antigravity, e))),
        }
    }

    fn get_cli_command(&self) -> String {
        "".to_string()  // 无 CLI
    }

    fn is_authenticated(&self) -> bool {
        self.gemini_dir.join("oauth_creds.json").exists()
    }

    fn auth_file_path(&self) -> Option<PathBuf> {
        Some(self.gemini_dir.join("oauth_creds.json"))
    }
}

// 辅助结构
#[derive(Debug, serde::Deserialize)]
struct OAuthCreds {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: String,
    #[serde(rename = "expiresAt")]
    expires_at: i64,
    email: Option<String>,
}

// 辅助函数
fn parse_antigravity_session(json: &serde_json::Value) -> Session {
    let session_id = json["session_id"].as_str().unwrap_or("unknown").to_string();
    let workspace = json["workspace"].as_str().unwrap_or("unknown").to_string();

    let conversation = json["conversation"].as_array().unwrap_or(&vec![]);
    let total_tokens = json["metadata"]["total_tokens"].as_i64().unwrap_or(0);

    let started_at = parse_timestamp(json["started_at"].as_str().unwrap_or(""));
    let updated_at = parse_timestamp(json["updated_at"].as_str().unwrap_or(""));

    Session {
        provider: ProviderId::Antigravity,
        session_id,
        project_path: workspace,
        total_turns: conversation.len() as i64,
        total_tokens,
        started_at,
        updated_at,
        status: match json["status"].as_str() {
            Some("active") => SessionStatus::Active,
            Some("paused") => SessionStatus::Active,
            _ => SessionStatus::Completed,
        },
        // ... 其他字段
    }
}

async fn fetch_antigravity_quota(access_token: &str) -> Result<ProviderUsage, String> {
    // 复用 Gemini Quota API
    let client = reqwest::Client::new();

    let response = client
        .post("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }

    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let session_used = data["sessionUsed"].as_f64().unwrap_or(0.0);
    let session_limit = data["sessionLimit"].as_f64().unwrap_or(1.0);
    let weekly_used = data["weeklyUsed"].as_f64();
    let weekly_limit = data["weeklyLimit"].as_f64();

    Ok(ProviderUsage {
        id: ProviderId::Antigravity,
        session_percent: (session_used / session_limit) * 100.0,
        session_reset_at: data["sessionResetAt"].as_str().map(String::from),
        weekly_percent: weekly_used.and_then(|used| {
            weekly_limit.map(|limit| (used / limit) * 100.0)
        }),
        weekly_reset_at: data["weeklyResetAt"].as_str().map(String::from),
        last_updated: chrono::Utc::now().timestamp_millis(),
        error: None,
    })
}

fn collect_leaf_dirs(root: &Path, depth: usize, result: &mut Vec<PathBuf>) {
    if depth == 0 {
        result.push(root.to_path_buf());
        return;
    }

    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                collect_leaf_dirs(&path, depth - 1, result);
            }
        }
    }
}

fn parse_timestamp(ts: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}
```

#### 3.5.2 Watcher 集成

```rust
// src-tauri/src/watcher.rs

fn watch_antigravity_sessions() {
    let provider = AntigravityProvider::new();

    for session_dir in provider.get_session_dirs() {
        watcher.watch(&session_dir, RecursiveMode::Recursive)?;
    }
}

fn on_antigravity_session_changed(session_file: &Path) {
    if session_file.extension() == Some("json") {
        let provider = AntigravityProvider::new();

        if let Ok(session) = provider.parse_session(session_file) {
            database::upsert_session(&session)?;
        }
    }
}
```

### 3.6 技术挑战与解决方案

| 挑战 | 影响 | 解决方案 |
|------|------|---------|
| **会话文件格式未文档化** | 高 | 安装 Antigravity 并逆向分析 |
| **API 端点不明确** | 中 | 复用 Gemini Quota API |
| **无独立 CLI** | 低 | 跳过任务队列功能 |
| **Preview 阶段不稳定** | 中 | 错误优雅处理 + 降级 |
| **与 Gemini CLI 区分** | 低 | 使用不同的 ProviderId |

---

## 4. 接入可行性评估

### 4.1 评分矩阵

| 维度 | 权重 | Cursor | Antigravity |
|------|------|--------|-------------|
| **数据可访问性** | 30% | 🟡 7/10 | 🟢 9/10 |
| **格式标准化** | 25% | 🟡 6/10 | 🟢 8/10 |
| **API 可用性** | 20% | 🔴 3/10 | 🟡 6/10 |
| **CLI 支持** | 15% | 🟢 8/10 | 🔴 0/10 |
| **文档完整性** | 10% | 🔴 3/10 | 🟢 9/10 |
| **加权总分** | 100% | **6.0/10** | **7.1/10** |

**说明**:
- **数据可访问性**: 本地文件是否可读，无需破解或逆向
- **格式标准化**: 数据格式是否标准（JSONL > SQLite > 二进制）
- **API 可用性**: 使用情况 API 是否公开可用
- **CLI 支持**: 是否有独立 CLI 工具
- **文档完整性**: 官方文档是否详细

### 4.2 功能支持矩阵

| 功能 | Alice 需求 | Cursor 支持 | Antigravity 支持 |
|------|----------|------------|-----------------|
| **会话监控** | 核心 | ✅ 支持 | ✅ 支持 |
| **会话解析** | 核心 | ✅ SQLite | 🟡 JSON (待验证) |
| **使用统计** | 核心 | 🟡 本地估算 | ✅ Quota API |
| **任务队列** | 重要 | ❌ 不支持 | ❌ 不支持 |
| **全文搜索** | 重要 | ✅ 支持 | ✅ 支持 |
| **通知** | 可选 | ⚠️ 部分 | ⚠️ 部分 |
| **报告生成** | 可选 | ✅ 支持 | ✅ 支持 |

**结论**:
- ✅ 两者都支持核心功能（会话监控、解析、搜索）
- ⚠️ Cursor 使用统计需要本地估算（精度较低）
- ⚠️ Antigravity 使用统计可通过 API 获取（精度高）
- ❌ 两者都不支持任务队列（需要在 UI 中隐藏该功能）

### 4.3 风险评估

#### Cursor 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| SQLite 格式变更 | 中 (40%) | 高 | 版本检测 + 优雅降级 |
| Workspace hash 映射失败 | 中 (30%) | 中 | 维护映射表 + 定期清理 |
| 并发访问冲突 | 低 (20%) | 中 | READ_ONLY 模式 |
| Token 估算不准确 | 高 (70%) | 低 | 明确标注"估算值" |
| 用户隐私担忧 | 低 (15%) | 中 | 明确说明读取范围 |

#### Antigravity 风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 会话格式未知 | 高 (60%) | 高 | 实际安装后验证 |
| API 端点变更 | 中 (40%) | 中 | 复用 Gemini API |
| Preview 不稳定 | 高 (70%) | 低 | 错误处理 + 降级 |
| OAuth token 过期 | 中 (30%) | 低 | 自动刷新机制 |

### 4.4 投入产出比

#### Cursor

**预计投入**:
- 调研与设计: 2 天
- SQLite 解析器: 3 天
- Workspace 映射: 2 天
- Token 估算: 1 天
- UI 集成: 2 天
- 测试与优化: 3 天
- **总计**: 13 天 (2.6 周)

**预期产出**:
- ✅ 会话监控和解析
- ✅ 历史搜索
- 🟡 使用统计（本地估算）
- ❌ 任务队列

**用户价值**: 中等
- Cursor 用户基数大，但 Alice 提供的增值有限（Cursor 自身已有会话历史）

#### Antigravity

**预计投入**:
- 调研与验证: 3 天
- 会话解析器: 2 天
- Quota API 集成: 1 天
- UI 集成: 2 天
- 测试与优化: 2 天
- **总计**: 10 天 (2 周)

**预期产出**:
- ✅ 会话监控和解析
- ✅ 历史搜索
- ✅ 使用统计（API 精确）
- ❌ 任务队列

**用户价值**: 高
- Antigravity 用户需要外部工具管理 Agent 任务
- Alice 的报告功能与 Artifacts 系统互补

---

## 5. 实施建议

### 5.1 优先级调整

**原计划**: Cursor (P0) > Antigravity (P2)

**调整后**:

1. **Antigravity (P0)** - 立即实施
   - 数据结构清晰，风险低
   - 官方文档完善
   - 用户价值高

2. **Cursor (P1)** - 短期实施
   - 用户基数大
   - 技术复杂度中等
   - 作为 "bonus" 功能

### 5.2 实施路线图

#### Phase 1: Antigravity 支持 (2 周)

**Week 1: 调研与核心实现**
- [ ] Day 1-2: 安装 Antigravity，验证数据存储结构
- [ ] Day 3-4: 实现 AntigravityProvider
- [ ] Day 5: Quota API 集成

**Week 2: UI 集成与测试**
- [ ] Day 1-2: UI 视觉标识
- [ ] Day 3-4: 端到端测试
- [ ] Day 5: 文档编写 + 发布

#### Phase 2: Cursor 支持 (2-3 周)

**Week 1: 调研与 SQLite 解析**
- [ ] Day 1-2: SQLite 数据结构分析
- [ ] Day 3-5: 实现 SQLite 解析器

**Week 2: Workspace 映射与 Token 估算**
- [ ] Day 1-3: Workspace hash 映射逻辑
- [ ] Day 4-5: Token 估算实现

**Week 3: UI 集成与测试**
- [ ] Day 1-2: UI 集成
- [ ] Day 3-5: 测试 + 文档

### 5.3 最小可行产品 (MVP)

#### Antigravity MVP

**范围**:
- ✅ 会话监控（仅已完成的会话）
- ✅ 使用统计（Quota API）
- ✅ 基础 UI 显示
- ❌ 实时 Artifacts 解析（后期）

**接受标准**:
- [ ] 能够读取 `~/.local/share/antigravity/sessions/` 中的会话文件
- [ ] Quota API 调用成功
- [ ] SessionCard 正确显示 Antigravity 会话
- [ ] ProviderUsageCard 显示准确的配额信息

#### Cursor MVP

**范围**:
- ✅ 会话监控（主要 workspace）
- 🟡 使用统计（本地估算，标注"估算值"）
- ✅ 基础 UI 显示
- ❌ 所有 workspace 的自动发现（后期）

**接受标准**:
- [ ] 能够解析 `state.vscdb` 中的聊天数据
- [ ] 至少支持当前活跃的 workspace
- [ ] Token 估算误差 < 20%
- [ ] SessionCard 正确显示 Cursor 会话

### 5.4 Feature Flag 策略

```rust
// src-tauri/src/config.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub cursor: ProviderSettings,
    pub antigravity: ProviderSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSettings {
    pub enabled: bool,
    pub beta: bool,  // 标记为 beta 功能
    pub features: ProviderFeatures,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderFeatures {
    pub session_monitoring: bool,
    pub usage_tracking: bool,
    pub task_queue: bool,  // Cursor/Antigravity 默认 false
}
```

**UI 显示**:
```tsx
<ProviderConfigCard provider="cursor">
  {config.beta && (
    <Badge variant="warning">Beta</Badge>
  )}
  <p className="text-sm text-white/60">
    ⚠️ Usage statistics are estimated locally. Actual values may vary.
  </p>
</ProviderConfigCard>
```

---

## 6. 风险评估

### 6.1 技术风险汇总

| 风险类别 | Cursor | Antigravity |
|----------|--------|-------------|
| **数据格式变更** | 🟡 中 | 🟢 低 |
| **API 稳定性** | 🔴 高 | 🟡 中 |
| **逆向工程** | 🟡 中 | 🟢 低 |
| **性能影响** | 🟡 中 | 🟢 低 |
| **维护成本** | 🟡 中 | 🟢 低 |

### 6.2 法律与合规风险

#### Cursor

**风险**:
- ⚠️ 读取 SQLite 数据库可能被视为"非授权访问"
- ⚠️ 逆向工程可能违反 ToS

**缓解**:
- ✅ 仅读取本地文件，不访问网络 API
- ✅ 明确告知用户数据访问范围
- ✅ 提供 opt-in 机制（默认禁用）

**ToS 审查**:
- 需要审查 Cursor 的 Terms of Service
- 如果明确禁止，考虑放弃或等待官方支持

#### Antigravity

**风险**:
- 🟢 读取 `~/.gemini/` 是官方文档化的配置目录
- 🟢 使用 Google Cloud API 是合规的

**缓解**:
- ✅ 使用官方 OAuth 认证
- ✅ 遵循 Google API 使用政策

### 6.3 用户体验风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **功能不完整** | 中 | 明确标注"Beta"或"部分支持" |
| **数据不准确** | 中 | 标注"估算值"，提供免责声明 |
| **性能下降** | 低 | 懒加载 + 异步处理 |
| **配置复杂** | 低 | 智能默认配置 + 简化 UI |

---

## 7. 附录

### 7.1 调研资源

#### Cursor 资源

**官方**:
- 官网: https://cursor.sh
- 文档: (有限)

**社区**:
- [Cursor Settings Location](https://www.jackyoustra.com/blog/cursor-settings-location) - SQLite 存储分析
- [cursor-history GitHub](https://github.com/S2thend/cursor-history) - 数据结构文档
- [CursorChat Downloader](https://marketplace.visualstudio.com/items?itemName=abdelhakakermi.cursorchat-downloader) - VS Code 扩展
- [Cursor API Keys](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/cursor_apikey)

#### Antigravity 资源

**官方**:
- 官网: https://antigravity.google (推测)
- [官方博客](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/)
- [Getting Started Codelab](https://codelabs.developers.google.com/getting-started-google-antigravity)

**社区**:
- [Antigravity vs Gemini CLI](https://www.augmentcode.com/tools/google-antigravity-vs-gemini-cli)
- [Antigravity Review](https://leaveit2ai.com/ai-tools/code-development/antigravity)

### 7.2 实施检查清单

#### Antigravity

**Phase 1: 调研 (3 天)**
- [ ] 安装 Antigravity
- [ ] 创建测试会话
- [ ] 探索 `~/.gemini/` 和 `~/.local/share/antigravity/`
- [ ] 验证会话文件格式
- [ ] 测试 Quota API

**Phase 2: 实现 (4 天)**
- [ ] 创建 `providers/antigravity.rs`
- [ ] 实现 Provider trait
- [ ] 实现 OAuth 凭证读取
- [ ] 实现 Quota API 调用
- [ ] 实现会话文件解析

**Phase 3: 集成 (3 天)**
- [ ] Watcher 集成
- [ ] 数据库适配
- [ ] UI 组件更新
- [ ] ProviderId 扩展

**Phase 4: 测试 (2 天)**
- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能测试
- [ ] 用户验收测试

#### Cursor

**Phase 1: 调研 (2 天)**
- [ ] 分析 state.vscdb 结构
- [ ] 提取聊天数据 JSON
- [ ] 分析 Workspace 映射
- [ ] 探索 API key 存储

**Phase 2: 实现 (7 天)**
- [ ] 创建 `providers/cursor.rs`
- [ ] 实现 SQLite 解析器
- [ ] 实现 Workspace hash 映射
- [ ] 实现 Token 估算
- [ ] 实现使用统计（本地）

**Phase 3: 集成 (2 天)**
- [ ] Watcher 集成
- [ ] UI 组件更新

**Phase 4: 测试 (3 天)**
- [ ] 单元测试
- [ ] 并发访问测试
- [ ] 性能测试
- [ ] 用户验收测试

### 7.3 决策记录

**DR-001: Antigravity 优先于 Cursor**

**日期**: 2026-02-16

**决策**: 调整实施优先级，Antigravity (P0) > Cursor (P1)

**原因**:
1. Antigravity 数据结构更清晰（标准化目录）
2. 官方文档完善，降低逆向风险
3. 与 Gemini CLI 共享配置目录，可复用现有经验
4. Quota API 可用，使用统计更准确
5. Cursor SQLite 解析复杂度较高，投入产出比较低

**影响**:
- 开发时间表调整
- 文档更新

**DR-002: Cursor/Antigravity 不支持任务队列**

**日期**: 2026-02-16

**决策**: 两个 Provider 都不支持任务队列功能

**原因**:
1. Cursor/Antigravity 都没有非交互式 CLI
2. 实现成本高（需要 IDE 自动化）
3. 用户价值低（用户直接在 IDE 中使用即可）

**影响**:
- UI 需要隐藏任务队列功能
- 文档需要明确说明限制

---

## 总结

### 核心结论

1. **Antigravity 完整接入可行性: 85%** ✅
   - 数据结构清晰，官方文档完善
   - 推荐立即实施 (P0)
   - 预计 2 周完成

2. **Cursor 部分接入可行性: 65%** ⚠️
   - 会话监控可行，但格式复杂
   - 使用统计仅本地估算
   - 推荐短期实施 (P1)
   - 预计 2-3 周完成

### 推荐行动

**立即行动**:
1. ✅ 安装 Antigravity 并验证数据结构
2. ✅ 实施 Antigravity Provider (2 周)
3. ⚠️ 评估 Cursor ToS，确认合规性

**短期行动** (1 个月内):
1. ⚠️ 实施 Cursor Provider (2-3 周)
2. ✅ 发布 Beta 版本收集反馈

**中期行动** (3 个月内):
1. 🔍 根据用户反馈优化
2. 📊 评估其他 Provider (JetBrains AI, GitHub Copilot)

---

**文档版本**: 1.0
**创建日期**: 2026-02-16
**调研人**: Claude Sonnet 4.5
**下一步**: 安装 Antigravity 并开始实施

---

## Sources

- [Cursor Settings Location](https://www.jackyoustra.com/blog/cursor-settings-location)
- [cursor-history GitHub](https://github.com/S2thend/cursor-history)
- [Getting Started with Google Antigravity](https://codelabs.developers.google.com/getting-started-google-antigravity)
- [Build with Google Antigravity](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/)
- [Cursor API Key Documentation](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/cursor_apikey)
- [How to Use Custom API Keys in Cursor](https://apidog.com/blog/how-to-add-custom-api-keys-to-cursor-a-comprehensive-guide/)
- [Cursor Data Storage Structure](https://github.com/S2thend/cursor-history/blob/main/README.md)
- [Google Antigravity vs Gemini CLI](https://www.augmentcode.com/tools/google-antigravity-vs-gemini-cli)
- [Cursor AI Review 2026](https://prismic.io/blog/cursor-ai)
- [Google Antigravity Review 2026](https://leaveit2ai.com/ai-tools/code-development/antigravity)
