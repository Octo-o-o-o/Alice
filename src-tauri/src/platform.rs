// Platform abstraction layer for cross-platform compatibility (macOS + Windows)

use std::path::PathBuf;

/// Get the user's home directory, panicking if unavailable.
fn home_dir() -> PathBuf {
    dirs::home_dir().expect("Could not find home directory")
}

/// Get the Alice data directory (~/.alice/ on all platforms)
pub fn get_alice_dir() -> PathBuf {
    home_dir().join(".alice")
}

/// Get the Claude Code data directory (~/.claude/ on all platforms)
pub fn get_claude_dir() -> PathBuf {
    home_dir().join(".claude")
}

/// Get the Codex data directory (~/.codex/ on all platforms)
pub fn get_codex_dir() -> PathBuf {
    home_dir().join(".codex")
}

/// Get the Gemini data directory (~/.gemini/ on all platforms)
pub fn get_gemini_dir() -> PathBuf {
    home_dir().join(".gemini")
}

/// Check if a CLI command is available on PATH.
/// Uses `which` on Unix and `where` on Windows.
pub fn is_cli_installed(command_name: &str) -> bool {
    let check_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    std::process::Command::new(check_cmd)
        .arg(command_name)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Generate a platform-appropriate hook command for Claude Code settings.
/// On Unix: bash echo + date syntax.
/// On Windows: PowerShell using ConvertTo-Json for reliable JSON output.
pub fn get_hook_command(event_name: &str, include_project: bool) -> String {
    if cfg!(target_os = "windows") {
        let extra_fields = if include_project {
            "project=$env:CLAUDE_PROJECT_DIR;"
        } else {
            ""
        };
        format!(
            r#"powershell -NoProfile -Command "& {{$ts=[Math]::Floor(([DateTimeOffset]::UtcNow).ToUnixTimeSeconds());$j=@{{event='{event}';session_id=$env:CLAUDE_SESSION_ID;{extra}timestamp=$ts}}|ConvertTo-Json -Compress;Add-Content -LiteralPath (Join-Path $env:USERPROFILE '.alice\hooks-events.jsonl') -Value $j}}""#,
            event = event_name,
            extra = extra_fields,
        )
    } else {
        let extra = if include_project {
            r#","project":"$CLAUDE_PROJECT_DIR""#
        } else {
            ""
        };
        format!(
            "echo '{{\"event\":\"{event}\",\"session_id\":\"$CLAUDE_SESSION_ID\"{extra},\"timestamp\":'$(date +%s)'}}' >> ~/.alice/hooks-events.jsonl",
            event = event_name,
            extra = extra,
        )
    }
}

/// Generate the PreToolUse hook command for Claude Code.
/// Writes a pre_tool_use event to hooks-events.jsonl.
/// On Unix, uses `printf` instead of `echo` for proper variable expansion
/// (avoids the single-quote expansion issue with `$CLAUDE_SESSION_ID`).
/// On Windows, delegates to `get_hook_command` since PowerShell handles expansion natively.
pub fn get_pre_tool_use_hook_command() -> String {
    if cfg!(target_os = "windows") {
        return get_hook_command("pre_tool_use", false);
    }
    r#"printf '{"event":"pre_tool_use","session_id":"%s","timestamp":%s}\n' "$CLAUDE_SESSION_ID" "$(date +%s)" >> ~/.alice/hooks-events.jsonl"#.to_string()
}

/// Generate the Gemini hook shell script content.
/// The script reads JSON from stdin (Gemini passes hook data via stdin),
/// extracts the tool name, and POSTs to Alice's HTTP notification server.
pub fn get_gemini_hook_script(port: u16) -> String {
    format!(
        r#"#!/bin/bash
# Alice Gemini Hook Script (auto-generated)
# Called by Gemini CLI before tool execution (BeforeTool hook).
# Reads JSON hook data from stdin, forwards to Alice's notification server.

ALICE_PORT=$(cat ~/.alice/http_port 2>/dev/null || echo "{port}")
HOOK_INPUT=$(cat)

if command -v jq &>/dev/null; then
  TOOL=$(echo "$HOOK_INPUT" | jq -r '.name // "unknown"' 2>/dev/null || echo "unknown")
else
  TOOL="unknown"
fi

curl -s -X POST "http://127.0.0.1:$ALICE_PORT/notify" \
  -H "Content-Type: application/json" \
  -d "{{\"title\":\"Gemini\",\"body\":\"Wants to use: $TOOL\",\"provider\":\"gemini\",\"event_type\":\"tool_permission\"}}" \
  > /dev/null 2>&1 || true
"#,
        port = port
    )
}

/// Decode an encoded project path from Claude Code's directory structure.
/// Claude Code encodes paths by replacing path separators with `-`.
///
/// Unix:    `-Users-alice-projects-myapp` -> `/Users/alice/projects/myapp`
/// Windows: `-C-Users-alice-projects-myapp` -> `C:/Users/alice/projects/myapp`
#[allow(dead_code)]
pub fn decode_project_path(encoded: &str) -> String {
    let decoded = urlencoding::decode(encoded).unwrap_or_else(|_| encoded.into());
    let bytes = decoded.as_bytes();

    // Windows drive-letter pattern: -C-Users-... (dash, single uppercase letter, dash)
    if bytes.len() >= 3
        && bytes[0] == b'-'
        && bytes[1].is_ascii_uppercase()
        && bytes[2] == b'-'
    {
        let drive_letter = bytes[1] as char;
        let rest = &decoded[3..];
        let sep = std::path::MAIN_SEPARATOR;
        return format!(
            "{}:{}{}",
            drive_letter,
            sep,
            rest.replace('-', &sep.to_string())
        );
    }

    // Unix: -Users-... or -home-...
    for prefix in &["Users", "home"] {
        let encoded_prefix = format!("-{}-", prefix);
        if let Some(stripped) = decoded.strip_prefix(encoded_prefix.as_str()) {
            return format!("/{}/{}", prefix, stripped.replace('-', "/"));
        }
    }

    // Already an absolute path (Unix `/...` or Windows `C:\...`)
    if decoded.starts_with('/') || (bytes.len() >= 2 && bytes[1] == b':') {
        return decoded.to_string();
    }

    // Relative path fallback
    if decoded.contains('-') {
        if let Some(home) = dirs::home_dir() {
            return format!("{}/{}", home.display(), decoded.replace('-', "/"));
        }
    }

    decoded.to_string()
}

/// Resolve the platform-appropriate CLI command name.
/// On Windows, npm-installed CLIs may have `.exe` or `.cmd` shims.
/// On Unix, the base name is used directly.
fn resolve_cli_command(
    base: &'static str,
    exe: &'static str,
    cmd: &'static str,
) -> &'static str {
    if cfg!(target_os = "windows") {
        if is_cli_installed(exe) {
            return exe;
        }
        if is_cli_installed(cmd) {
            return cmd;
        }
    }
    base
}

