# Gemini Context: Alice Project

This document provides a comprehensive overview of the "Alice" project, its architecture, and development conventions to be used as a primary context for AI-assisted development.

## 1. Project Overview

Alice is a Tauri-based desktop application for macOS that acts as a visual "control plane" for a command-line tool named `claude`. Its primary purpose is to solve common pain points for `claude` users by providing a graphical interface for features that are difficult to manage in a terminal.

**Core Features:**
- **Session & Task Management:** Monitors active `claude` sessions, provides a task queue, and enables full-text search across session history.
- **Usage Tracking:** Offers dashboards for token/cost usage per project and integrates with provider APIs for live usage data.
- **Notifications:** Delivers native macOS notifications for task completion and other events.
- **Reporting:** Automatically generates daily summaries from session data and git commits.
- **Multi-Environment Support:** Allows users to manage and switch between different `claude` configurations and API keys.

## 2. Architecture

The project uses a standard Tauri architecture, combining a Rust backend for core logic with a web-based frontend for the user interface.

### Frontend

- **Framework:** React 19
- **Language:** TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS v4
- **State Management:** Zustand and TanStack React Query (`@tanstack/react-query`)
- **Structure:**
    - The main entry point is `src/main.tsx`.
    - The root component `src/App.tsx` handles the main 5-tab navigation structure.
    - UI is divided into "views" (e.g., `src/views/WorkspaceView.tsx`, `src/views/ConfigView.tsx`) which correspond to the main tabs.
    - Reusable components are located in `src/components/`.

### Backend

- **Framework:** Tauri 2.0
- **Language:** Rust
- **Database:** SQLite (via the `rusqlite` crate) is used for all data persistence. The database logic is primarily managed in `src-tauri/src/database.rs`.
- **Core Logic:**
    - **File System Watching:** The `notify` crate is used in `src-tauri/src/watcher.rs` to monitor the `~/.claude/` directory, likely to parse session logs in real-time.
    - **Process Management:** The backend spawns `claude` as a subprocess to execute tasks, managed via `src-tauri/src/queue.rs`.
    - **API Integration:** The `reqwest` crate is used for making external HTTP requests to provider APIs (e.g., for usage data).

### Frontend-Backend Communication

- **Mechanism:** Communication is handled via Tauri's IPC (Inter-Process Communication) system.
- **Implementation:** The Rust backend exposes a large set of asynchronous functions to the frontend using the `#[tauri::command]` attribute.
- **Key File:** `src-tauri/src/commands.rs` is the central file defining the entire API contract between the frontend and backend. It contains over 40 commands for everything from fetching data (`get_sessions`, `get_tasks`) to performing actions (`start_queue`, `update_config`).
- **Frontend Invocation:** The frontend calls these commands using the `invoke()` function from the `@tauri-apps/api/core` package.

## 3. Building and Running

The project uses `npm` scripts to orchestrate development and build tasks.

- **Install Dependencies:**
  ```bash
  npm install
  ```

- **Run in Development Mode:**
  This command starts the Vite dev server for the frontend and the Tauri application in parallel, with hot-reloading enabled for both.
  ```bash
  npm run tauri dev
  ```

- **Build for Production:**
  This command compiles the Rust backend and bundles the optimized React frontend into a single, distributable macOS application.
  ```bash
  npm run tauri build
  ```

## 4. Development Conventions

- **Type Safety:** The project strongly emphasizes type safety.
    - The frontend is written in TypeScript.
    - The file `src/lib/types.ts` contains TypeScript types that often mirror the Rust structs defined in the backend to ensure consistency across the IPC boundary.
    - Rust structs used in Tauri commands are defined with `serde::{Serialize, Deserialize}`.

- **API Surface:** When adding new functionality that requires backend logic, the standard pattern is:
    1.  Add or modify a function in a Rust module (e.g., `database.rs`, `queue.rs`).
    2.  Expose it to the frontend by creating a new `#[tauri::command]` in `src-tauri/src/commands.rs`.
    3.  Call the new command from the frontend using `invoke()`.

- **State Management:**
    - Use TanStack React Query for managing server state (data fetched from the backend).
    - Use Zustand for simple, global UI client state.

- **Styling:** Adhere to the Tailwind CSS utility-first approach. Custom global styles and theme variables are in `src/index.css`.

## 5. Key Files

- `README.md`: High-level project description, features, and setup instructions.
- `package.json`: Frontend dependencies and build scripts.
- `src-tauri/Cargo.toml`: Rust backend dependencies.
- `src-tauri/tauri.conf.json`: Tauri application configuration.
- `src/App.tsx`: Root React component with main navigation logic.
- `src-tauri/src/main.rs`: Backend entry point.
- `src-tauri/src/lib.rs`: Tauri application setup and builder.
- `src-tauri/src/commands.rs`: **Crucial file.** Defines the API between the frontend and backend.
- `src-tauri/src/database.rs`: Core logic for all SQLite database interactions.
- `vite.config.ts`: Vite configuration for the frontend development server.
