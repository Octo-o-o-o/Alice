import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Zap, FileText, Copy, Check, RefreshCw, ChevronRight, GitCommit, ArrowUpDown, ArrowUp, ArrowDown, Activity, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { UsageStats, DailyReport, ProjectUsage, AnthropicStatus } from "../lib/types";
import UsageMeter from "../components/UsageMeter";
import BarChart from "../components/BarChart";

type SortField = "name" | "tokens" | "cost" | "sessions";
type SortDirection = "asc" | "desc";

export default function UsageView() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sortField, setSortField] = useState<SortField>("cost");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [apiStatus, setApiStatus] = useState<AnthropicStatus | null>(null);

  const loadStats = async () => {
    try {
      const now = new Date();
      let startDate: string;

      switch (period) {
        case "today":
          startDate = now.toISOString().split("T")[0];
          break;
        case "week":
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          startDate = weekAgo.toISOString().split("T")[0];
          break;
        case "month":
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          startDate = monthAgo.toISOString().split("T")[0];
          break;
      }

      const result = await invoke<UsageStats>("get_usage_stats", {
        project: null,
        startDate,
        endDate: null,
      });
      setStats(result);
    } catch (error) {
      console.error("Failed to load usage stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    setReportLoading(true);
    try {
      const result = await invoke<DailyReport>("generate_daily_report", {
        date: null,
      });
      setReport(result);
      setShowReport(true);
    } catch (error) {
      console.error("Failed to generate report:", error);
    } finally {
      setReportLoading(false);
    }
  };

  const copyReportMarkdown = async () => {
    if (!report) return;
    try {
      await writeText(report.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const loadApiStatus = async () => {
    try {
      const result = await invoke<AnthropicStatus>("get_anthropic_status", {});
      setApiStatus(result);
    } catch (error) {
      console.error("Failed to load Anthropic status:", error);
    }
  };

  useEffect(() => {
    loadStats();
    loadApiStatus();
    // Refresh status every 5 minutes
    const interval = setInterval(loadApiStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [period]);

  // Format numbers
  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    }
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(2)}`;
  };

  // Sort projects
  const sortProjects = (projects: ProjectUsage[]): ProjectUsage[] => {
    return [...projects].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "name":
          comparison = a.project_name.localeCompare(b.project_name);
          break;
        case "tokens":
          comparison = a.tokens - b.tokens;
          break;
        case "cost":
          comparison = a.cost_usd - b.cost_usd;
          break;
        case "sessions":
          comparison = a.session_count - b.session_count;
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown size={10} className="text-gray-600" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp size={10} className="text-blue-400" />
    ) : (
      <ArrowDown size={10} className="text-blue-400" />
    );
  };

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

  // Prepare chart data
  const chartData = stats.daily_usage.slice(0, 14).reverse().map((day) => ({
    label: day.date.slice(5), // MM-DD
    value: day.tokens,
    secondaryValue: day.cost_usd,
  }));

  return (
    <div className="h-full overflow-y-auto">
      {/* Period selector */}
      <div className="p-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(["today", "week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                period === p
                  ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                  : "text-gray-400 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
            </button>
          ))}
        </div>
        <button
          onClick={generateReport}
          disabled={reportLoading}
          className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50"
        >
          {reportLoading ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : (
            <FileText size={12} />
          )}
          Daily Report
        </button>
      </div>

      <div className="p-3 space-y-4">
        {/* Anthropic API Status */}
        {apiStatus && (
          <div className={`flex items-center justify-between p-2 rounded-lg border ${
            apiStatus.status === "none"
              ? "bg-green-500/5 border-green-500/20"
              : apiStatus.status === "minor"
              ? "bg-yellow-500/5 border-yellow-500/20"
              : "bg-red-500/5 border-red-500/20"
          }`}>
            <div className="flex items-center gap-2">
              {apiStatus.status === "none" ? (
                <CheckCircle2 size={14} className="text-green-500" />
              ) : apiStatus.status === "minor" ? (
                <AlertTriangle size={14} className="text-yellow-500" />
              ) : (
                <XCircle size={14} className="text-red-500" />
              )}
              <span className={`text-xs ${
                apiStatus.status === "none"
                  ? "text-green-400"
                  : apiStatus.status === "minor"
                  ? "text-yellow-400"
                  : "text-red-400"
              }`}>
                Anthropic API: {apiStatus.description}
              </span>
            </div>
            <button
              onClick={loadApiStatus}
              className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
              title="Refresh status"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        )}

        {/* Active Incidents */}
        {apiStatus && apiStatus.incidents.length > 0 && (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Activity size={12} />
              Active Incidents
            </h4>
            <div className="space-y-2">
              {apiStatus.incidents.map((incident, index) => (
                <div key={index} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-200">{incident.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      incident.impact === "critical"
                        ? "bg-red-500/20 text-red-400"
                        : incident.impact === "major"
                        ? "bg-orange-500/20 text-orange-400"
                        : "bg-yellow-500/20 text-yellow-400"
                    }`}>
                      {incident.impact}
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-500">
                    Status: {incident.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Daily Report (if generated) */}
        {report && showReport && (
          <div className="bg-white/[0.03] border border-white/5 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowReport(!showReport)}
              className="w-full flex items-center justify-between p-3 hover:bg-white/[0.02] transition-colors"
            >
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <ChevronRight size={12} className={`transition-transform ${showReport ? "rotate-90" : ""}`} />
                Daily Report - {report.date}
              </h4>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyReportMarkdown();
                }}
                className="p-1 text-gray-500 hover:text-gray-300"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </button>

            <div className="px-3 pb-3 space-y-3">
              {/* Sessions */}
              {report.sessions.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">Sessions ({report.sessions.length})</p>
                  {report.sessions.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1">
                      <span className="text-gray-400 truncate flex-1">{s.project_name}</span>
                      <span className="text-green-400 ml-2">${s.cost_usd.toFixed(2)}</span>
                    </div>
                  ))}
                  {report.sessions.length > 3 && (
                    <p className="text-[10px] text-gray-600">+{report.sessions.length - 3} more</p>
                  )}
                </div>
              )}

              {/* CC Commits */}
              {report.git_commits.filter(c => c.is_cc_assisted).length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 mb-1 flex items-center gap-1">
                    <GitCommit size={10} />
                    CC-assisted commits ({report.git_commits.filter(c => c.is_cc_assisted).length})
                  </p>
                  {report.git_commits.filter(c => c.is_cc_assisted).slice(0, 3).map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1">
                      <code className="text-blue-400 text-[10px]">{c.hash}</code>
                      <span className="text-gray-400 truncate">{c.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Total */}
              <div className="flex items-center justify-between text-xs pt-2 border-t border-white/5">
                <span className="text-gray-500">Total</span>
                <span className="font-medium text-green-400">${report.usage_summary.total_cost_usd.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Live usage meters */}
        <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Rate Limits
          </h4>
          <UsageMeter />
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 text-center">
            <p className="text-lg font-semibold text-gray-100">
              {formatTokens(stats.total_tokens)}
            </p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">
              Tokens
            </p>
          </div>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 text-center">
            <p className="text-lg font-semibold text-green-400">
              {formatCost(stats.total_cost_usd)}
            </p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">
              Cost
            </p>
          </div>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 text-center">
            <p className="text-lg font-semibold text-gray-100">
              {stats.session_count}
            </p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">
              Sessions
            </p>
          </div>
        </div>

        {/* Token breakdown */}
        <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Token Breakdown
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Input</span>
              <span className="text-xs text-gray-200 font-mono">
                {formatTokens(stats.input_tokens)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Output</span>
              <span className="text-xs text-gray-200 font-mono">
                {formatTokens(stats.output_tokens)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Cache Read</span>
              <span className="text-xs text-gray-200 font-mono">
                {formatTokens(stats.cache_read_tokens)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Cache Write</span>
              <span className="text-xs text-gray-200 font-mono">
                {formatTokens(stats.cache_write_tokens)}
              </span>
            </div>
          </div>
        </div>

        {/* Daily chart using BarChart component */}
        {stats.daily_usage.length > 0 && (
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Daily Usage
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
        {stats.project_usage.length > 0 && (
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              By Project
            </h4>

            {/* Table header */}
            <div className="flex items-center gap-2 pb-2 border-b border-white/5 mb-2">
              <button
                onClick={() => toggleSort("name")}
                className="flex-1 flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300"
              >
                Project <SortIcon field="name" />
              </button>
              <button
                onClick={() => toggleSort("sessions")}
                className="w-12 flex items-center justify-end gap-1 text-[10px] text-gray-500 hover:text-gray-300"
              >
                <SortIcon field="sessions" /> #
              </button>
              <button
                onClick={() => toggleSort("tokens")}
                className="w-16 flex items-center justify-end gap-1 text-[10px] text-gray-500 hover:text-gray-300"
              >
                <SortIcon field="tokens" /> Tokens
              </button>
              <button
                onClick={() => toggleSort("cost")}
                className="w-14 flex items-center justify-end gap-1 text-[10px] text-gray-500 hover:text-gray-300"
              >
                <SortIcon field="cost" /> Cost
              </button>
            </div>

            {/* Table rows */}
            <div className="space-y-1.5">
              {sortProjects(stats.project_usage).slice(0, 8).map((project) => (
                <div
                  key={project.project_path}
                  className="flex items-center gap-2 py-1 hover:bg-white/[0.02] rounded transition-colors"
                >
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
              ))}
            </div>

            {stats.project_usage.length > 8 && (
              <p className="text-[10px] text-gray-600 mt-2 text-center">
                +{stats.project_usage.length - 8} more projects
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
