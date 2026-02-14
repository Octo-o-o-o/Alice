// Cross-platform utilities for Alice
import { platform } from "@tauri-apps/plugin-os";

let cachedPlatform: string | null = null;

export async function getPlatform(): Promise<string> {
  if (cachedPlatform === null) {
    cachedPlatform = await platform();
  }
  return cachedPlatform;
}

export function isMacSync(): boolean {
  // Fallback for synchronous check using navigator
  return navigator.userAgent.includes("Mac");
}

export function isWindowsSync(): boolean {
  return navigator.userAgent.includes("Windows");
}

// Modifier key display
export function getModKey(): string {
  return isMacSync() ? "⌘" : "Ctrl";
}

// Format keyboard shortcut for display
export function formatShortcut(key: string): string {
  const mod = getModKey();
  return `${mod}${key}`;
}

// Glass effect class based on platform
// Windows WebView2 has unreliable backdrop-filter support
export function getGlassClass(): string {
  return isMacSync()
    ? "backdrop-blur-xl bg-gray-950/75"
    : "bg-[#0B0F19]/95"; // Solid fallback on Windows
}

// Path separator
export function getPathSeparator(): string {
  return isMacSync() ? "/" : "\\";
}

// Format file path for display
export function formatPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

// Get home directory placeholder (actual path from Tauri)
export function getClaudeDir(): string {
  return isMacSync() ? "~/.claude" : "%USERPROFILE%\\.claude";
}