/// Get the platform-appropriate Claude CLI command name.
pub fn get_claude_command() -> &'static str {
    resolve_cli_command("claude", "claude.exe", "claude.cmd")
}

/// Get the platform-appropriate Codex CLI command name.
#[allow(dead_code)]
pub fn get_codex_command() -> &'static str {
    resolve_cli_command("codex", "codex.exe", "codex.cmd")
}

/// Get the platform-appropriate Gemini CLI command name.
pub fn get_gemini_command() -> &'static str {
    resolve_cli_command("gemini", "gemini.exe", "gemini.cmd")
}

/// Get the platform-appropriate Git command name.
/// Returns `None` if git is not found on PATH.
pub fn get_git_command() -> Option<&'static str> {
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["git.exe", "git"]
    } else {
        &["git"]
    };
    candidates.iter().copied().find(|cmd| is_cli_installed(cmd))
}

/// Extract the last path component (file/directory name) from a path string,
/// handling both `/` and `\` separators.
pub fn path_file_name(path: &str) -> &str {
    path.rsplit(&['/', '\\'][..])
        .next()
        .unwrap_or(path)
}

/// Escape a command string for embedding in AppleScript double-quoted strings.
fn escape_for_applescript(command: &str) -> String {
    command.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Build a shell command string that optionally `cd`s into a directory first.
/// Uses single-quote escaping for the directory path (Unix shell convention).
fn build_shell_command(working_dir: Option<&str>, command: &str) -> String {
    if let Some(dir) = working_dir {
        let escaped_dir = dir.replace('\'', "'\\''");
        format!("cd '{}' && {}", escaped_dir, command)
    } else {
        command.to_string()
    }
}

/// Spawn a process and map any launch error to a descriptive message.
fn spawn_process(cmd: &str, args: &[&str], context: &str) -> Result<(), String> {
    std::process::Command::new(cmd)
        .args(args)
        .spawn()
        .map_err(|e| format!("Failed to open {}: {}", context, e))?;
    Ok(())
}

/// Run an AppleScript via `osascript` and map errors to a descriptive message.
fn run_applescript(script: &str, app_name: &str) -> Result<(), String> {
    spawn_process("osascript", &["-e", script], app_name)
}

/// Build the shell command string from working_dir and command, then format it
/// into an AppleScript template and execute it. The `template` must contain a
/// single `{}` placeholder where the shell command will be inserted.
fn execute_via_applescript(
    working_dir: Option<&str>,
    command: &str,
    template: &str,
    app_name: &str,
) -> Result<(), String> {
    let escaped = escape_for_applescript(command);
    let full_cmd = build_shell_command(working_dir, &escaped);
    let script = template.replace("{}", &full_cmd);
    run_applescript(&script, app_name)
}

/// Execute a command in a visible terminal window.
/// Returns Ok(()) if the terminal was launched successfully.
/// The actual command execution happens in the terminal process.
pub fn execute_in_terminal(
    terminal: &crate::config::TerminalApp,
    custom_command: &str,
    working_dir: Option<&str>,
    command: &str,
    args: &[&str],
) -> Result<(), String> {
    use crate::config::TerminalApp;

    let full_command = if args.is_empty() {
        command.to_string()
    } else {
        format!("{} {}", command, args.join(" "))
    };

    match terminal {
        TerminalApp::Background => {
            Err("Background execution should use direct spawn".to_string())
        }
        TerminalApp::System => execute_in_system_terminal(working_dir, &full_command),
        TerminalApp::ITerm2 => {
            if cfg!(target_os = "macos") {
                execute_in_iterm2(working_dir, &full_command)
            } else {
                Err("iTerm2 is only available on macOS".to_string())
            }
        }
        TerminalApp::WindowsTerminal => {
            if cfg!(target_os = "windows") {
                execute_in_windows_terminal(working_dir, &full_command)
            } else {
                Err("Windows Terminal is only available on Windows".to_string())
            }
        }
        TerminalApp::Warp => {
            if cfg!(target_os = "macos") {
                execute_in_warp(working_dir, &full_command)
            } else {
                Err("Warp is only available on macOS".to_string())
            }
        }
        TerminalApp::Custom => {
            execute_in_custom_terminal(custom_command, working_dir, &full_command)
        }
    }
}

/// Execute command in the system default terminal
fn execute_in_system_terminal(working_dir: Option<&str>, command: &str) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        execute_via_applescript(
            working_dir,
            command,
            r#"tell application "Terminal"
    activate
    do script "{}"
end tell"#,
            "Terminal",
        )
    } else if cfg!(target_os = "windows") {
        let full_cmd = if let Some(dir) = working_dir {
            format!("cd /d \"{}\" && {}", dir, command)
        } else {
            command.to_string()
        };
        spawn_process("cmd", &["/c", "start", "cmd", "/k", &full_cmd], "cmd")
    } else {
        Err("Unsupported platform".to_string())
    }
}

