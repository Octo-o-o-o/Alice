# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alice is a macOS menu bar desktop application for managing Claude Code tasks, sessions, and workflows. It is built with **Tauri 2.0** (Rust backend + React/TypeScript frontend).

## Development Commands

```bash
# Start full dev environment (Tauri launches Vite dev server automatically)
npm run tauri dev

# Frontend only (dev server on port 1420)
npm run dev

# Build frontend (TypeScript check + Vite bundle)
npm run build

# Build full desktop app
npm run tauri build

# Rust backend only
cd src-tauri && cargo build

# Check Rust compilation
cd src-tauri && cargo check

# Run Rust clippy
cd src-tauri && cargo clippy
```

No test suite, linting config, or formatting config is currently set up.

## Architecture

### Two-Part Structure
- **Root directory**: Frontend — React 18 + TypeScript + Vite + Tailwind CSS v4
- **`src-tauri/`**: Backend — Rust with Tauri 2.0 framework

### Frontend (`src/`)

| Path | Purpose |
|------|---------|
| `App.tsx` | Root component with 5-tab navigation (Active, Tasks, Usage, History, Config) |
| `views/` | One view component per tab |
| `components/` | Shared UI components (`SessionCard.tsx` is the largest/most complex) |
| `contexts/ToastContext.tsx` | Toast notification context |
| `lib/types.ts` | TypeScript types mirroring Rust backend structs |
| `lib/platform.ts` | Cross-platform detection utilities |
| `index.css` | Tailwind v4 imports + custom design tokens + glass-panel effects |

Data fetching uses `@tanstack/react-query`. Drag-and-drop uses `@dnd-kit`. Virtualized lists use `react-virtuoso`. Icons from `lucide-react`.

### Backend (`src-tauri/src/`)

| File | Purpose |
|------|---------|
| `lib.rs` | App setup: plugins, tray icon, window management, command registration |
| `commands.rs` | 25+ Tauri IPC command handlers (frontend ↔ backend bridge) |
| `database.rs` | SQLite with FTS5 full-text search (~30KB, largest backend file) |
| `session.rs` | JSONL session file parsing and data structures |
| `watcher.rs` | File system watcher monitoring `~/.claude/projects/` |
| `config.rs` | App configuration (JSON stored in `~/.alice/`) |
| `tray.rs` | System tray icon state (Idle/Active/Success/Warning/Error) |
| `queue.rs` | Task queue engine — spawns `claude` CLI as subprocess |
| `usage.rs` | OAuth API integration for Anthropic usage stats |
| `report.rs` | Daily report generation (sessions, git commits, usage) |
| `notification.rs` | Native OS notification engine |

### Data Flow
1. `watcher.rs` monitors `~/.claude/projects/` for JSONL session files
2. `session.rs` parses sessions into structured data
3. `database.rs` persists to SQLite at `~/.alice/alice.db`
4. `commands.rs` exposes data to frontend via Tauri IPC
5. `queue.rs` executes queued tasks by spawning `claude` CLI subprocesses

### Key Conventions
- Frontend types in `lib/types.ts` must stay in sync with Rust structs in `session.rs` and `database.rs`
- Tauri commands are registered in `lib.rs` and implemented in `commands.rs`
- Tailwind v4 is configured via the `@tailwindcss/vite` plugin (no separate tailwind config file)
- The app window is frameless (no decorations), transparent, and hidden by default — shown via tray icon interaction
- App data directory: `~/.alice/`
- Monitored directory: `~/.claude/`
