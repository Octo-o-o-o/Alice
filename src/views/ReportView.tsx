import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Calendar as CalendarIcon,
  Download,
  Star,
  Briefcase,
  FileText,
  LucideIcon,
  ChevronDown,
  Copy,
  FileType,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DailyReport } from "../lib/types.js";
import { useToast } from "../contexts/ToastContext.js";

// --- Markdown component overrides for themed rendering ---

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-6 pb-4 border-b border-white/10">
      <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-100 to-gray-400">
        {children}
      </h1>
    </div>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-xl font-semibold mt-8 mb-4 flex items-center gap-2 text-gray-200">
      <span className="w-1 h-6 rounded-full bg-blue-500/80"></span>
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-lg font-medium mt-6 mb-3 text-gray-300">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-4 leading-7 text-gray-400 font-light tracking-wide">
      {children}
    </p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-outside ml-5 mb-4 space-y-2 text-gray-400">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-outside ml-5 mb-4 space-y-2 text-gray-400">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="pl-1">{children}</li>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 rounded text-sm font-mono bg-white/5 text-blue-300 border border-white/5">
          {children}
        </code>
      );
    }
    return (
      <div className="relative group my-4">
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-xl opacity-50 blur-sm -z-10"></div>
        <code className="block p-4 rounded-xl text-sm font-mono overflow-x-auto bg-black/20 border border-white/10 text-gray-300 shadow-inner">
          {children}
        </code>
      </div>
    );
  },
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="relative pl-4 py-2 my-6 italic text-gray-400 border-l-2 border-blue-500/50 bg-blue-500/5 rounded-r-lg">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-6 rounded-xl border border-white/10 shadow-sm">
      <table className="min-w-full divide-y divide-white/5">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-white/5 font-medium text-gray-200">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-white/5 bg-transparent">{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="transition-colors hover:bg-white/2">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-6 py-4 text-sm text-gray-300 whitespace-nowrap">
      {children}
    </td>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      className="text-blue-400 hover:text-blue-300 underline underline-offset-2 decoration-blue-400/30 transition-all hover:decoration-blue-400"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-gray-100">
      {children}
    </strong>
  ),
  hr: () => <hr className="my-8 border-white/10" />,
};

// --- Sub-components ---

interface ScoreCardProps {
  score: number;
  label: string;
  icon: LucideIcon;
  colorClass: string; // e.g., "text-amber-500"
  gradientFrom: string; // e.g., "from-amber-500"
}

function ScoreCard({ score, label, icon: Icon, colorClass, gradientFrom }: ScoreCardProps) {
  return (
    <div className="relative group overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 transition-all hover:bg-white/[0.04] hover:shadow-md hover:border-white/10">
      {/* Subtle background gradient glow */}
      <div className={`absolute -right-4 -top-8 w-32 h-32 bg-gradient-to-br ${gradientFrom} to-transparent opacity-[0.05] blur-2xl rounded-full group-hover:opacity-[0.08] transition-opacity duration-500 pointer-events-none`} />

      <div className="relative z-10 flex items-center gap-3">
        {/* Label Section */}
        <div className="flex items-center gap-2 min-w-[100px]">
          <div className={`p-1 rounded-lg bg-white/5 border border-white/5 shadow-sm`}>
            <Icon size={12} className={colorClass} />
          </div>
          <span className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
            {label}
          </span>
        </div>

        {/* Progress Bar Section */}
        <div className="flex-1 h-1 bg-gray-900/50 rounded-full overflow-hidden border border-white/5">
          <div
            className={`h-full bg-gradient-to-r ${gradientFrom} to-white rounded-full shadow-[0_0_8px_currentColor] transition-all duration-1000 ease-out`}
            style={{ width: `${score * 10}%` }}
          />
        </div>

        {/* Score Section */}
        <div className="flex items-baseline justify-end gap-0.5 min-w-[2.5rem]">
          <span className={`text-base font-black ${colorClass} drop-shadow-sm`}>
            {score}
          </span>
          <span className="text-[10px] font-medium text-gray-600">
            /10
          </span>
        </div>
      </div>
    </div>
  );
}

// --- Export menu item ---

interface ExportMenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  description?: string;
}

function ExportMenuItem({ icon: Icon, label, onClick, description }: ExportMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-2.5 text-left hover:bg-white/5 transition-all flex items-start gap-3 group border-b border-white/5 last:border-0"
    >
      <div className="p-1.5 rounded-md bg-white/5 text-gray-400 group-hover:text-blue-400 group-hover:bg-blue-500/10 transition-colors">
        <Icon size={14} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-gray-200 group-hover:text-white font-medium transition-colors">
          {label}
        </span>
        {description && <span className="text-[10px] text-gray-500">{description}</span>}
      </div>
    </button>
  );
}

