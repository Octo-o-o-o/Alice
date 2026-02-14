// Platform abstraction layer for cross-platform compatibility (macOS + Windows)

use std::path::PathBuf;

/// Get the Alice data directory (~/.alice/ on all platforms)
pub fn get_alice_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".alice")
}

/// Get the Claude Code data directory (~/.claude/ on all platforms)
pub fn get_claude_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".claude")
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
        // PowerShell: build hashtable → ConvertTo-Json → append to file
        // This avoids manual JSON escaping entirely
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
        // Bash command (current macOS behavior)
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
/// Unix:    `-Users-alice-projects-myapp` → `/Users/alice/projects/myapp`
/// Windows: `-C-Users-alice-projects-myapp` → `C:/Users/alice/projects/myapp`
pub fn decode_project_path(encoded: &str) -> String {
    let decoded = urlencoding::decode(encoded).unwrap_or_else(|_| encoded.into());

    // Windows drive-letter pattern: -C-Users-... (dash, single uppercase letter, dash)
    if decoded.len() >= 3 {
        let bytes = decoded.as_bytes();
        if bytes[0] == b'-' && bytes[1].is_ascii_uppercase() && bytes.get(2) == Some(&b'-') {
            let drive_letter = bytes[1] as char;
            let rest = &decoded[3..]; // everything after "-C-"
            let sep = std::path::MAIN_SEPARATOR;
            return format!("{}:{}{}", drive_letter, sep, rest.replace('-', &sep.to_string()));
        }
    }

    // Unix: -Users-... or -home-...
    if decoded.starts_with("-Users-") || decoded.starts_with("-home-") {
        return decoded
            .strip_prefix("-")
            .unwrap_or(&decoded)
            .replace('-', "/");
    }

    // Already an absolute path (Unix `/...` or Windows `C:\...`)
    if decoded.starts_with('/')
        || (decoded.len() >= 2 && decoded.as_bytes()[1] == b':')
    {
        return decoded.to_string();
    }

    // Relative path fallback
    if let Some(home) = dirs::home_dir() {
        if decoded.contains('-') {
            return format!("{}/{}", home.display(), decoded.replace('-', "/"));
        }
    }

    decoded.to_string()
}

/// Get the platform-appropriate Claude CLI command name.
/// On Windows, `claude` installed via npm creates a `.cmd` shim, so we check
/// for `claude.exe` first, then fall back to `claude.cmd`, then `claude`.
pub fn get_claude_command() -> &'static str {
    if cfg!(target_os = "windows") {
        if is_cli_installed("claude.exe") {
            "claude.exe"
        } else if is_cli_installed("claude.cmd") {
            "claude.cmd"
        } else {
            "claude"
        }
    } else {
        "claude"
    }
}

