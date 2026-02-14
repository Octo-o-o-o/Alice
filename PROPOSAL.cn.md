# Alice - Claude Code 桌面助手

> 一个轻量级菜单栏应用，用于管理所有本地项目中的 Claude Code 任务、会话和工作流程。

## 1. 项目愿景

Alice 是一款 macOS 菜单栏桌面助手，它是 Claude Code (CC) 的可视化包装层，为命令行优先的工作流程提供**可视化控制界面**。它解决了核心痛点：CC 功能强大但缺乏可视化 —— 你无法一目了然地看到各会话的运行状态，无法排队任务，完成时无法收到通知，也无法在一个地方管理多个项目。

### 目标用户

每天在 2-5 个以上本地项目中使用 CC 的独立开发者，他们希望：
- 无需切换终端即可一目了然地查看所有 CC 活动
- 排队任务并在完成时收到通知
- 即时搜索历史记录并恢复会话
- 跟踪跨项目和时间段的使用量/成本
- 维护一个持久的待办事项列表，可直接转化为 CC 任务

---

## 2. 解决的痛点（来自社区调研）

基于 GitHub issues、社区讨论和用户工作流程的研究：

| # | 痛点 | 来源 | Alice 解决方案 |
|---|---|---|---|
| 1 | **无任务完成通知** — 用户切换标签页后错过 CC 完成的时机 | [GitHub #7069](https://github.com/anthropics/claude-code/issues/7069) | 原生 macOS 通知 + 菜单栏状态指示器 |
| 2 | **无任务队列** — 无法说"完成这个后，做那个" | 社区请求 | 支持链式和自动执行的任务队列 |
| 3 | **会话搜索困难** — `--resume` 显示列表但无搜索、无预览 | [GitHub #4707](https://github.com/anthropics/claude-code/issues/4707) | 跨所有会话的全文搜索和预览 |
| 4 | **无按项目使用量跟踪** — `/cost` 只显示当前会话 | [ccusage](https://github.com/ryoppippi/ccusage) | 按项目、按天、按会话的使用量仪表板 |
| 5 | **压缩后上下文丢失** — CC 忘记它正在做什么 | [GitHub #2954](https://github.com/anthropics/claude-code/issues/2954) | 独立于 CC 会话的持久待办/任务状态 |
| 6 | **无多项目概览** — 每个终端都是隔离的 | [GitHub #4689](https://github.com/anthropics/claude-code/issues/4689) | 统一的跨项目仪表板 |
| 7 | **无每日报告** — 难以回忆 CC 帮助完成了什么 | [GitHub #12455](https://github.com/anthropics/claude-code/issues/12455) | 从会话 + git 提交自动生成每日报告 |
| 8 | **待办列表消失** — CC 的 TodoWrite 是会话范围的 | 社区解决方法：plan.md 文件 | 持久化的全局待办系统 |
| 9 | **后台任务发现** — 无法列出正在运行的 CC 进程 | [GitHub #7069](https://github.com/anthropics/claude-code/issues/7069) | 所有 CC 实例的进程监视器 |
| 10 | **会话命名** — 自动生成的名称不可用 | [GitHub #4707](https://github.com/anthropics/claude-code/issues/4707) | 自定义会话标签/标记 |

---

## 3. 技术架构

### 3.1 技术栈

| 层级 | 技术 | 理由 |
|---|---|---|
| **桌面外壳** | Tauri 2.0 (Rust) | ~10MB 包体积，~30MB 空闲内存，<0.5s 启动，原生 macOS 托盘支持 |
| **前端** | React + TypeScript + Tailwind CSS | 快速 UI 开发，丰富的生态系统，Tauri 有官方 React 模板 |
| **状态管理** | Zustand | 轻量级，无样板代码，适合菜单栏应用 |
| **本地数据库** | SQLite (通过 Tauri 后端的 `rusqlite`) | 对会话历史、使用数据的快速索引搜索 |
| **文件监听** | `notify` crate (Rust，跨平台 FSEvents 包装) | 监听 `~/.claude/` 以实时感知会话变化 |
| **CC 集成** | CLI 子进程 + 本地文件解析 | 读取 JSONL 转录，调用 `claude -p` 执行无头任务 |
| **通知** | Tauri 通知插件 + macOS 原生 | 带操作按钮的系统通知 |

### 3.2 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Alice (Tauri 应用)                        │
│                                                                  │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  菜单栏 UI   │  │   弹出面板       │  │   完整窗口        │  │
│  │  (React)     │  │   (React)        │  │   (React)         │  │
│  │  - 状态      │  │   - 任务列表     │  │   - 历史记录      │  │
│  │  - 快捷      │  │   - 活动 CC      │  │   - 使用量图表    │  │
│  │    操作      │  │   - 待办         │  │   - 每日报告      │  │
│  │              │  │   - 通知         │  │   - 设置          │  │
│  └──────┬───────┘  └────────┬─────────┘  └────────┬──────────┘  │
│         │                   │                      │             │
│  ┌──────┴───────────────────┴──────────────────────┴──────────┐  │
│  │                     Tauri IPC 桥接                         │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                             │                                     │
│  ┌──────────────────────────┴──────────────────────────────────┐  │
│  │                    Rust 后端核心                            │  │
│  │                                                              │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────┐  │  │
│  │  │ 文件监听器  │ │ 会话解析器   │ │ 进程管理器           │  │  │
│  │  │ (~/.claude/)│ │ (JSONL→数据)│ │ (启动/监控 CC)       │  │  │
│  │  └─────────────┘ └──────────────┘ └──────────────────────┘  │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────┐  │  │
│  │  │ SQLite 数据库│ │ 使用量计算  │ │ 通知引擎             │  │  │
│  │  │ (索引/待办) │ │ (token/成本)│ │ (macOS 原生)         │  │  │
│  │  └─────────────┘ └──────────────┘ └──────────────────────┘  │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────┐  │  │
│  │  │ 任务队列    │ │ 报告生成    │ │ CC CLI 包装器        │  │  │
│  │  │ (链式/执行) │ │ (每日/每周) │ │ (claude -p ...)      │  │  │
│  │  └─────────────┘ └──────────────┘ └──────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                             │                                     │
└─────────────────────────────┼─────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    ┌─────┴──────┐  ┌────────┴───────┐  ┌───────┴────────┐
    │ ~/.claude/  │  │ claude CLI     │  │ git 仓库       │
    │ sessions/  │  │ (子进程)       │  │ (提交历史)     │
    │ history    │  │                │  │                 │
    │ todos/     │  │                │  │                 │
    │ stats      │  │                │  │                 │
    └────────────┘  └────────────────┘  └────────────────┘
```

### 3.3 数据流

```
1. 文件监听器监控 ~/.claude/ 目录
   ↓
2. 文件变化时 → 会话解析器读取 JSONL，提取：
   - 会话元数据（项目、开始时间、状态）
   - Token 使用量（每条消息的输入/输出/缓存）
   - 工具调用和结果
   - 用户提示词（用于搜索索引）
   ↓
3. 数据索引到 SQLite 以实现快速搜索
   ↓
4. 通过 Tauri 事件更新前端（推送模式）
   ↓
5. 用户操作 → Tauri 命令 → Rust 后端 → CLI 子进程
```

---

## 4. 功能规格

### 4.1 任务跟踪与完成通知

**功能**：监控所有项目中的所有活动 CC 会话，实时显示其状态，并在任务完成或需要输入时发送 macOS 通知。

**实现**：

```
数据源：~/.claude/projects/*/（监听所有项目目录）
检测：
  - 活动会话：JSONL 文件正在被写入（mtime 变化中）
  - 等待输入：最后一条消息是"assistant"类型且无待处理的工具调用
  - 已完成：assistant 消息后会话文件停止更新超过 30 秒
  - 错误：带有 error 子类型的 system 类型消息
```

**UI 元素**：
- 菜单栏图标变色：灰色(空闲) / 蓝色(运行中) / 绿色(完成) / 黄色(需要输入) / 红色(错误)
- 菜单栏显示活动会话数量：`CC ⟨3⟩`
- 弹出面板：活动会话列表，显示项目名称、提示词预览、持续时间、状态
- 完成时的 macOS 通知："ProjectA 中的任务已完成：重构了认证模块（3分42秒）"

**通知类型**（可配置）：
| 事件 | 默认 | 操作 |
|---|---|---|
| 任务完成 | 开启 | 点击 → 复制恢复命令到剪贴板 + 打开 Alice |
| 需要用户输入 | 开启（带声音） | 点击 → 复制 `claude --resume <id>` 到剪贴板 |
| 任务错误 | 开启 | 点击 → 在 Alice 面板中查看错误详情 |
| 队列项开始 | 开启 | 信息通知 |
| 每日报告就绪 | 开启 | 点击 → 在 Alice 中查看报告 |

> **终端集成说明**：macOS 通知无法直接激活任意终端窗口。第一阶段使用基于剪贴板的工作流程（复制恢复命令）。第二阶段将添加 AppleScript 集成，支持 iTerm2 和 Terminal.app 自动聚焦到正确的窗口。

### 4.2 任务队列

**功能**：定义自动执行的任务序列。当一个完成时，下一个开始 —— 在同一会话（--continue）或新会话中。

**数据模型**：
```typescript
interface TaskQueueItem {
  id: string;
  prompt: string;                    // CC 的指令
  project: string;                   // 项目目录的绝对路径
  executionMode: 'continue' | 'new'; // 同一会话或新会话
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  dependsOn?: string;               // 前置任务的 ID
  sessionId?: string;               // 开始时分配
  systemPrompt?: string;            // 可选的系统提示词覆盖
  allowedTools?: string[];           // 工具限制
  maxBudget?: number;               // 美元限制
  maxTurns?: number;                // 轮次限制
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: {
    exitCode: number;
    output: string;                  // 来自 --output-format json 的摘要
    tokensUsed: number;
    costUsd: number;
  };
}

interface TaskQueue {
  id: string;
  name: string;
  items: TaskQueueItem[];
  status: 'idle' | 'running' | 'paused' | 'completed';
  createdAt: string;
}
```

**执行逻辑**：
```
1. 用户创建队列：[任务 A, 任务 B, 任务 C]
2. Alice 启动任务 A：
   claude -p "任务 A 提示词" --output-format json --max-turns 50 \
     --cwd /path/to/project
3. 完成后 → 解析 JSON 输出 → 存储结果
4. 如果成功 → 启动任务 B（同一会话用 --continue，不同会话则新建）
5. 如果失败 → 暂停队列，通知用户，提供选项：重试 / 跳过 / 中止
```

**UI**：队列面板，支持拖拽重排序、添加/删除、暂停/恢复、每项状态指示器。

### 4.3 会话历史搜索与恢复

**功能**：跨所有项目的所有 CC 会话进行全文搜索，支持预览和一键恢复。

**数据源**：
```
~/.claude/history.jsonl          → 主索引（提示词、项目、sessionId、时间戳）
~/.claude/projects/*//*.jsonl  → 完整转录（用于深度搜索）
```

**SQLite 索引结构**：
```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,      -- 从路径提取
  first_prompt TEXT,                -- 用户的开场消息
  all_prompts TEXT,                 -- 所有用户消息连接（FTS）
  label TEXT,                       -- 用户分配的名称
  tags TEXT,                        -- 用户分配的标签（JSON 数组）
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

**搜索功能**：
- 键入时即时模糊搜索
- 按以下条件过滤：项目、日期范围、模型、状态
- 预览：匹配会话的前 3 条消息
- 操作：恢复（`claude --resume <id>`）、分叉（`--fork-session`）、复制会话 ID、删除

**UI**：弹出面板顶部的搜索栏，结果以卡片形式显示项目徽章、提示词预览、日期、token 数量。

### 4.4 使用量仪表板

**功能**：在项目、会话和时间粒度上跟踪和可视化 CC 使用量。

**数据源**：
```
1. ~/.claude/stats-cache.json          → 每日汇总统计
2. ~/.claude/projects/*/*.jsonl        → 来自 API 响应的每条消息 token 计数
3. ~/.claude/telemetry/*               → 额外的使用数据
```

**Token/成本提取**（从 JSONL 中每条 assistant 消息，**已根据实际本地文件验证**）：
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
> 注意：`cache_creation` 子对象区分 5 分钟 vs 1 小时缓存，实现精确的成本计算。`service_tier` 和 `inference_geo` 可用于价格调整。

**成本计算**（使用公开的 Anthropic API 定价，每百万 token）：
```typescript
const PRICING = {
  'claude-opus-4-6': {
    input:        5.0,    output:       25.0,
    cache_5min:   6.25,   cache_1h:    10.0,   cache_read: 0.50,
    // 长上下文（>200K tokens）：input 10.0, output 37.50
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
    long_input:   1.0,    long_output:   5.0,   // 无长上下文附加费
  },
};
```

**缓存写入时长检测** — JSONL usage 对象包含：
```json
{
  "cache_creation": {
    "ephemeral_5m_input_tokens": 0,    // 5 分钟缓存（1.25 倍基础价）
    "ephemeral_1h_input_tokens": 28649 // 1 小时缓存（2 倍基础价）
  }
}
```
Alice 可以从此字段区分 5 分钟 vs 1 小时缓存写入并应用正确的定价。

**仪表板视图**：
| 视图 | 数据 | 可视化 |
|---|---|---|
| 今日 | 活动会话、目前 token 数、预估成本 | 实时计数器 |
| 本周 | 按项目的每日细分 | 堆叠条形图 |
| 本月 | 每周趋势、热门项目 | 折线图 + 项目表格 |
| 按项目 | 所选项目的累计统计 | 摘要卡片 |
| 按会话 | 特定会话的 token 细分 | 饼图（输入/输出/缓存） |

**Max/Pro 订阅用户注意**：即使成本已包含在订阅中，也显示 token 数量和会话数量，并提供开关来显示/隐藏预估成本等价值。

### 4.5 待办系统

**功能**：持久化的全局待办列表，用于记录你想让 CC 稍后完成的事项。独立于任何 CC 会话。

**数据模型**：
```typescript
interface TodoItem {
  id: string;
  text: string;                     // 你想完成的事项
  project?: string;                 // 可选：哪个项目
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  sessionId?: string;               // 执行时关联的会话
  notes?: string;                   // 额外上下文
  tags?: string[];                  // 分类
  estimatedComplexity?: 'quick' | 'medium' | 'large';
}
```

**存储**：SQLite 表 `todos`（Alice 本地，不在 `~/.claude/` 中）。

**UI 功能**：
- 从菜单栏快速添加（键盘快捷键：`Cmd+Shift+T`）
- 拖拽重排优先级
- 按项目/优先级/状态过滤
- 内联编辑
- 一键"执行" → 创建 CC 任务并启动

### 4.6 待办 → 任务流水线

**功能**：选择待办事项，让 CC 分析它们并生成结构化的任务计划，然后执行选定的任务。

**工作流程**：
```
1. 用户从列表中选择 N 个待办事项
2. Alice 组合提示词：
   "基于这些待办事项，生成一个包含依赖关系和执行顺序的任务计划：
    - [待办 1 文本]（项目：X）
    - [待办 2 文本]（项目：Y）
    ..."
3. 以无头模式调用 CC：
   claude -p "<提示词>" --output-format json --json-schema '<TaskPlanSchema>'
4. CC 返回结构化计划：
   { tasks: [ { name, prompt, project, dependsOn, estimatedTurns } ] }
5. Alice 显示计划供用户审核
6. 用户勾选/取消勾选任务，调整顺序
7. 用户点击"执行选中项"
8. Alice 创建 TaskQueue 并开始执行
9. 任务完成时 → 相应的待办事项标记为已完成
```

**智能功能**：
- CC 可以读取项目的 CLAUDE.md 文件获取上下文
- 可以自动检测待办事项属于哪个项目
- 根据依赖关系建议任务顺序
- 根据待办描述估算复杂度

### 4.7 每日报告

**功能**：自动生成跨所有项目的 CC 辅助工作的每日摘要。

**数据收集**（在用户配置的时间运行，默认 18:00）：
```
1. 今日会话：
   - 解析所有带今日时间戳的会话 JSONL
   - 提取：提示词、关键工具调用（Edit、Write、Bash）、会话持续时间

2. 今日 Git 提交：
   - 对每个跟踪的项目：git log --since="today 00:00" --format="%H|%s|%an|%ai"
   - 过滤 CC 辅助的提交（Co-Authored-By: Claude）

3. 更改的文件：
   - 从会话转录中：收集所有 Edit/Write 工具调用
   - 按项目分组

4. 今日使用量：
   - 每个项目的总 token 数、成本、会话数
```

**报告生成**：
```bash
claude -p "基于以下数据生成简洁的每日开发报告：

会话：[会话摘要]
提交：[提交列表]
更改的文件：[按项目的文件列表]
使用量：[token/成本摘要]

格式为 markdown，包含以下章节：
## 摘要（2-3 句话）
## 完成事项（项目符号列表）
## 涉及的项目
## 做出的关键决策
## 明日优先事项（基于未完成的待办/队列项）
## 使用统计" \
  --output-format json --model sonnet --max-turns 1
```

**交付方式**：
- 在 Alice 面板中显示
- 可选：复制到剪贴板作为 markdown
- 可选：自动追加到每日日志文件（可配置路径）
- 可选：发送到 Slack/webhook（未来）

---

## 5. 数据架构

### 5.1 Alice 自有存储

```
~/.alice/                           # Alice 应用数据
  config.json                       # 用户偏好设置
  alice.db                          # SQLite 数据库（会话索引、待办、使用量缓存、队列）
  reports/                          # 生成的每日报告
    2026-02-14.md
  logs/                             # 应用日志
```

### 5.2 SQLite 结构（完整）

```sql
-- 会话索引（从 ~/.claude/ 同步）
CREATE TABLE sessions (...);        -- 见 4.3
CREATE TABLE session_messages (...); -- 见 4.3

-- 使用量跟踪
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
CREATE INDEX idx_todos_status ON todos(status, priority);

-- 待办系统
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  project_path TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'pending',
  notes TEXT,
  tags TEXT,                         -- JSON 数组
  estimated_complexity TEXT,
  linked_session_id TEXT,
  linked_queue_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 任务队列
CREATE TABLE task_queues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'idle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE task_queue_items (
  id TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  project_path TEXT NOT NULL,
  execution_mode TEXT DEFAULT 'new',
  status TEXT DEFAULT 'pending',
  depends_on TEXT,
  session_id TEXT,
  system_prompt TEXT,
  allowed_tools TEXT,                -- JSON 数组
  max_budget_usd REAL,
  max_turns INTEGER,
  sort_order INTEGER NOT NULL,
  result_exit_code INTEGER,
  result_output TEXT,
  result_tokens INTEGER,
  result_cost_usd REAL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (queue_id) REFERENCES task_queues(id) ON DELETE CASCADE
);

-- 每日报告
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

-- 项目注册表
CREATE TABLE projects (
  path TEXT PRIMARY KEY,
  display_name TEXT,
  last_active_at TEXT,
  total_sessions INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0
);
```

### 5.3 CC 文件解析策略

**JSONL 转录解析器**（Rust）：
```
对 .jsonl 中的每一行：
  1. 解析 JSON
  2. 根据 "type" 字段匹配：
     - "user" → 提取提示词文本、时间戳
     - "assistant" → 提取使用量（token）、模型、内容
     - "system" → 检测错误、api_error、压缩事件
  3. 增量构建会话元数据
  4. 通过 Tauri 事件向前端发送事件
```

**性能考虑**：
- JSONL 文件可能很大（100KB-10MB+）
- 使用增量解析：跟踪文件偏移量，只读取新行
- 首次扫描时在 SQLite 中建立索引，之后增量更新
- 文件监听器防抖：在 500ms 窗口内批量更新

---

## 6. UI 设计

### 6.1 菜单栏图标

```
状态：
  ● (灰色)    — 无活动会话
  ● (蓝色)    — 会话运行中
  ● (绿色)    — 最近完成
  ● (黄色)    — 需要用户输入
  ● (红色)    — 发生错误

带计数徽章：CC⟨3⟩ = 3 个活动会话
```

### 6.2 弹出面板（点击菜单栏图标）

```
┌─────────────────────────────────────┐
│ 🔍 搜索会话...              ⌘K    │
├─────────────────────────────────────┤
│ ▸ 活动中 (2)                        │
│   ┌─────────────────────────────┐   │
│   │ 🔵 项目A                    │   │
│   │ "重构认证模块..."           │   │
│   │ ⏱ 3分42秒  📊 12K tokens   │   │
│   └─────────────────────────────┘   │
│   ┌─────────────────────────────┐   │
│   │ 🟡 项目B                    │   │
│   │ "修复登录页面 CSS..."       │   │
│   │ ⏱ 1分15秒  ⚠ 需要输入      │   │
│   └─────────────────────────────┘   │
├─────────────────────────────────────┤
│ ▸ 队列 (3 个待处理)                 │
│   下一个："为...添加单元测试"       │
├─────────────────────────────────────┤
│ ▸ 待办 (5)                          │
│   □ 优化数据库查询                  │
│   □ 为 API 添加错误处理             │
│   □ 为新模块编写 README             │
│   + 添加待办...                     │
├─────────────────────────────────────┤
│ 📊 今日：45K tokens · $0.82        │
│ ━━━━━━━━━━━━━━━━━━━░░░░░ 3 个会话   │
├─────────────────────────────────────┤
│ [📋 报告] [📊 使用量] [⚙ 设置]     │
└─────────────────────────────────────┘
```

### 6.3 完整窗口（用于详细视图）

标签页：**历史** | **使用量** | **报告** | **设置**

- **历史**：完整的会话列表，支持搜索、过滤、会话详情视图
- **使用量**：token/成本分析的图表和表格
- **报告**：今日报告 + 历史报告
- **设置**：通知偏好、项目路径、API 定价、快捷键、报告计划

---

## 7. 跨项目架构

### 7.1 项目发现

```
从以下来源自动发现项目：
1. ~/.claude/projects/ 目录 → 所有编码的项目路径
2. ~/.claude/history.jsonl → 所有唯一的项目路径
3. 在 Alice 设置中手动注册

每个发现的项目获得：
- 显示名称（从路径提取，用户可重命名）
- 颜色标签（在 UI 中视觉区分）
- CC 配置信息（如果有 CLAUDE.md）
```

### 7.2 统一数据模型

所有功能默认跨项目工作：
- 会话搜索跨所有项目（带项目过滤器）
- 使用量仪表板显示按项目细分
- 待办事项可以是项目特定的或全局的
- 任务队列可以跨不同项目链接任务
- 每日报告汇总所有项目

---

## 8. 关键技术挑战与解决方案

### 8.1 在没有 API 的情况下检测会话状态

**挑战**：CC 不暴露"运行中会话"API。如何知道什么是活动的？

**解决方案**：分层检测策略（按优先级）：

```
主要 — 基于 Hooks（最可靠）：
  安装 CC hooks（SessionStart、Stop、SessionEnd），将事件写入
  ~/.alice/hooks-events.jsonl。实时、结构化的状态变化。
  Alice 首次运行时在 ~/.claude/settings.json 中自动配置。

次要 — 文件监听（后备，始终开启）：
  1. 文件 mtime：*.jsonl mtime 在过去 10 秒内变化 → 可能活动中
  2. 最后消息分析：解析最后的 JSONL 条目：
     - assistant 且 stop_reason=null → 仍在流式传输
     - assistant 且 stop_reason="end_turn" → 已完成或等待中
  3. 尾读最后 3 条以确定对话流状态

第三 — 进程检测（用于交叉验证）：
  `ps -eo pid,command | grep "[c]laude"`（方括号技巧避免自匹配）
  通过 lsof 在 JSONL 文件上匹配 PID 到会话
```

### 8.2 无需轮询的实时更新

**挑战**：需要在会话变化时更新 UI，但不进行昂贵的轮询。

**解决方案**：Rust `notify` crate 递归监听 `~/.claude/projects/`：
```rust
use notify::{Watcher, RecursiveMode, watcher};

let (tx, rx) = channel();
let mut watcher = watcher(tx, Duration::from_millis(500))?;
watcher.watch(claude_dir, RecursiveMode::Recursive)?;

for event in rx {
    match event {
        DebouncedEvent::Write(path) | DebouncedEvent::Create(path) => {
            if path.extension() == Some("jsonl") {
                // 解析新行，更新索引，推送到前端
                tauri_app.emit("session-updated", session_data);
            }
        }
        _ => {}
    }
}
```

### 8.3 任务队列的无头 CC 执行

**挑战**：以编程方式运行 CC 任务，捕获结果，处理错误。

**解决方案**：带输出解析的子进程管理：
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

### 8.4 大型 JSONL 文件处理

**挑战**：会话文件可能达到 10MB+，完整解析代价高昂。

**解决方案**：基于时间戳的增量解析（对压缩健壮）：
```rust
struct SessionTracker {
    path: PathBuf,
    last_processed_ts: i64,  // 最后处理条目的时间戳
    file_size: u64,          // 用于快速"文件是否增长？"检查
}

impl SessionTracker {
    fn read_new_entries(&mut self) -> Vec<JsonLine> {
        let metadata = fs::metadata(&self.path)?;
        let current_size = metadata.len();

        // 快速路径：文件未变化
        if current_size == self.file_size { return vec![]; }

        // 如果文件缩小（发生压缩），从头重新解析
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
> 压缩安全：如果会话文件被压缩（缩小），解析器使用时间戳去重从头重新扫描。正常追加使用快速"仅新行"路径。

### 8.5 并发与数据安全

**SQLite 写入序列化**：
多个 Rust 线程（文件监听器、进程监视器、队列执行器）可能并发写入 SQLite。解决方案：基于通道消息传递的单写入器架构。

```rust
// 所有数据库写入通过单一通道
enum DbCommand {
    UpdateSession(SessionData),
    UpdateUsage(UsageRecord),
    UpdateTodo(TodoItem),
    UpdateQueueItem(QueueItemUpdate),
}

// 单写入器线程
fn db_writer(rx: Receiver<DbCommand>, db: Connection) {
    for cmd in rx {
        match cmd {
            DbCommand::UpdateSession(s) => { /* 更新插入会话 */ },
            // ...
        }
    }
}
```

**多实例防止**：在 `~/.alice/alice.lock` 使用带 PID 的锁文件。启动时检查现有 PID 是否存活；如果是，将现有实例带到前台。

**队列崩溃恢复**：队列状态在每次状态变化时持久化到数据库。启动时检查孤立的 `running` 项 → 标记为 `interrupted`，通知用户重试或跳过。

### 8.6 边缘情况

| 场景 | 处理方式 |
|---|---|
| 项目目录被删除 | 会话标记为"已归档项目"，仍可搜索 |
| 队列期间手动使用 CC | 如果在同一项目检测到冲突则暂停队列；不同项目可并行 |
| JSONL 文件损坏（格式错误的行） | 跳过坏行，记录警告，继续解析其余部分 |
| CC CLI 版本不匹配 | 启动时版本检查，不兼容时警告，在配置中存储版本 |
| `~/.claude/` 有 100+ 个项目 | 选择性监听：只监听活动项目（mtime < 30 天），可配置 |
| macOS 权限被拒绝 | 首次运行向导请求文件访问；如被拒绝则优雅降级 |
| CC 订阅（Max/Pro） | Token 数据仍写入 JSONL（已验证）；显示 token 数 + 可选成本等价值 |

### 8.7 结构迁移

在 Rust 中使用嵌入式迁移系统（例如 `refinery` crate）：
```
migrations/
  V001__initial_schema.sql
  V002__add_session_labels.sql
  V003__add_long_context_pricing.sql
```

应用启动时自动应用待处理的迁移。结构版本存储在 `alice.db` 元数据表中。

---

## 9. 开发计划

### 第一阶段：基础（第 1-2 周）

**目标**：带会话监控的基础 Tauri 菜单栏应用

| 任务 | 描述 |
|---|---|
| 项目脚手架 | `npm create tauri-app@latest alice -- --template react-ts` |
| 菜单栏托盘设置 | 带基础上下文菜单的 Tauri 托盘图标 |
| 弹出面板外壳 | 带标签页骨架的 React 弹出窗口 |
| JSONL 解析器（Rust） | 解析 CC 会话转录，提取元数据（**通过 message.id + requestId 进行流式去重**） |
| 文件监听器 | 使用 `notify` crate 监听 `~/.claude/` |
| 会话列表 UI | 从文件数据显示活动/最近的会话 |

**交付物**：显示最近 CC 会话列表的菜单栏应用。

### 第二阶段：核心功能（第 3-4 周）

**目标**：通知、搜索、使用量条和待办系统

| 任务 | 描述 |
|---|---|
| 通知引擎 | 会话事件的 macOS 原生通知 |
| 会话状态检测 | 多信号活动/空闲/完成检测 |
| SQLite 集成 | 设置数据库、索引器、FTS |
| 会话搜索 UI | 带即时结果的搜索栏 |
| 会话恢复 | 通过 `claude --resume` 一键恢复 |
| 待办 CRUD | 完整的待办管理和 SQLite 存储 |
| 快速添加热键 | 全局热键 `Cmd+Shift+T` 用于待办输入 |
| **OAuth 使用量 API** | **从 `api.anthropic.com/api/oauth/usage` 获取实时会话/周使用量百分比**（参考：CodexBar） |
| **5 小时窗口跟踪** | **跟踪会话窗口使用量和重置倒计时**（参考：ccusage） |
| **双条计量图标** | **菜单栏图标显示会话 + 周使用量条**（参考：CodexBar） |

**交付物**：带通知、搜索和实时使用量计量器的助手。

### 第三阶段：高级功能（第 5-7 周）

**目标**：任务队列、成本跟踪、每日报告、多账户

| 任务 | 描述 |
|---|---|
| 任务队列引擎 | 队列数据模型、执行循环、错误处理 |
| 任务队列 UI | 带拖拽重排序的可视化队列编辑器 |
| 使用量计算器 | 从 JSONL 转录提取 Token/成本 |
| 使用量仪表板 UI | 图表（考虑 recharts 或 visx） |
| **消耗速率预测** | **估算用户何时将达到会话/周限制**（参考：Claude-Code-Usage-Monitor） |
| 报告生成器 | 收集数据 + CC 无头调用生成报告 |
| 报告 UI | 带 markdown 渲染的报告查看器 |
| 待办→任务流水线 | CC 驱动的任务计划生成 |
| **多账户支持** | **读取 Keychain 凭据，账户切换 UI**（参考：CodexBar） |
| **Anthropic 状态监控** | **轮询 status.anthropic.com，显示事件徽章**（参考：CodexBar） |

**交付物**：带多账户和预测性使用量的功能完整助手。

### 第四阶段：打磨（第 8-10 周）

**目标**：生产质量

| 任务 | 描述 |
|---|---|
| 设置页面 | 所有配置选项 |
| 引导流程 | 首次运行项目发现向导 + OAuth 凭据检测 |
| 性能优化 | 增量解析、懒加载、内存分析 |
| 错误处理 | 优雅降级、重试逻辑 |
| 自动更新 | Tauri updater 插件（Sparkle 等效） |
| 打包和分发 | DMG 构建、代码签名（可选）、`brew install --cask` |
| 文档 | README、用户指南 |
| **语音通知选项** | **通过 macOS `say` 命令的可选 TTS 提醒**（参考：CCNotify） |

**交付物**：可分发的 macOS 应用程序。

---

## 10. 风险分析

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| CC 文件格式变更 | 高 — 破坏解析 | 版本检测、适配器模式、锁定格式版本 |
| CC 添加原生 GUI | 中等 — 降低价值 | 专注于 CC 不会添加的跨项目 + 队列功能 |
| 大型 `~/.claude/` 目录 | 中等 — 索引慢 | 增量解析、后台索引器、可配置深度 |
| macOS 上的 Tauri WebKit 怪癖 | 低 — CSS 问题 | 使用良好支持的 CSS，在多个 macOS 版本上测试 |
| CC CLI 破坏性变更 | 中等 — 执行失败 | 用版本检查包装 CLI 调用、后备逻辑 |
| Rust 学习曲线 | 中等 — 开发速度 | 先重前端，Rust 只用于性能关键路径 |
| macOS 权限问题 | 中等 — 无法读取文件 | 首次运行向导、优雅降级、文档 |
| 并发手动 CC 使用 | 低 — 队列冲突 | 检测冲突、暂停队列、通知用户 |
| 数据隐私（数据库中的代码） | 低 — 安全顾虑 | SQLite 仅本地，无网络；稍后可选数据库加密 |

---

## 11. 待解决问题（需要用户输入）

1. ~~**CC 订阅模式**~~：Token 使用数据**已确认存在**于所有用户类型的 JSONL 中。始终显示 token，成本等价值作为可选开关。→ **已解决**

2. **任务队列并发**：我们是否应该支持跨不同项目并行运行多个队列项？→ **建议：从顺序开始，稍后将跨项目并行作为可选功能添加**

3. **报告交付**：除了应用内查看，我们是否应该支持自动推送到外部服务（Slack、Notion 等）？→ **建议：第一阶段剪贴板 + 文件，未来添加 webhooks**

4. **自动启动**：Alice 是否应该在 macOS 登录时启动？→ **建议：是，通过设置可选**

5. **命名**：项目名为"Alice"。这是最终产品名称吗？→ **需要用户确认**

6. **Hooks 自动安装**：Alice 是否应该自动将 hooks 添加到 `~/.claude/settings.json` 用于事件检测，还是需要手动设置？→ **建议：首次运行时经用户同意自动安装**

---

## 12. 成功指标

| 指标 | 目标 |
|---|---|
| 空闲内存使用 | < 50MB |
| 启动时间 | < 1 秒 |
| 会话列表刷新 | 文件变化后 < 200ms |
| 搜索响应 | 10K+ 会话 < 100ms |
| 通知延迟 | CC 完成后 < 3 秒 |
| 包体积 | < 15MB |

---

## 13. 未来增强（MVP 之后）

- **远程会话监控**：跟踪 `--remote` 网页会话
- **团队仪表板**：跨团队成员汇总使用量
- **AI 洞察**："你本周在 ProjectA 上多花了 40% 的 token，考虑在 CLAUDE.md 中添加更多上下文"
- **会话回放**：CC 会话的可视化回放
- **MCP 集成**：将 Alice 作为 MCP 服务器运行，CC 可以回调
- **iOS 伴侣应用**：长任务完成时向手机推送通知
- **插件系统**：社区扩展用于自定义集成

---

## 附录 A：CC 数据格式参考

### history.jsonl 条目
```json
{
  "display": "用户提示词文本",
  "pastedContents": {},
  "timestamp": 1766392515891,
  "project": "/Users/user/WorkSpace/Project",
  "sessionId": "7ce5e7dc-bfe9-4cae-a3aa-e742685fe371"
}
```

### 会话 JSONL 消息类型
```
type: "user"        → 带提示词的用户消息
type: "assistant"   → 带使用数据的 CC 响应
type: "system"      → 系统事件（错误、压缩）
type: "file-history-snapshot" → 文件状态跟踪
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

### 对 Alice 有用的 Hook 事件
```
SessionStart   → 跟踪新会话
Stop           → 任务完成
TaskCompleted  → 显式任务完成
SessionEnd     → 会话终止
Notification   → 转发到 Alice 通知系统
```

---

## 附录 B：开源生态系统分析与集成策略

### B.1 CodexBar (steipete/CodexBar)

| 属性 | 详情 |
|---|---|
| **Stars** | 5,708 |
| **技术** | Swift 原生，macOS 14+，SwiftUI |
| **许可证** | MIT |
| **重点** | 多服务商使用量计量器（Claude、Codex、Cursor、Gemini 等） |

**核心功能**：
- 带会话 + 周使用量条的菜单栏计量图标
- Claude 使用量通过 3 种数据路径（优先级顺序）：OAuth API → CLI PTY → 网页 cookies
- 从 `~/.claude/projects/**/*.jsonl` 本地成本使用扫描
- 多账户切换（配置中的 tokenAccounts）
- 服务商状态轮询与事件徽章
- 合并图标模式（多服务商 → 一个状态项）
- WidgetKit 小组件
- 捆绑 CLI：`codexbar cost --provider claude`
- 通过 `message.id + requestId` 进行流式去重

**Claude OAuth API**（CodexBar 的首选方法）：
```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <来自 Keychain "Claude Code-credentials" 的 access_token>
anthropic-beta: oauth-2025-04-20

返回：five_hour（会话）、seven_day（周）、seven_day_sonnet、seven_day_opus、extra_usage
```

**Alice 集成分析**：

| 方面 | 建议 |
|---|---|
| 直接嵌入 | **不可行** — Swift 无法嵌入 Tauri/Rust |
| 作为 CLI 子进程使用 | **可行的后备方案** — `codexbar cost --provider claude` 返回 JSON；但增加依赖 |
| 移植使用量逻辑 | **推荐** — 将 JSONL 解析 + OAuth API 调用移植到 Rust |
| 移植多账户 | **推荐** — 读取 `~/.claude/.credentials.json` + Keychain 用于账户切换 |
| 移植计量图标 | **参考** — 为 Alice 的菜单栏图标采用双条计量概念 |

**从 CodexBar 采纳的内容**：
1. **OAuth 使用量 API** — Alice 应直接调用 `api.anthropic.com/api/oauth/usage` 获取实时会话/周百分比（比仅 JSONL 准确得多）
2. **流式去重** — JSONL 解析必须通过 `message.id + requestId` 去重以避免累积流式块的重复计数
3. **多账户支持** — 读取 Keychain 凭据 + 配置文件用于账户切换
4. **计量图标设计** — 菜单栏图标中的双条计量器（会话 + 周）
5. **速率限制重置倒计时** — 显示会话/周窗口何时重置
6. **服务商状态轮询** — 检查 Anthropic 状态页面的事件

**不采纳的内容**：
- 多服务商支持（Codex、Cursor、Gemini）— 超出范围，Alice 专注于 Claude Code 工作流程
- 浏览器 cookie 抓取 — 增加复杂性和权限要求
- CLI PTY 自动化 — 脆弱；Alice 有更好的替代方案（hooks + 文件监听）

### B.2 其他开源 Claude Code 工具

#### ccusage (ryoppippi/ccusage)
| 属性 | 详情 |
|---|---|
| **Stars** | ~2,000+ |
| **技术** | TypeScript CLI |
| **功能** | JSONL 使用量分析器：每日/每月/每会话/5小时块报告 |
| **值得采纳** | 成本计算逻辑、5 小时窗口跟踪、按模型细分 |
| **参考** | [github.com/ryoppippi/ccusage](https://github.com/ryoppippi/ccusage) |

#### Claude-Code-Usage-Monitor (Maciek-roboblog)
| 属性 | 详情 |
|---|---|
| **技术** | Python CLI，带 Rich TUI |
| **功能** | 实时终端仪表板，带基于 ML 的限制触发预测 |
| **值得采纳** | **消耗速率预测** — 根据当前使用速度估算何时达到限制 |
| **参考** | [GitHub](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) |

#### ccboard (FlorianBruniaux/ccboard)
| 属性 | 详情 |
|---|---|
| **技术** | Web 仪表板 |
| **功能** | CC 会话监控的可视化仪表板 |
| **值得采纳** | 会话卡片和项目分组的 UI 布局模式 |
| **参考** | [GitHub](https://github.com/FlorianBruniaux/ccboard) |

#### CCNotify (Helmi/CCNotify)
| 属性 | 详情 |
|---|---|
| **技术** | Python，使用 macOS `say` 命令 |
| **功能** | 当 CC 需要注意或完成时的语音提醒 |
| **值得采纳** | **语音通知选项** — 超越视觉通知的可配置 TTS 提醒 |
| **参考** | [GitHub](https://github.com/Helmi/CCNotify) |

#### claude-flow (ruvnet/claude-flow)
| 属性 | 详情 |
|---|---|
| **Stars** | ~12,900 |
| **技术** | TypeScript，基于 MCP 的编排 |
| **功能** | 多代理群协调器（60+ 代理）、任务分发、RAG |
| **值得采纳** | **任务依赖图**可视化；非 Alice 核心范围但与队列 UI 相关 |
| **参考** | [GitHub](https://github.com/ruvnet/claude-flow) |

#### ClaudeUsageTracker (masorange)
| 属性 | 详情 |
|---|---|
| **技术** | macOS 菜单栏应用 |
| **功能** | 菜单栏中的简单成本跟踪 |
| **值得采纳** | 最小化菜单栏成本显示模式 |

#### PriceyApp (mobile-next)
| 属性 | 详情 |
|---|---|
| **技术** | macOS 状态栏，Swift |
| **功能** | 比较 AI 成本与人类开发者成本（ROI 跟踪） |
| **值得采纳** | **ROI 指标** — "此会话节省了约 X 小时的手动工作"估算 |

### B.3 新增功能（来自生态系统分析）

基于生态系统调研，这些功能应添加到 Alice：

| # | 功能 | 来源 | 优先级 | 阶段 |
|---|---|---|---|---|
| 1 | **通过 OAuth API 获取实时使用量百分比** | CodexBar | **高** | 第二阶段 |
| 2 | **速率限制重置倒计时** | CodexBar | **高** | 第二阶段 |
| 3 | **多账户切换** | CodexBar | **中等** | 第三阶段 |
| 4 | **消耗速率预测** | Claude-Code-Usage-Monitor | **中等** | 第三阶段 |
| 5 | **5 小时窗口跟踪** | ccusage | **高** | 第二阶段 |
| 6 | **流式块去重** | CodexBar | **关键** | 第一阶段 |
| 7 | **语音通知选项** | CCNotify | **低** | 第四阶段 |
| 8 | **Anthropic 状态监控** | CodexBar | **中等** | 第三阶段 |
| 9 | **ROI 估算** | PriceyApp | **低** | 未来 |
| 10 | **双条计量图标** | CodexBar | **中等** | 第二阶段 |

### B.4 更新后的使用量仪表板设计

结合 CodexBar 的洞察，使用量部分应显示：

```
┌───────────────────────────────────┐
│ 📊 使用量                          │
│                                    │
│ 会话（5小时窗口）                   │
│ ████████████████░░░░  已用 78%     │
│ 2小时14分后重置                    │
│                                    │
│ 每周                               │
│ ██████████░░░░░░░░░░  已用 48%     │
│ 周一 00:00 重置                    │
│                                    │
│ 消耗速率：~12%/小时                │
│ ⚠ 按当前速度，会话限制将在         │
│   约 1 小时 50 分后达到            │
│                                    │
│ 今日：45K tokens · $0.82           │
│ 本周：320K tokens · $5.40          │
│                                    │
│ 账户：user@email.com (Max)         │
│ [切换账户 ▾]                       │
└───────────────────────────────────┘
```

### B.5 实现：OAuth 使用量获取（Rust）

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

// 凭据：从 Keychain（macOS）或 ~/.claude/.credentials.json 读取
fn read_claude_credentials() -> Option<String> {
    // 1. 尝试 Keychain：service="Claude Code-credentials"
    // 2. 后备：~/.claude/.credentials.json
    // 3. 检查 user:profile 范围
}
```
