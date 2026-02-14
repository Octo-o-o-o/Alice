# Alice 多 AI CLI 提供商支持设计方案

> 参考项目: [CodexBar](https://github.com/steipete/CodexBar)

## 1. 概述

本方案旨在扩展 Alice，使其能够支持多个 AI CLI 工具，包括：
- **Claude Code** (当前已支持)
- **OpenAI Codex CLI** (计划支持)
- **Google Gemini CLI** (计划支持)

## 2. 各 CLI 工具分析

### 2.1 Claude Code (已支持)

| 项目 | 详情 |
|------|------|
| CLI 命令 | `claude` |
| 数据目录 | `~/.claude/` |
| 会话文件 | `~/.claude/projects/**/*.jsonl` |
| 认证文件 | `~/.claude/.credentials.json` 或 Keychain |
| OAuth API | `https://api.anthropic.com/api/oauth/usage` |
| 会话格式 | JSONL (type, timestamp, message, usage 等) |

### 2.2 OpenAI Codex CLI

| 项目 | 详情 |
|------|------|
| CLI 命令 | `codex` |
| 数据目录 | `~/.codex/` (或 `$CODEX_HOME`) |
| 会话文件 | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` |
| 归档会话 | `~/.codex/archived_sessions/*.jsonl` |
| 认证文件 | `~/.codex/auth.json` |
| OAuth API | `https://chatgpt.com/backend-api/wham/usage` |
| RPC 模式 | `codex -s read-only -a untrusted app-server` (JSON-RPC) |
| PTY 命令 | `/status` 获取使用情况 |

**Codex JSONL 格式分析 (基于 CodexBar):**
```jsonl
{"event_msg": {...}, "token_count": {...}, "turn_context": {...}}
```

### 2.3 Google Gemini CLI

| 项目 | 详情 |
|------|------|
| CLI 命令 | `gemini` |
| 数据目录 | `~/.gemini/` |
| 设置文件 | `~/.gemini/settings.json` |
| 认证文件 | `~/.gemini/oauth_creds.json` |
| 认证类型 | `oauth-personal`, `api-key`, `vertex-ai` |
| 配额 API | `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` |
| PTY 命令 | `/stats` 获取使用统计 |

**Gemini 认证流程:**
1. 读取 `~/.gemini/settings.json` 获取认证类型
2. 读取 `~/.gemini/oauth_creds.json` 获取 OAuth tokens
3. 如需刷新 token，需要从 Gemini CLI 安装目录提取 client_id/secret

## 3. 架构设计

### 3.1 Provider 抽象层

```
┌─────────────────────────────────────────────────────────┐
│                       Alice App                          │
├─────────────────────────────────────────────────────────┤
│                    Provider Manager                      │
│  ┌─────────────┬─────────────┬─────────────────────┐   │
│  │   Claude    │   Codex     │       Gemini        │   │
│  │  Provider   │  Provider   │      Provider       │   │
│  └─────────────┴─────────────┴─────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│               Unified Session/Usage API                  │
└─────────────────────────────────────────────────────────┘
```

### 3.2 核心 Rust 模块设计

#### 3.2.1 新增文件结构

```
src-tauri/src/
├── providers/
│   ├── mod.rs              # Provider trait 定义
│   ├── claude.rs           # Claude 提供商 (重构自现有代码)
│   ├── codex.rs            # Codex 提供商 (新增)
│   └── gemini.rs           # Gemini 提供商 (新增)
├── session.rs              # 通用会话解析 (保留现有)
├── session_claude.rs       # Claude 特定解析
├── session_codex.rs        # Codex 特定解析 (新增)
├── session_gemini.rs       # Gemini 特定解析 (新增)
└── ...
```

#### 3.2.2 Provider Trait 定义

```rust
// src-tauri/src/providers/mod.rs

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ProviderId {
    Claude,
    Codex,
    Gemini,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: ProviderId,
    pub enabled: bool,
    pub display_name: String,
    pub cli_command: String,
    pub data_dir: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub id: ProviderId,
    pub installed: bool,
    pub version: Option<String>,
    pub authenticated: bool,
    pub account_email: Option<String>,
    pub subscription_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsage {
    pub id: ProviderId,
    pub session_percent: f64,
    pub session_reset_at: Option<String>,
    pub weekly_percent: Option<f64>,
    pub weekly_reset_at: Option<String>,
    pub credits_remaining: Option<f64>,
    pub last_updated: i64,
    pub error: Option<String>,
}

#[async_trait]
pub trait Provider: Send + Sync {
    /// 获取提供商 ID
    fn id(&self) -> ProviderId;

    /// 获取配置
    fn config(&self) -> &ProviderConfig;

    /// 检查 CLI 是否安装
    async fn check_installed(&self) -> bool;

    /// 获取 CLI 版本
    async fn get_version(&self) -> Option<String>;

    /// 检查认证状态
    async fn check_auth(&self) -> bool;

    /// 获取账户信息
    async fn get_account_info(&self) -> Option<(String, String)>; // (email, plan)

    /// 获取使用情况
    async fn get_usage(&self) -> Result<ProviderUsage, String>;

    /// 获取会话目录
    fn get_session_dirs(&self) -> Vec<String>;

    /// 解析会话文件
    fn parse_session_file(&self, path: &std::path::Path) -> Result<ProviderSession, String>;

    /// 执行任务 (队列中的任务)
    async fn execute_task(&self, prompt: &str, project_path: Option<&str>) -> Result<TaskResult, String>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSession {
    pub provider: ProviderId,
    pub session_id: String,
    pub project_path: String,
    pub project_name: String,
    pub first_prompt: Option<String>,
    pub started_at: i64,
    pub last_active_at: i64,
    pub message_count: i32,
    pub total_tokens: i64,
    pub total_cost_usd: f64,
    pub model: Option<String>,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub exit_code: i32,
    pub output: String,
    pub tokens: Option<i64>,
    pub cost_usd: Option<f64>,
}
```

### 3.3 前端类型扩展

```typescript
// src/lib/types.ts

export type ProviderId = "claude" | "codex" | "gemini";

export interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  display_name: string;
  cli_command: string;
  data_dir: string;
  icon: string;
  color: string;
}

export interface ProviderStatus {
  id: ProviderId;
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  account_email: string | null;
  subscription_type: string | null;
}

export interface ProviderUsage {
  id: ProviderId;
  session_percent: number;
  session_reset_at: string | null;
  weekly_percent: number | null;
  weekly_reset_at: string | null;
  credits_remaining: number | null;
  last_updated: number;
  error: string | null;
}

// 扩展现有 Session 类型
export interface Session {
  provider: ProviderId;  // 新增
  session_id: string;
  // ... 其他字段保持不变
}

// 扩展 Task 类型
export interface Task {
  provider: ProviderId;  // 新增
  id: string;
  // ... 其他字段保持不变
}
```

## 4. 功能支持矩阵

| 功能 | Claude | Codex | Gemini | 备注 |
|------|--------|-------|--------|------|
| 会话监控 | ✅ | ✅ | ⚠️ | Gemini 会话格式需调研 |
| 实时使用情况 | ✅ | ✅ | ✅ | 各家 API 不同 |
| Token 统计 | ✅ | ✅ | ⚠️ | Gemini 格式待确认 |
| 成本计算 | ✅ | ✅ | ⚠️ | 需要各家定价数据 |
| 任务队列 | ✅ | ✅ | ✅ | CLI 命令执行 |
| 项目管理 | ✅ | ✅ | ✅ | 基于目录结构 |
| 状态检测 | ✅ | ✅ | ✅ | 文件修改时间 |
| OAuth 认证 | ✅ | ✅ | ✅ | 各家实现不同 |
| 每日报告 | ✅ | ✅ | ✅ | 统一格式 |

⚠️ = 需要进一步调研确认

## 5. 实现计划

### Phase 1: Provider 抽象层 (预计 2 天)

1. 创建 `providers/mod.rs`，定义 Provider trait
2. 重构现有 Claude 代码到 `providers/claude.rs`
3. 更新 `commands.rs` 使用 Provider 抽象
4. 更新数据库 schema 添加 `provider` 字段
5. 前端类型更新

### Phase 2: Codex 支持 (预计 3 天)

1. 实现 `providers/codex.rs`
2. 实现 `session_codex.rs` 解析 Codex JSONL
3. 添加 Codex 会话目录监控
4. 实现 Codex OAuth 使用情况获取
5. 支持 Codex 任务队列执行
6. 前端 UI 适配

### Phase 3: Gemini 支持 (预计 3 天)

1. 调研 Gemini CLI 会话文件格式
2. 实现 `providers/gemini.rs`
3. 实现 Gemini OAuth token 刷新
4. 实现配额 API 调用
5. 支持 Gemini 任务队列执行
6. 前端 UI 适配

### Phase 4: UI 增强 (预计 2 天)

1. Provider 切换/筛选 UI
2. 多 Provider 使用情况对比视图
3. Provider 设置面板
4. 统一的会话/任务列表（支持 Provider 过滤）

## 6. 数据库 Schema 变更

```sql
-- 会话表添加 provider 字段
ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';

-- 任务表添加 provider 字段
ALTER TABLE tasks ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';

-- 创建 provider 配置表
CREATE TABLE IF NOT EXISTS provider_configs (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    settings TEXT, -- JSON 格式的额外设置
    updated_at INTEGER NOT NULL
);
```

## 7. 配置文件变更

```json
// ~/.alice/config.json
{
  "providers": {
    "claude": {
      "enabled": true,
      "data_dir": "~/.claude"
    },
    "codex": {
      "enabled": true,
      "data_dir": "~/.codex"
    },
    "gemini": {
      "enabled": true,
      "data_dir": "~/.gemini"
    }
  },
  // ... 其他配置
}
```

## 8. 风险与挑战

### 8.1 技术风险

1. **Codex JSONL 格式差异**
   - Codex 的 JSONL 格式与 Claude 不同
   - 需要单独解析逻辑
   - 解决方案: 参考 CodexBar 的解析实现

2. **Gemini 会话数据**
   - Gemini CLI 可能不像 Claude/Codex 那样持久化会话
   - 需要进一步调研 `~/.gemini/` 目录结构
   - 解决方案: 如无会话文件，仅支持使用情况监控和任务队列

3. **OAuth Token 刷新**
   - 各 Provider 的 OAuth 实现不同
   - Gemini 需要从 CLI 安装目录提取 client_id/secret
   - 解决方案: 参考 CodexBar 的实现

### 8.2 用户体验

1. **多 Provider 切换**
   - 需要清晰的 UI 区分不同 Provider 的数据
   - 建议使用颜色编码和图标区分

2. **统一 vs 分离视图**
   - 用户可能希望看到所有 Provider 的统一视图
   - 也可能希望按 Provider 分开查看
   - 解决方案: 提供过滤器和切换选项

## 9. 优先级建议

考虑到 OpenAI Codex CLI 和 Claude Code 的相似性（都使用 JSONL 格式），建议：

1. **首先实现 Codex 支持** - 技术复杂度较低，与现有架构相似
2. **其次实现 Gemini 支持** - 需要更多调研工作
3. **最后完善 UI** - 在功能稳定后优化用户体验

## 10. 参考资源

- [CodexBar GitHub](https://github.com/steipete/CodexBar)
- [CodexBar Codex Provider Docs](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)
- [CodexBar Gemini Provider Docs](https://github.com/steipete/CodexBar/blob/main/docs/gemini.md)
- [CodexBar Provider Authoring Guide](https://github.com/steipete/CodexBar/blob/main/docs/provider.md)

## 11. 附录: Codex JSONL 详细格式

基于 CodexBar 的分析，Codex JSONL 包含以下关键字段:

```jsonl
{
  "event_msg": {
    // 事件消息内容
  },
  "token_count": {
    "input": 1234,
    "output": 567,
    "cached": 89
  },
  "turn_context": {
    "model": "gpt-4o"
  }
}
```

会话文件路径模式:
- 当前会话: `~/.codex/sessions/YYYY/MM/DD/<session-id>.jsonl`
- 归档会话: `~/.codex/archived_sessions/<session-id>.jsonl`

## 12. 附录: Gemini 配额 API

```http
POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
Authorization: Bearer <access_token>
Content-Type: application/json

{"project": "<projectId>"}
```

响应包含:
- `remainingFraction` - 剩余配额比例 (0-1)
- `resetTime` - ISO-8601 格式的重置时间
- `modelId` - 模型 ID (Pro/Flash 等)
