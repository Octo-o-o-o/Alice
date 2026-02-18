import React, { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Zap, ArrowUpDown, ArrowUp, ArrowDown, Settings, RefreshCw } from "lucide-react";
import { UsageStats, ProjectUsage, ProviderStatus } from "../lib/types";
import ProviderUsageCard from "../components/ProviderUsageCard";
import BarChart from "../components/BarChart";

type Period = "today" | "week" | "month";
type SortField = "name" | "tokens" | "cost" | "sessions";
type SortDirection = "asc" | "desc";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
};

const PERIOD_DAYS: Record<Period, number> = {
  today: 0,
  week: 7,
  month: 30,
};

const PERIODS = Object.keys(PERIOD_LABELS) as Period[];
const MAX_VISIBLE_PROJECTS = 8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PROJECT_TABLE_COLUMNS: { field: SortField; label: string; className: string; labelFirst?: boolean }[] = [
  { field: "name", label: "Project", className: "flex-1", labelFirst: true },
  { field: "sessions", label: "#", className: "w-12 justify-end" },
  { field: "tokens", label: "Tokens", className: "w-16 justify-end" },
  { field: "cost", label: "Cost", className: "w-14 justify-end" },
];

const DATE_FORMAT_SHORT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
const DATE_FORMAT_FULL: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

function getStartDate(period: Period): string {
  const daysBack = PERIOD_DAYS[period];
  const date = daysBack === 0 ? new Date() : new Date(Date.now() - daysBack * MS_PER_DAY);
  return date.toISOString().split("T")[0];
}

