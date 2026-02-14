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
            return format!("{}:/{}", drive_letter, rest.replace('-', "/"));
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

/// Extract the last path component (file/directory name) from a path string,
/// handling both `/` and `\` separators.
pub fn path_file_name(path: &str) -> &str {
    path.rsplit(&['/', '\\'][..])
        .next()
        .unwrap_or(path)
}
