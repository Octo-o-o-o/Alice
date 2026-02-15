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
    if let Some(stripped) = decoded
        .strip_prefix("-Users-")
        .or_else(|| decoded.strip_prefix("-home-"))
    {
        let prefix = if decoded.starts_with("-Users-") {
            "Users"
        } else {
            "home"
        };
        return format!("/{}/{}", prefix, stripped.replace('-', "/"));
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
    if cfg!(target_os = "windows") {
        if is_cli_installed("git.exe") {
            return Some("git.exe");
        }
        if is_cli_installed("git") {
            return Some("git");
        }
        None
    } else if is_cli_installed("git") {
        Some("git")
    } else {
        None
    }
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

/// Run an AppleScript via `osascript` and map errors to a descriptive message.
fn run_applescript(script: &str, app_name: &str) -> Result<(), String> {
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .spawn()
        .map_err(|e| format!("Failed to open {}: {}", app_name, e))?;
    Ok(())
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
        let escaped = escape_for_applescript(command);
        let full_cmd = build_shell_command(working_dir, &escaped);
        let script = format!(
            r#"tell application "Terminal"
    activate
    do script "{}"
end tell"#,
            full_cmd
        );
        run_applescript(&script, "Terminal")
    } else if cfg!(target_os = "windows") {
        let full_cmd = if let Some(dir) = working_dir {
            format!("cd /d \"{}\" && {}", dir, command)
        } else {
            command.to_string()
        };

        std::process::Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", &full_cmd])
            .spawn()
            .map_err(|e| format!("Failed to open cmd: {}", e))?;
        Ok(())
    } else {
        Err("Unsupported platform".to_string())
    }
}

/// Execute command in iTerm2 (macOS only)
fn execute_in_iterm2(working_dir: Option<&str>, command: &str) -> Result<(), String> {
    let escaped = escape_for_applescript(command);
    let full_cmd = build_shell_command(working_dir, &escaped);
    let script = format!(
        r#"tell application "iTerm"
    activate
    tell current window
        create tab with default profile
        tell current session
            write text "{}"
        end tell
    end tell
end tell"#,
        full_cmd
    );
    run_applescript(&script, "iTerm2")
}

/// Execute command in Windows Terminal (Windows only)
fn execute_in_windows_terminal(working_dir: Option<&str>, command: &str) -> Result<(), String> {
    let mut wt_args = vec![];

    if let Some(dir) = working_dir {
        wt_args.push("-d".to_string());
        wt_args.push(format!("\"{}\"", dir));
    }

    wt_args.push("cmd".to_string());
    wt_args.push("/k".to_string());
    wt_args.push(command.to_string());

    std::process::Command::new("wt")
        .args(&wt_args)
        .spawn()
        .map_err(|e| format!("Failed to open Windows Terminal: {}", e))?;
    Ok(())
}

/// Execute command in Warp terminal (macOS only)
fn execute_in_warp(working_dir: Option<&str>, command: &str) -> Result<(), String> {
    let escaped = escape_for_applescript(command);
    let full_cmd = build_shell_command(working_dir, &escaped);
    let script = format!(
        r#"tell application "Warp"
    activate
    tell application "System Events"
        keystroke "t" using command down
        delay 0.5
        keystroke "{}"
        keystroke return
    end tell
end tell"#,
        full_cmd
    );
    run_applescript(&script, "Warp")
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

    std::process::Command::new(shell)
        .args([flag, &final_command])
        .spawn()
        .map_err(|e| format!("Failed to execute custom terminal: {}", e))?;
    Ok(())
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

    if cfg!(target_os = "windows") {
        if is_cli_installed("wt.exe") || is_cli_installed("wt") {
            terminals.push(("windows_terminal", "Windows Terminal"));
        }
    }

    terminals.push(("custom", "Custom..."));
    terminals
}