function getDateRangeLabel(period: Period): string | null {
  if (period === "today") return null;

  const now = new Date();
  const start = new Date(now.getTime() - PERIOD_DAYS[period] * MS_PER_DAY);
  return `${start.toLocaleDateString("en-US", DATE_FORMAT_SHORT)} - ${now.toLocaleDateString("en-US", DATE_FORMAT_FULL)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

const SORT_COMPARATORS: Record<SortField, (a: ProjectUsage, b: ProjectUsage) => number> = {
  name: (a, b) => a.project_name.localeCompare(b.project_name),
  tokens: (a, b) => a.tokens - b.tokens,
  cost: (a, b) => a.cost_usd - b.cost_usd,
  sessions: (a, b) => a.session_count - b.session_count,
};

function sortProjects(
  projects: ProjectUsage[],
  field: SortField,
  direction: SortDirection,
): ProjectUsage[] {
  const comparator = SORT_COMPARATORS[field];
  const sign = direction === "asc" ? 1 : -1;
  return [...projects].sort((a, b) => sign * comparator(a, b));
}

function SortIcon({ active, direction }: {
  active: boolean;
  direction: SortDirection;
}): React.ReactElement {
  if (!active) return <ArrowUpDown size={10} className="text-gray-600" />;
  const Icon = direction === "asc" ? ArrowUp : ArrowDown;
  return <Icon size={10} className="text-blue-400" />;
}

interface SortColumnProps {
  field: SortField;
  label: string;
  activeField: SortField;
  direction: SortDirection;
  onToggle: (field: SortField) => void;
  className?: string;
  labelFirst?: boolean;
}

function SortColumn({ field, label, activeField, direction, onToggle, className = "", labelFirst = false }: SortColumnProps): React.ReactElement {
  return (
    <button
      onClick={() => onToggle(field)}
      className={`flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 ${labelFirst ? "flex-row" : "flex-row-reverse"} ${className}`}
    >
      {label}
      <SortIcon active={field === activeField} direction={direction} />
    </button>
  );
}

function ProjectRow({ project }: { project: ProjectUsage }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 py-1 hover:bg-white/[0.02] rounded transition-colors">
      <span className="flex-1 text-xs text-gray-300 truncate">
        {project.project_name}
      </span>
      <span className="w-12 text-right text-[10px] text-gray-500 font-mono">
        {project.session_count}
      </span>
      <span className="w-16 text-right text-[10px] text-gray-400 font-mono">
        {formatTokens(project.tokens)}
      </span>
      <span className="w-14 text-right text-[10px] text-green-400 font-mono">
        {formatCost(project.cost_usd)}
      </span>
    </div>
  );
}

export default function UsageView(): React.ReactElement {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("today");
  const [sortField, setSortField] = useState<SortField>("cost");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  async function loadStats(): Promise<void> {
    try {
      const result = await invoke<UsageStats>("get_usage_stats", {
        project: null,
        provider: null,
        startDate: getStartDate(period),
        endDate: null,
      });
      setStats(result);
    } catch (error) {
      console.error("Failed to load usage stats:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadProviders(): Promise<void> {
    try {
      const result = await invoke<ProviderStatus[]>("get_provider_statuses");
      setProviders(result.filter((p) => p.enabled));
    } catch (error) {
      console.error("Failed to load provider statuses:", error);
    }
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    try {
      await Promise.all([loadStats(), loadProviders()]);
      setRefreshTrigger((prev) => prev + 1);
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  }

  function toggleSort(field: SortField): void {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  }

  useEffect(() => {
    loadStats();
    loadProviders();
  }, [period]);

  const dateRangeLabel = useMemo(() => getDateRangeLabel(period), [period]);

  const chartData = useMemo(() => {
    if (!stats) return [];
    return stats.daily_usage.slice(0, 14).reverse().map((day) => ({
      label: day.date.slice(5),
      value: day.tokens,
      secondaryValue: day.cost_usd,
    }));
  }, [stats]);

  const sortedProjects = useMemo(() => {
    if (!stats) return [];
    return sortProjects(stats.project_usage, sortField, sortDirection);
  }, [stats, sortField, sortDirection]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats || stats.session_count === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
        <Zap size={32} className="opacity-50" />
        <p className="text-sm">No usage data yet</p>
        <p className="text-xs text-gray-600">
          Start a Claude Code session to see stats
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Period selector */}
      <div className="p-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                period === p
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 text-gray-400 hover:text-gray-200 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Refresh all providers"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="p-3 space-y-4">
        {/* Date Range */}
        {dateRangeLabel && (
          <div className="text-center text-xs text-gray-500">
            {dateRangeLabel}
          </div>
        )}

        {/* Empty state - No providers enabled */}
        {providers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="p-4 rounded-full bg-blue-500/10 border border-blue-500/20">
              <Settings size={32} className="text-blue-400" />
            </div>
            <div className="text-center space-y-2 max-w-[300px]">
              <p className="text-sm font-medium text-gray-200">No Providers Enabled</p>
              <p className="text-xs text-gray-500">
                Enable AI providers in the Config tab to start tracking your usage statistics
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Settings size={12} />
              <span>Go to Config → AI Providers</span>
            </div>
          </div>
        )}

        {/* Provider comparison grid */}
        {providers.length > 0 && (
          <div className={`grid gap-4 ${providers.length > 1 ? "md:grid-cols-2" : "grid-cols-1"}`}>
            {providers.map((provider) => (
              <ProviderUsageCard
                key={provider.id}
                provider={provider.id}
                period={period}
                refreshTrigger={refreshTrigger}
              />
            ))}
          </div>
        )}

        {/* Combined usage chart */}
        {chartData.length > 0 && (
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Combined Daily Usage
            </h4>
            <BarChart
              data={chartData}
              height={96}
              showLabels={true}
              labelInterval={2}
              formatValue={formatTokens}
              formatSecondary={formatCost}
            />
          </div>
        )}

        {/* Project breakdown with sortable table */}
        {sortedProjects.length > 0 && (
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              By Project
            </h4>

            {/* Table header */}
            <div className="flex items-center gap-2 pb-2 border-b border-white/5 mb-2">
              {PROJECT_TABLE_COLUMNS.map((col) => (
                <SortColumn
                  key={col.field}
                  field={col.field}
                  label={col.label}
                  activeField={sortField}
                  direction={sortDirection}
                  onToggle={toggleSort}
                  className={col.className}
                  labelFirst={col.labelFirst}
                />
              ))}
            </div>

            {/* Table rows */}
            <div className="space-y-1.5">
              {sortedProjects.slice(0, MAX_VISIBLE_PROJECTS).map((project) => (
                <ProjectRow key={project.project_path} project={project} />
              ))}
            </div>

            {stats.project_usage.length > MAX_VISIBLE_PROJECTS && (
              <p className="text-[10px] text-gray-600 mt-2 text-center">
                +{stats.project_usage.length - MAX_VISIBLE_PROJECTS} more projects
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