// --- Main component ---

export default function ReportView() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    loadReportForDate(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (!showExportMenu) return;

    function handleClickOutside(event: MouseEvent): void {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  async function loadReportForDate(date: string): Promise<void> {
    setLoading(true);
    try {
      const existing = await invoke<DailyReport>("get_daily_report", { date });
      setReport(existing);
    } catch {
      try {
        const generated = await invoke<DailyReport>("generate_daily_report", { date });
        setReport(generated);
      } catch (error) {
        console.error("Failed to generate report:", error);
        setReport(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleExport(action: "clipboard" | "markdown"): Promise<void> {
    if (!report) return;
    setShowExportMenu(false);

    try {
      if (action === "clipboard") {
        await writeText(report.markdown);
        showToast("success", "Report copied to clipboard");
        return;
      }

      if (action === "markdown") {
        await invoke<string>("save_report_file", {
          content: report.markdown,
          defaultFilename: `daily-report-${report.date}.md`,
          fileType: "md",
        });
        showToast("success", `Report saved to Downloads`);
        return;
      }
    } catch (error) {
      console.error("[Export] Export failed:", error);
      showToast("error", `Export failed: ${error}`);
    }
  }

  const hasScores = report && (report.work_value_score || report.workload_score);

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-transparent to-black/20">
      {/* Header with improved layout */}
      <div className="px-6 py-3 border-b border-white/5 bg-white/[0.01] backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {/* Styled Date Picker */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
                <CalendarIcon size={14} className="text-blue-400 group-hover:text-blue-300 transition-colors" />
              </div>
              <input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="pl-9 pr-8 py-1.5 text-sm bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-gray-200 font-medium cursor-pointer transition-all shadow-sm [color-scheme:dark]"
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <ChevronDown size={12} className="text-gray-600 group-hover:text-gray-500" />
              </div>
            </div>

            <div className="h-6 w-px bg-white/5 mx-1" />

            {/* Export Dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={!report}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-xl border border-transparent transition-all ${report
                  ? "text-gray-300 hover:text-white hover:bg-white/5 hover:border-white/5 active:bg-white/10"
                  : "text-gray-600 cursor-not-allowed"
                  }`}
              >
                <Download size={14} />
                <span>Export</span>
                {report && <ChevronDown size={10} className={`text-gray-500 transition-transform ${showExportMenu ? "rotate-180" : ""}`} />}
              </button>

              {showExportMenu && report && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-xl shadow-2xl overflow-hidden z-30 bg-gray-900 border border-white/10 ring-1 ring-black/50 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                  <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-600 bg-white/[0.02]">
                    Export Options
                  </div>
                  <ExportMenuItem
                    icon={Copy}
                    label="Copy Markdown"
                    description="Copy raw markdown to clipboard"
                    onClick={() => handleExport("clipboard")}
                  />
                  <ExportMenuItem
                    icon={FileType}
                    label="Save as File"
                    description="Save .md file to Downloads"
                    onClick={() => handleExport("markdown")}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {hasScores && (
          <div className="flex flex-col gap-2">
            {report.work_value_score && (
              <ScoreCard
                score={report.work_value_score}
                label="Work Value"
                icon={Star}
                colorClass="text-amber-400"
                gradientFrom="from-amber-400"
              />
            )}
            {report.workload_score && (
              <ScoreCard
                score={report.workload_score}
                label="Workload"
                icon={Briefcase}
                colorClass="text-blue-400"
                gradientFrom="from-blue-500"
              />
            )}
          </div>
        )}
      </div>

      {/* Report content area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto p-8">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_currentColor]" />
                </div>
              </div>
              <p className="text-sm font-medium text-blue-400/80 animate-pulse">Analyzing daily activity...</p>
            </div>
          ) : report ? (
            <div className="prose prose-invert prose-lg max-w-none pb-12 selection:bg-blue-500/30 selection:text-blue-200">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {report.markdown}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 gap-6 opacity-60">
              <div className="w-24 h-24 rounded-3xl bg-white/5 flex items-center justify-center border border-white/5 rotate-3">
                <FileText size={48} className="text-gray-600" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-medium text-gray-300 mb-1">No Report Found</h3>
                <p className="text-sm text-gray-500 max-w-xs mx-auto">
                  There is no report generated for {selectedDate}.
                </p>
              </div>
              <button
                onClick={() => loadReportForDate(selectedDate)}
                className="px-6 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-900/20 transition-all hover:scale-105 active:scale-95"
              >
                Generate Report
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
