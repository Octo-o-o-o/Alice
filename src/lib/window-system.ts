import { invoke } from "@tauri-apps/api/core";
import type { WindowContext } from "./types";

export async function getWindowContext(): Promise<WindowContext> {
  return invoke<WindowContext>("get_window_context");
}

export async function openMainWindow(route: string): Promise<void> {
  await invoke("open_main_window", { route });
}

export async function openQuickWindow(route: string): Promise<void> {
  await invoke("open_quick_window", { route });
}

export async function navigateDeepLink(uri: string): Promise<void> {
  await invoke("navigate_deep_link", { uri });
}

export function toDeepLink(path: string): string {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return `alice://${normalized}`;
}
