/**
 * ProviderUsageCard - Display usage statistics for a specific AI provider
 *
 * Shows provider's tokens, cost, sessions, rate limits (if supported),
 * and API status. Used in UsageView for multi-provider comparison.
 */

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle, Activity } from "lucide-react";
import type { ProviderId, LiveUsageStats, AnthropicStatus, UsageStats, ProviderUsage } from "../lib/types";
import { getProviderColor, getProviderIcon, getProviderLabel } from "../lib/provider-colors";

// --- Status styling lookup ---

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; icon: typeof CheckCircle2 }> = {
  none:     { bg: "bg-green-500/5",  border: "border-green-500/20",  text: "text-green-400",  icon: CheckCircle2 },
  minor:    { bg: "bg-yellow-500/5", border: "border-yellow-500/20", text: "text-yellow-400", icon: AlertTriangle },
  major:    { bg: "bg-red-500/5",    border: "border-red-500/20",    text: "text-red-400",    icon: XCircle },
  critical: { bg: "bg-red-500/5",    border: "border-red-500/20",    text: "text-red-400",    icon: XCircle },
};

const IMPACT_STYLES: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400",
  major:    "bg-orange-500/20 text-orange-400",
  minor:    "bg-yellow-500/20 text-yellow-400",
};

// --- Period-to-days mapping ---

const PERIOD_DAYS: Record<string, number> = {
  today: 0,
  week: 7,
  month: 30,
};

// --- Formatting helpers ---

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatResetTime(resetAt: string | null): string {
  if (!resetAt) return "Unknown";

  try {
    const diffMs = new Date(resetAt).getTime() - Date.now();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) return `${diffHours}h ${diffMins % 60}m`;
    if (diffMins > 0) return `${diffMins}m`;
    return "Soon";
  } catch {
    return "Unknown";
  }
}

function getPercentColor(percent: number): string {
  if (percent > 80) return "bg-red-500";
  if (percent > 60) return "bg-yellow-500";
  return "bg-blue-500";
}

function getStartDate(period: "today" | "week" | "month"): string {
  const daysAgo = PERIOD_DAYS[period];
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return date.toISOString().split("T")[0];
}

// --- Extracted sub-components ---

function SummaryCard({ value, label, color }: { value: string; label: string; color?: string }): React.ReactElement {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-2 text-center">
      <p className="text-base font-semibold" style={color ? { color } : undefined}>
        {value}
      </p>
      <p className="text-[9px] text-gray-500 uppercase tracking-wider">
        {label}
      </p>
    </div>
  );
}

function TokenRow({ label, tokens }: { label: string; tokens: number }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-gray-400">{label}</span>
      <span className="text-[10px] text-gray-200 font-mono">{formatTokens(tokens)}</span>
    </div>
  );
}

function RateLimitBar({ label, percent, resetAt }: { label: string; percent: number; resetAt: string | null }): React.ReactElement {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-gray-400 font-medium">{label}</span>
        <span className="text-gray-300 font-mono">{Math.round(percent)}%</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all ${getPercentColor(percent)}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-[9px] text-gray-500">
        Resets in {formatResetTime(resetAt)}
      </span>
    </div>
  );
}

// --- Main component ---

interface ProviderUsageCardProps {
  provider: ProviderId;
  period: "today" | "week" | "month";
  refreshTrigger?: number;
}

