/**
 * Provider visual identity system.
 *
 * Defines colors, icons, and labels for each AI provider
 * to create consistent visual distinction across the UI.
 */

import { Code2, Sparkles, Zap } from "lucide-react";
import type { ProviderId } from "./types";

export interface ProviderColorScheme {
  primary: string;
  light: string;
  glow: string;
}

interface ProviderIdentity {
  label: string;
  icon: typeof Zap;
  colors: ProviderColorScheme;
}

const PROVIDERS: Record<ProviderId, ProviderIdentity> = {
  claude: {
    label: "Claude",
    icon: Zap,
    colors: {
      primary: "#D97706",   // Amber - Anthropic brand tone
      light: "#FBBF24",
      glow: "rgba(217, 119, 6, 0.3)",
    },
  },
  codex: {
    label: "Codex",
    icon: Code2,
    colors: {
      primary: "#10B981",   // Green - OpenAI theme
      light: "#34D399",
      glow: "rgba(16, 185, 129, 0.3)",
    },
  },
  gemini: {
    label: "Gemini",
    icon: Sparkles,
    colors: {
      primary: "#3B82F6",   // Blue - Google theme
      light: "#60A5FA",
      glow: "rgba(59, 130, 246, 0.3)",
    },
  },
} as const;

export function getProviderColor(provider: ProviderId): ProviderColorScheme {
  return PROVIDERS[provider].colors;
}

export function getProviderIcon(provider: ProviderId): typeof Zap {
  return PROVIDERS[provider].icon;
}

export function getProviderLabel(provider: ProviderId): string {
  return PROVIDERS[provider].label;
}
