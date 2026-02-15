import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  FileText,
  Copy,
  Check,
  RefreshCw,
  GitCommit,
  Zap,
  Clock,
  Sparkles,
} from "lucide-react";
import { DailyReport } from "../lib/types.js";
import { useToast } from "../contexts/ToastContext.js";

// --- Utility functions ---

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dateStr === today.toISOString().split("T")[0]) {
    return "Today";
  }
  if (dateStr === yesterday.toISOString().split("T")[0]) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function sessionStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "text-green-400";
    case "error":
      return "text-red-400";
    default:
      return "text-gray-400";
  }
}

function priorityDotColor(priority: string): string {
  switch (priority) {
    case "high":
      return "bg-red-500";
    case "low":
      return "bg-blue-500";
    default:
      return "bg-yellow-500";
  }
}

// --- Sub-components ---

interface SectionCardProps {
  children: React.ReactNode;
}

function SectionCard({ children }: SectionCardProps) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
      {children}
    </div>
  );
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  children: React.ReactNode;
}

function SectionHeader({ icon, children }: SectionHeaderProps) {
  return (
    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
      {icon}
      {children}
    </h4>
  );
}

interface StatBoxProps {
  value: string;
  label: string;
  valueColor?: string;
}

function StatBox({ value, label, valueColor = "text-gray-200" }: StatBoxProps) {
  return (
    <div className="text-center p-2 bg-white/[0.02] rounded-lg">
      <p className={`text-lg font-semibold ${valueColor}`}>{value}</p>
      <p className="text-[10px] text-gray-500 uppercase">{label}</p>
    </div>
  );
}

// --- Main component ---

