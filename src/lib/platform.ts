// Cross-platform detection utilities for Alice

const IS_MAC = navigator.userAgent.includes("Mac");

export function isMacSync(): boolean {
  return IS_MAC;
}

export function getModKey(): string {
  return IS_MAC ? "\u2318" : "Ctrl";
}
