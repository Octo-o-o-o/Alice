<div align="center">

# Alice

**A lightweight menu bar app for managing Claude Code sessions, tasks, and workflows.**

[English](#english) | [中文](#中文)

![macOS 12+](https://img.shields.io/badge/macOS-12%2B-blue)
![License: MIT](https://img.shields.io/badge/License-MIT-green)
![Tauri 2.0](https://img.shields.io/badge/Tauri-2.0-orange)
![Status: WIP](https://img.shields.io/badge/Status-WIP-yellow)

</div>

---

<a id="english"></a>

## What is Alice?

Alice is a macOS menu bar desktop assistant that wraps around [Claude Code](https://docs.anthropic.com/en/docs/claude-code), providing a **visual control plane** for the CLI-first workflow.

### Pain Points Solved

Using Claude Code daily? These might sound familiar:

| # | Problem | Alice Solution |
|---|---------|----------------|
| 1 | **No completion notification** — Tab away and miss when CC finishes | Menu bar status indicator + native macOS notifications |
| 2 | **No task queue** — Can't say "after this, do that" | Task queue with chaining and auto-execution |
| 3 | **Session search is painful** — `--resume` shows a list but no search, no preview | Full-text search across all sessions with instant preview |
| 4 | **No per-project usage tracking** — `/cost` only shows current session | Per-project, per-day, per-session usage dashboards |
| 5 | **Context loss after compact** — CC forgets what it was doing | Persistent task backlog external to CC sessions |
| 6 | **No multi-project overview** — Each terminal is isolated | Unified cross-project dashboard |
| 7 | **No daily reporting** — Hard to recall what CC helped with today | Auto-generated daily report from sessions + git commits |
| 8 | **Todo lists vanish** — CC's TodoWrite is session-scoped | Unified task backlog persisted outside CC sessions |
| 9 | **Can't find running CC processes** — No way to list all active sessions | Process monitor for all CC instances across projects |
| 10 | **Session names are useless** — Auto-generated names like `a1b2c3d4` | Custom session labels and tags |

> Sources: [#7069](https://github.com/anthropics/claude-code/issues/7069), [#4707](https://github.com/anthropics/claude-code/issues/4707), [#2954](https://github.com/anthropics/claude-code/issues/2954), [#4689](https://github.com/anthropics/claude-code/issues/4689), [#12455](https://github.com/anthropics/claude-code/issues/12455), and community feedback.

### Features

- **Session Monitor** — Real-time status of all active Claude Code sessions across projects
- **Task Queue** — Queue tasks, chain execution, auto-run next when done
- **Notifications** — Native macOS alerts on task completion, errors, or input needed
- **Session Search** — Full-text search across all session history with one-click resume
- **Usage Dashboard** — Token/cost tracking per project, per session, with OAuth usage meters
- **Daily Report** — Auto-generated summary of sessions, git commits, and usage stats

### Screenshots

> Coming soon

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Tauri 2.0 (Rust) |
| Frontend | React 19 + TypeScript + Tailwind CSS v4 |
| State | Zustand + React Query |
| Database | SQLite (rusqlite, FTS5 full-text search) |
| File Watching | `notify` crate (FSEvents on macOS) |

### Prerequisites

- macOS 12+
- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed

### Getting Started

```bash
# Clone
git clone https://github.com/Octo-o-o-o/Alice.git
cd Alice

# Install dependencies
npm install

# Run in development mode (launches both Vite dev server + Tauri app)
npm run tauri dev

# Build for production
npm run tauri build
```

### Project Structure

```
Alice/
├── src/                    # Frontend (React + TypeScript)
│   ├── App.tsx             # Root — 5-tab navigation
│   ├── views/              # Tab views (Active, Tasks, Usage, History, Config)
│   ├── components/         # Shared UI components
│   ├── lib/types.ts        # TypeScript types (synced with Rust structs)
│   └── index.css           # Tailwind v4 + design tokens
├── src-tauri/              # Backend (Rust + Tauri 2.0)
│   └── src/
│       ├── lib.rs          # App setup, plugins, tray, commands
│       ├── commands.rs     # 25+ IPC command handlers
│       ├── database.rs     # SQLite with FTS5
│       ├── session.rs      # JSONL session parser
│       ├── watcher.rs      # ~/.claude/ file system watcher
│       ├── queue.rs        # Task queue engine (spawns claude CLI)
│       ├── usage.rs        # OAuth usage API integration
│       ├── report.rs       # Daily report generator
│       ├── notification.rs # Native notification engine
│       ├── config.rs       # App config (~/.alice/)
│       └── tray.rs         # Menu bar tray icon states
├── PROPOSAL.md             # Detailed design document
├── CLAUDE.md               # AI coding assistant instructions
└── package.json
```

### How It Works

1. **File Watcher** monitors `~/.claude/projects/` for JSONL session files
2. **Session Parser** extracts metadata, token usage, and status from JSONL
3. **SQLite** indexes everything for fast full-text search
4. **Tauri Events** push real-time updates to the React frontend
5. **Task Queue** executes queued tasks via `claude -p` subprocess

### Contributing

Contributions are welcome! This project is in early development.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### License

[MIT](./LICENSE)

### Acknowledgments

Inspired by and built upon ideas from these open-source projects:

- [CodexBar](https://github.com/steipete/CodexBar) — OAuth usage API patterns, meter icon design
- [ccusage](https://github.com/ryoppippi/ccusage) — Cost calculation logic, 5-hour window tracking

---

<a id="中文"></a>

## Alice 是什么？

Alice 是一个 macOS 菜单栏桌面助手，为 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 提供**可视化控制面板**。

### 解决的痛点

每天使用 Claude Code？这些问题是不是很熟悉：

| # | 问题 | Alice 解决方案 |
|---|------|---------------|
| 1 | **没有完成通知** — 切换标签页后错过 CC 完成 | 菜单栏状态指示 + macOS 原生通知 |
| 2 | **无法排队任务** — 不能说"做完这个，再做那个" | 任务队列，支持链式自动执行 |
| 3 | **会话搜索痛苦** — `--resume` 只显示列表，无法搜索和预览 | 全文搜索所有会话，即时预览 |
| 4 | **无法按项目追踪用量** — `/cost` 只显示当前会话 | 按项目、按天、按会话的用量仪表盘 |
| 5 | **压缩后上下文丢失** — CC 忘记之前在做什么 | 独立于 CC 会话的持久化任务待办 |
| 6 | **没有多项目总览** — 每个终端都是孤岛 | 统一的跨项目仪表盘 |
| 7 | **没有日报** — 很难回忆今天 CC 帮了什么忙 | 自动生成日报（会话 + Git 提交） |
| 8 | **待办列表消失** — CC 的 TodoWrite 是会话级别的 | 持久化的统一任务待办 |
| 9 | **找不到运行中的 CC 进程** — 无法列出所有活跃会话 | 跨项目的进程监控器 |
| 10 | **会话名无意义** — 自动生成的名字如 `a1b2c3d4` | 自定义会话标签和分类 |

> 来源：[#7069](https://github.com/anthropics/claude-code/issues/7069)、[#4707](https://github.com/anthropics/claude-code/issues/4707)、[#2954](https://github.com/anthropics/claude-code/issues/2954)、[#4689](https://github.com/anthropics/claude-code/issues/4689)、[#12455](https://github.com/anthropics/claude-code/issues/12455) 及社区反馈。

### 功能

- **会话监控** — 实时显示所有项目中活跃的 Claude Code 会话状态
- **任务队列** — 排队任务，链式执行，完成后自动运行下一个
- **系统通知** — 任务完成、报错或需要输入时发送 macOS 原生通知
- **会话搜索** — 全文搜索所有历史会话，一键恢复
- **用量仪表盘** — 按项目、按会话追踪 Token 和费用，支持 OAuth 用量指标
- **日报生成** — 自动汇总当日会话、Git 提交和用量统计

### 环境要求

- macOS 12+
- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 已安装

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/Octo-o-o-o/Alice.git
cd Alice

# 安装依赖
npm install

# 开发模式运行（同时启动 Vite 开发服务器和 Tauri 应用）
npm run tauri dev

# 构建生产版本
npm run tauri build
```

### 参与贡献

欢迎贡献！本项目处于早期开发阶段。

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 发起 Pull Request

### 许可证

[MIT](./LICENSE)