export default function ReportsView() {
  const [reports, setReports] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  useEffect(() => {
    loadReports();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      loadReport(selectedDate);
    }
  }, [selectedDate]);

  async function loadReports(): Promise<void> {
    try {
      const result = await invoke<string[]>("list_reports", {});
      setReports(result);
      if (result.length > 0 && !selectedDate) {
        setSelectedDate(result[0]);
      }
    } catch (error) {
      console.error("Failed to load reports:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadReport(date: string): Promise<void> {
    try {
      const result = await invoke<DailyReport>("get_daily_report", { date });
      setReport(result);
    } catch {
      await generateReport(date);
    }
  }

  async function generateReport(date?: string): Promise<void> {
    setGenerating(true);
    try {
      const result = await invoke<DailyReport>("generate_daily_report", {
        date: date || null,
      });
      setReport(result);
      setSelectedDate(result.date);
      loadReports();
    } catch (error) {
      console.error("Failed to generate report:", error);
    } finally {
      setGenerating(false);
    }
  }

  async function copyMarkdown(): Promise<void> {
    if (!report) return;
    try {
      await writeText(report.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }

  async function generateAISummary(): Promise<void> {
    if (!report || !selectedDate) return;
    setGeneratingAI(true);
    try {
      const result = await invoke<DailyReport>("generate_report_ai_summary", {
        date: selectedDate,
      });
      setReport(result);
      toast.success("AI summary generated");
    } catch (error) {
      console.error("Failed to generate AI summary:", error);
      toast.error("Failed to generate AI summary");
    } finally {
      setGeneratingAI(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const ccAssistedCommits = report?.git_commits.filter((c) => c.is_cc_assisted) ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <select
            value={selectedDate || ""}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg py-1.5 px-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          >
            {reports.length === 0 ? (
              <option value="">No reports</option>
            ) : (
              reports.map((date) => (
                <option key={date} value={date}>
                  {formatDate(date)}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => generateReport()}
            disabled={generating}
            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={generating ? "animate-spin" : ""} />
            Generate Today
          </button>
          {report && (
            <button
              onClick={copyMarkdown}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-300 hover:bg-white/5 rounded transition-colors"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {!report ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <FileText size={32} className="opacity-50" />
            <p className="text-sm">No report selected</p>
            <button
              onClick={() => generateReport()}
              disabled={generating}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              Generate Today's Report
            </button>
          </div>
        ) : (
          <>
            {/* AI Summary Section */}
            <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-purple-300 uppercase tracking-wider flex items-center gap-2">
                  <Sparkles size={12} />
                  AI Summary
                </h4>
                {!report.ai_summary && (
                  <button
                    onClick={generateAISummary}
                    disabled={generatingAI}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded transition-colors disabled:opacity-50"
                  >
                    {generatingAI ? (
                      <>
                        <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles size={10} />
                        Generate
                      </>
                    )}
                  </button>
                )}
              </div>
              {report.ai_summary ? (
                <p className="text-sm text-gray-200 leading-relaxed">
                  {report.ai_summary}
                </p>
              ) : (
                <p className="text-xs text-gray-500 italic">
                  Click "Generate" to create an AI-powered summary of today's work using Claude Haiku (~$0.01).
                </p>
              )}
            </div>

            {/* Sessions Summary */}
            <SectionCard>
              <SectionHeader icon={<Clock size={12} />}>
                Sessions ({report.sessions.length})
              </SectionHeader>
              {report.sessions.length === 0 ? (
                <p className="text-xs text-gray-500">No sessions today</p>
              ) : (
                <div className="space-y-2">
                  {report.sessions.map((session, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 bg-white/[0.02] rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded">
                            {session.project_name}
                          </span>
                          <span className={`text-[10px] ${sessionStatusColor(session.status)}`}>
                            {session.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1 truncate">
                          "{session.prompt}"
                        </p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div className="text-[10px] text-gray-500">
                          {formatTokens(session.tokens)} tokens
                        </div>
                        <div className="text-[10px] text-green-400">
                          ${session.cost_usd.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Git Commits */}
            {ccAssistedCommits.length > 0 && (
              <SectionCard>
                <SectionHeader icon={<GitCommit size={12} />}>
                  Git Commits (CC-assisted: {ccAssistedCommits.length})
                </SectionHeader>
                <div className="space-y-2">
                  {ccAssistedCommits.map((commit, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-2 p-2 bg-white/[0.02] rounded-lg"
                    >
                      <code className="text-[10px] text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded font-mono">
                        {commit.hash}
                      </code>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-300 truncate">
                          {commit.message}
                        </p>
                        <span className="text-[10px] text-gray-500">
                          {commit.project_name}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Usage Summary */}
            <SectionCard>
              <SectionHeader icon={<Zap size={12} />}>
                Usage Summary
              </SectionHeader>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <StatBox
                  value={String(report.usage_summary.total_sessions)}
                  label="Sessions"
                />
                <StatBox
                  value={formatTokens(report.usage_summary.total_tokens)}
                  label="Tokens"
                />
                <StatBox
                  value={`$${report.usage_summary.total_cost_usd.toFixed(2)}`}
                  label="Cost"
                  valueColor="text-green-400"
                />
              </div>

              {report.usage_summary.by_project.length > 0 && (
                <div className="space-y-1">
                  {report.usage_summary.by_project.map((project, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-gray-400">{project.project_name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500 font-mono">
                          {formatTokens(project.tokens)}
                        </span>
                        <span className="text-green-400 font-mono">
                          ${project.cost_usd.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Pending Tasks */}
            {report.pending_tasks.length > 0 && (
              <SectionCard>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Pending Tasks ({report.pending_tasks.length})
                </h4>
                <div className="space-y-2">
                  {report.pending_tasks.slice(0, 5).map((task, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className={`w-2 h-2 rounded-full ${priorityDotColor(task.priority)}`} />
                      <span className="text-gray-300 truncate flex-1">
                        "{task.prompt}"
                      </span>
                      {task.project_name && (
                        <span className="text-gray-500 shrink-0">
                          ({task.project_name})
                        </span>
                      )}
                    </div>
                  ))}
                  {report.pending_tasks.length > 5 && (
                    <p className="text-[10px] text-gray-500">
                      ...and {report.pending_tasks.length - 5} more
                    </p>
                  )}
                </div>
              </SectionCard>
            )}
          </>
        )}
      </div>
    </div>
  );
}
