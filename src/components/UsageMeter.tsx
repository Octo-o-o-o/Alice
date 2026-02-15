import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { LiveUsageStats } from "../lib/types";

interface UsageMeterProps {
  compact?: boolean;
}

function getPercentColor(percent: number): string {
  if (percent > 80) return "bg-red-500";
  if (percent > 60) return "bg-yellow-500";
  return "bg-blue-500";
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

interface ProgressBarProps {
  percent: number;
  height?: string;
}

function ProgressBar({ percent, height = "h-2" }: ProgressBarProps): React.ReactElement {
  return (
    <div className={`w-full bg-gray-800 rounded-full ${height} overflow-hidden`}>
      <div
        className={`${height} rounded-full transition-all duration-500 ${getPercentColor(percent)}`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

export default function UsageMeter({ compact = false }: UsageMeterProps) {
  const [stats, setStats] = useState<LiveUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasCredentials, setHasCredentials] = useState(false);

  const loadUsage = async () => {
    try {
      const hasCreds = await invoke<boolean>("has_claude_credentials");
      setHasCredentials(hasCreds);

      if (hasCreds) {
        const result = await invoke<LiveUsageStats>("get_live_usage");
        setStats(result);
      }
    } catch (error) {
      console.error("Failed to load usage:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsage();
    const interval = setInterval(loadUsage, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-2">
        <RefreshCw size={14} className="text-gray-500 animate-spin" />
      </div>
    );
  }

  if (!hasCredentials) {
    return (
      <div className="text-xs text-gray-500 text-center py-2">
        No Claude credentials found
      </div>
    );
  }

  if (stats?.error) {
    return (
      <div className="text-xs text-red-400 text-center py-2">
        {stats.error}
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {[
          { label: "5h", percent: stats.session_percent },
          { label: "7d", percent: stats.weekly_percent },
        ].map(({ label, percent }) => (
          <div key={label} className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500">{label}</span>
            <div className="w-12">
              <ProgressBar percent={percent} height="h-1.5" />
            </div>
            <span className="text-[10px] text-gray-400 font-mono w-8">
              {Math.round(percent)}%
            </span>
          </div>
        ))}
      </div>
    );
  }

  const meters = [
    { label: "Session (5h window)", percent: stats.session_percent, resetAt: stats.session_reset_at },
    { label: "Weekly", percent: stats.weekly_percent, resetAt: stats.weekly_reset_at },
  ];

  return (
    <div className="space-y-4">
      {meters.map(({ label, percent, resetAt }) => (
        <div key={label} className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-gray-400 font-medium">{label}</span>
            <span className="text-gray-300 font-mono">
              {Math.round(percent)}% used
            </span>
          </div>
          <ProgressBar percent={percent} />
          <span className="text-[10px] text-gray-500">
            Resets in {formatResetTime(resetAt)}
          </span>
        </div>
      ))}

      {/* Burn rate warning */}
      {stats.burn_rate_per_hour && stats.burn_rate_per_hour > 5 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-yellow-500/[0.06] border border-yellow-500/10 rounded text-[10px]">
          <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />
          <span className="text-yellow-300">
            Burn rate ~{Math.round(stats.burn_rate_per_hour)}%/hr
            {stats.estimated_limit_in_minutes && (
              <> · Session limit in ~{Math.round(stats.estimated_limit_in_minutes / 60)}h {stats.estimated_limit_in_minutes % 60}m</>
            )}
          </span>
        </div>
      )}

      {/* Account info */}
      {stats.account_email && (
        <div className="pt-2 border-t border-white/5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-500">Account</span>
            <span className="text-gray-400">{stats.account_email}</span>
          </div>
        </div>
      )}
    </div>
  );
}
