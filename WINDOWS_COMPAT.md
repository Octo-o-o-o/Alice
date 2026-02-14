# Windows Compatibility — Implementation Record

## Overview

This document records the changes made to support Windows alongside macOS. All changes are consolidated in the new `platform.rs` module plus targeted updates to existing files.

## Core Change: `src-tauri/src/platform.rs` (New)

Centralized platform abstraction layer providing:

| Function | Purpose |
|----------|---------|
| `get_alice_dir()` | Returns `~/.alice/` path (cross-platform via `dirs::home_dir()`) |
| `get_claude_dir()` | Returns `~/.claude/` path (cross-platform) |
| `is_cli_installed(name)` | Uses `which` (Unix) or `where` (Windows) to detect CLI tools |
| `get_hook_command(event, include_project)` | Generates bash (macOS) or PowerShell (Windows) hook commands |
| `decode_project_path(encoded)` | Decodes Claude Code's encoded project paths, including Windows `C:\` drive letters |
| `path_file_name(path)` | Extracts filename handling both `/` and `\` separators |

## Changes by File

### Rust Backend

| File | Change | Issue Fixed |
|------|--------|-------------|
| `lib.rs` | Added `mod platform`, `icon_as_template(cfg!(target_os = "macos"))`, platform-aware window positioning | Tray icon template is macOS-only; window Y offset differs (top vs bottom) |
| `config.rs` | `get_config_path()` → `platform::get_alice_dir()`, `is_claude_installed()` → `platform::is_cli_installed()` | `which` command doesn't exist on Windows |
| `commands.rs` | Hook commands → `platform::get_hook_command()`, paths → platform helpers | bash `echo`/`date`/`>>` syntax doesn't work on Windows |
| `watcher.rs` | `get_claude_dir()` + `decode_project_path()` → platform module | Windows drive-letter paths (`-C-Users-...`) not handled |
| `queue.rs` | `p.split('/').last()` → `platform::path_file_name(p)` (3 occurrences) | `\` path separator on Windows |
| `database.rs` | `get_alice_dir()` → `platform::get_alice_dir()` | Centralized path management |
| `usage.rs` | Credential path + `get_alice_dir()` → platform helpers | Centralized path management |
| `report.rs` | 3x `home.join(".alice").join("reports")` → `platform::get_alice_dir().join("reports")` | Centralized path management |

### Frontend

| File | Change | Issue Fixed |
|------|--------|-------------|
| `App.tsx` | `⌘K` → `{getModKey()}K` | Shows `Ctrl` on Windows instead of macOS `⌘` |
| `SessionCard.tsx` | `.split("/")` → `.split(/[/\\]/)` | Backslash paths on Windows |
| `HistoryView.tsx` | `.split("/")` → `.split(/[/\\]/)` | Same |
| `TasksView.tsx` | `.split("/")` → `.split(/[/\\]/)` | Same |

## Already Handled (No Changes Needed)

- `notification.rs` — `speak_notification()` already gated behind `#[cfg(target_os = "macos")]`
- `ConfigView.tsx` — Voice notifications toggle already hidden on non-macOS via `isMacSync()`
- `index.css` — Glass panel has `@supports not (backdrop-filter)` fallback
- `platform.ts` — Already has `getModKey()`, `formatPath()`, `getGlassClass()`, `getPathSeparator()`
- `tauri.conf.json` — `"targets": "all"` already includes Windows bundle targets, `.ico` icon present
- All Cargo.toml dependencies — Already cross-platform

## Hook Commands: Platform Comparison

**macOS (bash):**
```bash
echo '{"event":"session_start","session_id":"$CLAUDE_SESSION_ID","project":"$CLAUDE_PROJECT_DIR","timestamp":'$(date +%s)'}' >> ~/.alice/hooks-events.jsonl
```

**Windows (PowerShell via ConvertTo-Json):**
```powershell
powershell -NoProfile -Command "& {$ts=[Math]::Floor(([DateTimeOffset]::UtcNow).ToUnixTimeSeconds());$j=@{event='session_start';session_id=$env:CLAUDE_SESSION_ID;project=$env:CLAUDE_PROJECT_DIR;timestamp=$ts}|ConvertTo-Json -Compress;Add-Content -LiteralPath (Join-Path $env:USERPROFILE '.alice\hooks-events.jsonl') -Value $j}"
```

## Path Decoding: Platform Comparison

| Encoded Path | macOS Decoded | Windows Decoded |
|---|---|---|
| `-Users-alice-projects-myapp` | `/Users/alice/projects/myapp` | `/Users/alice/projects/myapp` |
| `-C-Users-alice-projects-myapp` | *(won't appear on macOS)* | `C:/Users/alice/projects/myapp` |

## Testing Checklist

- [x] `cargo check` passes
- [x] `npm run build` passes (TypeScript + Vite)
- [ ] Test on actual Windows machine:
  - [ ] App launches, tray icon appears (non-template icon)
  - [ ] Window opens at bottom-right (above taskbar)
  - [ ] `claude` CLI detection works
  - [ ] Hooks install with PowerShell commands
  - [ ] Session file watching works
  - [ ] Path decoding handles `C:\` drive letter paths
  - [ ] Keyboard shortcuts show `Ctrl` instead of `⌘`