/// Get the platform-appropriate Git command name.
/// Returns `None` if git is not found on PATH.
pub fn get_git_command() -> Option<&'static str> {
    if cfg!(target_os = "windows") {
        if is_cli_installed("git.exe") {
            Some("git.exe")
        } else if is_cli_installed("git") {
            Some("git")
        } else {
            None
        }
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

    // Build the full command string
    let full_command = if args.is_empty() {
        command.to_string()
    } else {
        format!("{} {}", command, args.join(" "))
    };

    match terminal {
        TerminalApp::Background => {
            // This case should be handled by the caller (queue.rs)
            // as it uses a different execution path
            Err("Background execution should use direct spawn".to_string())
        }
        TerminalApp::System => {
            execute_in_system_terminal(working_dir, &full_command)
        }
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
        // macOS: Use AppleScript to open Terminal.app
        // Note: We need to properly escape the path and command for AppleScript
        let escaped_command = command
            .replace('\\', "\\\\")
            .replace('"', "\\\"");

        let full_cmd = if let Some(dir) = working_dir {
            // Escape single quotes in the path for shell
            let escaped_dir = dir.replace('\'', "'\\''");
            format!("cd '{}' && {}", escaped_dir, escaped_command)
        } else {
            escaped_command
        };

        let script = format!(
            r#"tell application "Terminal"
    activate
    do script "{}"
end tell"#,
            full_cmd
        );

        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {}", e))?;
        Ok(())
    } else if cfg!(target_os = "windows") {
        // Windows: Use cmd.exe with /k to keep window open
        // Build a batch command that changes directory and runs the command
        let full_cmd = if let Some(dir) = working_dir {
            // Use /d flag for cd to change drive as well
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
    let escaped_command = command
        .replace('\\', "\\\\")
        .replace('"', "\\\"");

    let full_cmd = if let Some(dir) = working_dir {
        let escaped_dir = dir.replace('\'', "'\\''");
        format!("cd '{}' && {}", escaped_dir, escaped_command)
    } else {
        escaped_command
    };

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

    std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn()
        .map_err(|e| format!("Failed to open iTerm2: {}", e))?;
    Ok(())
}

/// Execute command in Windows Terminal (Windows only)
fn execute_in_windows_terminal(working_dir: Option<&str>, command: &str) -> Result<(), String> {
    let mut wt_args = vec![];

    if let Some(dir) = working_dir {
        wt_args.push("-d".to_string());
        wt_args.push(format!("\"{}\"", dir));
    }

    // Use cmd /k to run command and keep window open
    wt_args.push("cmd".to_string());
    wt_args.push("/k".to_string());
    wt_args.push(command.to_string());

    // Use wt directly instead of start
    std::process::Command::new("wt")
        .args(&wt_args)
        .spawn()
        .map_err(|e| format!("Failed to open Windows Terminal: {}", e))?;
    Ok(())
}

/// Execute command in Warp terminal (macOS only)
fn execute_in_warp(working_dir: Option<&str>, command: &str) -> Result<(), String> {
    let escaped_command = command
        .replace('\\', "\\\\")
        .replace('"', "\\\"");

    let full_cmd = if let Some(dir) = working_dir {
        let escaped_dir = dir.replace('\'', "'\\''");
        format!("cd '{}' && {}", escaped_dir, escaped_command)
    } else {
        escaped_command
    };

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

    std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn()
        .map_err(|e| format!("Failed to open Warp: {}", e))?;
    Ok(())
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

    // Replace placeholders in custom command
    // {dir} = working directory
    // {cmd} = the command to execute
    let final_command = custom_command
        .replace("{dir}", working_dir.unwrap_or("."))
        .replace("{cmd}", command);

    // Execute via shell
    if cfg!(target_os = "windows") {
        std::process::Command::new("cmd")
            .args(["/c", &final_command])
            .spawn()
            .map_err(|e| format!("Failed to execute custom terminal: {}", e))?;
    } else {
        std::process::Command::new("sh")
            .args(["-c", &final_command])
            .spawn()
            .map_err(|e| format!("Failed to execute custom terminal: {}", e))?;
    }
    Ok(())
}

/// Get list of available terminal apps for the current platform
pub fn get_available_terminals() -> Vec<(&'static str, &'static str)> {
    let mut terminals = vec![
        ("background", "Background (no window)"),
        ("system", if cfg!(target_os = "macos") { "Terminal.app" } else { "Command Prompt" }),
    ];

    if cfg!(target_os = "macos") {
        // Check if iTerm2 is installed
        if std::path::Path::new("/Applications/iTerm.app").exists() {
            terminals.push(("iterm2", "iTerm2"));
        }
        // Check if Warp is installed
        if std::path::Path::new("/Applications/Warp.app").exists() {
            terminals.push(("warp", "Warp"));
        }
    }

    if cfg!(target_os = "windows") {
        // Check if Windows Terminal is installed
        if is_cli_installed("wt.exe") || is_cli_installed("wt") {
            terminals.push(("windows_terminal", "Windows Terminal"));
        }
    }

    terminals.push(("custom", "Custom..."));
    terminals
}
