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

Claude Code is powerful but you can't see what's happening across sessions, can't queue work, can't get notified when done, and can't manage multiple projects from one place. Alice solves that.

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

Claude Code 很强大，但你无法一目了然地看到跨会话的状态、无法排队任务、完成时没有通知、也无法在一个地方管理多个项目。Alice 解决了这些问题。

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
