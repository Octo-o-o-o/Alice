/**
 * Provider visual identity system.
 *
 * Defines colors, icons, and labels for each AI provider
 * to create consistent visual distinction across the UI.
 */

import { Code2, Sparkles, Zap } from "lucide-react";
import type { ProviderId } from "./types.ts";

export type LucideIcon = typeof Zap;

export interface ProviderColorScheme {
  primary: string;
  light: string;
  glow: string;
}

export interface ProviderIdentity {
  label: string;
  icon: LucideIcon;
  colors: ProviderColorScheme;
}

/** Converts a hex color (e.g. "#D97706") to an rgba glow string at 30% opacity. */
function hexToGlow(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.3)`;
}

function defineColors(primary: string, light: string): ProviderColorScheme {
  return { primary, light, glow: hexToGlow(primary) };
}

const PROVIDERS: Record<ProviderId, ProviderIdentity> = {
  claude: {
    label: "Claude",
    icon: Zap,
    colors: defineColors("#D97706", "#FBBF24"),   // Amber - Anthropic brand tone
  },
  codex: {
    label: "Codex",
    icon: Code2,
    colors: defineColors("#10B981", "#34D399"),   // Green - OpenAI theme
  },
  gemini: {
    label: "Gemini",
    icon: Sparkles,
    colors: defineColors("#3B82F6", "#60A5FA"),   // Blue - Google theme
  },
};

export function getProviderIdentity(provider: ProviderId): ProviderIdentity {
  return PROVIDERS[provider];
}

export function getProviderColor(provider: ProviderId): ProviderColorScheme {
  return PROVIDERS[provider].colors;
}

export function getProviderIcon(provider: ProviderId): LucideIcon {
  return PROVIDERS[provider].icon;
}

export function getProviderLabel(provider: ProviderId): string {
  return PROVIDERS[provider].label;
}