export default function ProviderUsageCard({ provider, period, refreshTrigger }: ProviderUsageCardProps): React.ReactElement {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [liveUsage, setLiveUsage] = useState<LiveUsageStats | null>(null);
  const [apiStatus, setApiStatus] = useState<AnthropicStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const color = getProviderColor(provider);
  const Icon = getProviderIcon(provider);
  const label = getProviderLabel(provider);
  const isClaude = provider === "claude";

  const cardBorder = { borderColor: `${color.primary}20` };

  async function loadStats(): Promise<void> {
    try {
      const result = await invoke<UsageStats>("get_usage_stats", {
        project: null,
        provider: provider,
        startDate: getStartDate(period),
        endDate: null,
      });
      setStats(result);
      setError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to load ${provider} usage stats:`, err);
      setError(`Failed to load usage data: ${errorMsg}`);
      throw err;
    }
  }

  async function loadLiveUsage(): Promise<void> {
    try {
      if (isClaude) {
        // Claude uses specialized usage API
        const hasCreds = await invoke<boolean>("has_claude_credentials");
        if (!hasCreds) return;

        const [result, status] = await Promise.all([
          invoke<LiveUsageStats>("get_live_usage"),
          invoke<AnthropicStatus>("get_anthropic_status", {}),
        ]);
        setLiveUsage(result);
        setApiStatus(status);
      } else {
        // Codex, Gemini use provider-generic OAuth API
        const result = await invoke<ProviderUsage>("get_provider_usage", { provider });

        // Convert ProviderUsage to LiveUsageStats format
        const liveStats: LiveUsageStats = {
          session_percent: result.session_percent,
          session_reset_at: result.session_reset_at,
          weekly_percent: result.weekly_percent ?? 0,
          weekly_reset_at: result.weekly_reset_at,
          burn_rate_per_hour: null,
          estimated_limit_in_minutes: null,
          account_email: null,
          account_plan: null,
          last_updated: result.last_updated,
          error: result.error,
        };
        setLiveUsage(liveStats);
      }
    } catch (err) {
      console.error(`Failed to load ${provider} live usage:`, err);
    }
  }

  async function loadData(): Promise<void> {
    try {
      await Promise.all([loadStats(), loadLiveUsage()]);
    } catch {
      // Error already set in loadStats
    } finally {
      setLoading(false);
    }
  }

  async function handleRetry(): Promise<void> {
    setError(null);
    setLoading(true);
    await loadData();
  }

  useEffect(() => {
    loadData();

    const interval = setInterval(loadLiveUsage, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [period, provider, refreshTrigger]);

  // --- Loading state ---

  if (loading) {
    return (
      <div
        className="bg-white/[0.03] border rounded-lg p-4 flex items-center justify-center h-[400px]"
        style={cardBorder}
      >
        <div
          className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: color.primary, borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  // --- Error state ---

  if (error) {
    return (
      <div
        className="bg-white/[0.03] border rounded-lg p-4 flex flex-col items-center justify-center h-[400px] gap-4"
        style={cardBorder}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-full bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-gray-200">{label} Provider Error</p>
            <p className="text-xs text-gray-500 max-w-[250px]">{error}</p>
          </div>
        </div>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{
            backgroundColor: `${color.primary}15`,
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: `${color.primary}30`,
            color: color.light,
          }}
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    );
  }

  // --- Empty state ---

  if (!stats || stats.session_count === 0) {
    return (
      <div
        className="bg-white/[0.03] border rounded-lg p-4 flex flex-col items-center justify-center h-[120px] gap-2"
        style={cardBorder}
      >
        <Icon size={24} style={{ color: color.light, opacity: 0.5 }} />
        <div className="text-center">
          <p className="text-xs text-gray-500">No {label} usage data</p>
          <p className="text-[10px] text-gray-600 mt-0.5">Start a session to see stats</p>
        </div>
      </div>
    );
  }

  // --- Resolve status styling ---

  const statusStyle = apiStatus ? STATUS_STYLES[apiStatus.status] ?? STATUS_STYLES.major : null;
  const StatusIcon = statusStyle?.icon;

  // --- Main content ---

  return (
    <div
      className="bg-white/[0.03] border rounded-lg p-4 space-y-4 h-full overflow-y-auto"
      style={cardBorder}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: `${color.primary}10` }}>
        <div className="flex items-center gap-2">
          <Icon size={18} style={{ color: color.light }} />
          <h3 className="text-sm font-semibold" style={{ color: color.light }}>{label}</h3>
        </div>
        <button
          onClick={loadLiveUsage}
          className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* API Status (Claude only) */}
      {isClaude && apiStatus && statusStyle && StatusIcon && (
        <div className={`flex items-center justify-between p-2 rounded-lg border ${statusStyle.bg} ${statusStyle.border}`}>
          <div className="flex items-center gap-2">
            <StatusIcon size={12} className={statusStyle.text} />
            <span className={`text-[10px] ${statusStyle.text}`}>
              API: {apiStatus.description}
            </span>
          </div>
        </div>
      )}

      {/* Active Incidents (Claude only) */}
      {isClaude && apiStatus && apiStatus.incidents.length > 0 && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-2">
          <h4 className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Activity size={10} />
            Active Incidents
          </h4>
          <div className="space-y-1.5">
            {apiStatus.incidents.map((incident, index) => (
              <div key={index} className="text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-gray-200">{incident.name}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded ${IMPACT_STYLES[incident.impact] ?? IMPACT_STYLES.minor}`}>
                    {incident.impact}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCard value={formatTokens(stats.total_tokens)} label="Tokens" />
        <SummaryCard value={formatCost(stats.total_cost_usd)} label="Cost" color={color.light} />
        <SummaryCard value={String(stats.session_count)} label="Sessions" />
      </div>

      {/* Rate Limits (Claude only) */}
      {isClaude && liveUsage && !liveUsage.error && (
        <div className="space-y-3">
          <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Rate Limits
          </h4>

          <RateLimitBar label="Session (5h)" percent={liveUsage.session_percent} resetAt={liveUsage.session_reset_at} />

          {liveUsage.weekly_percent != null && (
            <RateLimitBar label="Weekly" percent={liveUsage.weekly_percent} resetAt={liveUsage.weekly_reset_at} />
          )}

          {liveUsage.burn_rate_per_hour && liveUsage.burn_rate_per_hour > 5 && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-yellow-500/[0.06] border border-yellow-500/10 rounded text-[9px]">
              <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />
              <span className="text-yellow-300">
                Burn rate ~{Math.round(liveUsage.burn_rate_per_hour)}%/hr
              </span>
            </div>
          )}
        </div>
      )}

      {/* Token breakdown */}
      <div className="space-y-2">
        <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          Token Breakdown
        </h4>
        <div className="space-y-1.5">
          <TokenRow label="Input" tokens={stats.input_tokens} />
          <TokenRow label="Output" tokens={stats.output_tokens} />
          <TokenRow label="Cache Read" tokens={stats.cache_read_tokens} />
          <TokenRow label="Cache Write" tokens={stats.cache_write_tokens} />
        </div>
      </div>

      {/* Account info (Claude only) */}
      {isClaude && liveUsage?.account_email && (
        <div className="pt-2 border-t border-white/5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-500">Account</span>
            <span className="text-gray-400">{liveUsage.account_email}</span>
          </div>
        </div>
      )}
    </div>
  );
}
