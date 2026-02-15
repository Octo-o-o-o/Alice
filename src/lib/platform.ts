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
  return navigator.userAgent.includes("Mac");
}

export function isWindowsSync(): boolean {
  return navigator.userAgent.includes("Windows");
}

export function getModKey(): string {
  return isMacSync() ? "\u2318" : "Ctrl";
}

export function formatShortcut(key: string): string {
  return `${getModKey()}${key}`;
}

// Windows WebView2 has unreliable backdrop-filter support, so use a solid fallback
export function getGlassClass(): string {
  return isMacSync()
    ? "backdrop-blur-xl bg-gray-950/75"
    : "bg-[#0B0F19]/95";
}

export function getPathSeparator(): string {
  return isMacSync() ? "/" : "\\";
}

export function formatPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function getClaudeDir(): string {
  return isMacSync() ? "~/.claude" : "%USERPROFILE%\\.claude";
}