/// Execute command in iTerm2 (macOS only)
fn execute_in_iterm2(working_dir: Option<&str>, command: &str) -> Result<(), String> {
    execute_via_applescript(
        working_dir,
        command,
        r#"tell application "iTerm"
    activate
    tell current window
        create tab with default profile
        tell current session
            write text "{}"
        end tell
    end tell
end tell"#,
        "iTerm2",
    )
}

/// Execute command in Windows Terminal (Windows only)
fn execute_in_windows_terminal(working_dir: Option<&str>, command: &str) -> Result<(), String> {
    let mut wt_args: Vec<String> = Vec::new();

    if let Some(dir) = working_dir {
        wt_args.extend(["-d".to_string(), format!("\"{}\"", dir)]);
    }
    wt_args.extend(["cmd".to_string(), "/k".to_string(), command.to_string()]);

    let arg_refs: Vec<&str> = wt_args.iter().map(|s| s.as_str()).collect();
    spawn_process("wt", &arg_refs, "Windows Terminal")
}

/// Execute command in Warp terminal (macOS only)
fn execute_in_warp(working_dir: Option<&str>, command: &str) -> Result<(), String> {
    execute_via_applescript(
        working_dir,
        command,
        r#"tell application "Warp"
    activate
    tell application "System Events"
        keystroke "t" using command down
        delay 0.5
        keystroke "{}"
        keystroke return
    end tell
end tell"#,
        "Warp",
    )
}

/// Execute command in a custom terminal
fn execute_in_custom_terminal(
    custom_command: &str,
    working_dir: Option<&str>,
    command: &str,
) -> Result<(), String> {
    if custom_command.is_empty() {
        return Err("Custom terminal command is not configured".to_string());
    }

    let final_command = custom_command
        .replace("{dir}", working_dir.unwrap_or("."))
        .replace("{cmd}", command);

    let (shell, flag) = if cfg!(target_os = "windows") {
        ("cmd", "/c")
    } else {
        ("sh", "-c")
    };

    spawn_process(shell, &[flag, &final_command], "custom terminal")
}

/// Get list of available terminal apps for the current platform
pub fn get_available_terminals() -> Vec<(&'static str, &'static str)> {
    let mut terminals = vec![
        ("background", "Background (no window)"),
        (
            "system",
            if cfg!(target_os = "macos") {
                "Terminal.app"
            } else {
                "Command Prompt"
            },
        ),
    ];

    if cfg!(target_os = "macos") {
        if std::path::Path::new("/Applications/iTerm.app").exists() {
            terminals.push(("iterm2", "iTerm2"));
        }
        if std::path::Path::new("/Applications/Warp.app").exists() {
            terminals.push(("warp", "Warp"));
        }
    }

    if cfg!(target_os = "windows")
        && (is_cli_installed("wt.exe") || is_cli_installed("wt"))
    {
        terminals.push(("windows_terminal", "Windows Terminal"));
    }

    terminals.push(("custom", "Custom..."));
    terminals
}
