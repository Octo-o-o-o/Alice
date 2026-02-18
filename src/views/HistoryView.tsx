import { useEffect, useState, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clock, Search, SearchX, Filter, X, ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { GroupedVirtuoso } from "react-virtuoso";
import SessionCard from "../components/SessionCard";
import type { Session } from "../lib/types";
import { getModKey } from "../lib/platform";
import { getProviderColor } from "../lib/provider-colors";

// --- Types ---

interface Filters {
  project: string | null;
  status: string | null;
  model: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface HistoryViewRef {
  focusSearch: () => void;
}

// --- Constants ---

const EMPTY_FILTERS: Filters = {
  project: null,
  status: null,
  model: null,
  dateFrom: null,
  dateTo: null,
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "error", label: "Error" },
  { value: "needs_input", label: "Needs Input" },
];

const MODEL_OPTIONS = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// --- Helpers ---

function getDateGroupLabel(date: Date, now: Date): string {
  const dateStr = date.toDateString();

  if (dateStr === now.toDateString()) return "Today";
  if (dateStr === new Date(now.getTime() - MS_PER_DAY).toDateString()) return "Yesterday";

  const daysAgo = Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
  if (daysAgo < 7) return "This Week";

  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function groupSessionsByDate(sessions: Session[]): Record<string, Session[]> {
  const now = new Date();
  const groups: Record<string, Session[]> = {};

  for (const session of sessions) {
    const label = getDateGroupLabel(new Date(session.last_human_message_at), now);
    (groups[label] ??= []).push(session);
  }

  return groups;
}

// --- Reusable filter components ---

interface FilterSelectProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}

function FilterSelect({ label, value, onChange, placeholder, options }: FilterSelectProps): React.ReactElement {
  return (
    <div className="relative">
      <label className="text-[10px] text-gray-500 mb-1 block">{label}</label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-7 text-gray-500 pointer-events-none" />
    </div>
  );
}

interface FilterDateProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}

function FilterDate({ label, value, onChange }: FilterDateProps): React.ReactElement {
  return (
    <div>
      <label className="text-[10px] text-gray-500 mb-1 block">{label}</label>
      <input
        type="date"
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
      />
    </div>
  );
}

// --- Shared UI helpers ---

function Spinner({ className = "w-5 h-5" }: { className?: string }): React.ReactElement {
  return (
    <div className={`${className} border-2 border-blue-500 border-t-transparent rounded-full animate-spin`} />
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}

function EmptyState({ icon: Icon, title, subtitle }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
      <Icon size={32} className="opacity-50" />
      <p className="text-sm">{title}</p>
      <p className="text-xs text-gray-600">{subtitle}</p>
    </div>
  );
}

// --- Main component ---

const HistoryView = forwardRef<HistoryViewRef>(function HistoryView(_, ref) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
  }));

  const activeFilterCount = Object.values(filters).filter((v) => v !== null).length;
  const hasActiveSearch = searchQuery.length > 0 || activeFilterCount > 0;

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function loadProjects(): Promise<void> {
    try {
      const result = await invoke<string[]>("get_projects");
      setProjects(result);
    } catch (error) {
      console.error("Failed to load projects:", error);
    }
  }

  async function loadSessions(): Promise<void> {
    try {
      const result = await invoke<Session[]>("get_sessions", {
        project: null,
        limit: 50,
      });
      setSessions(result);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    } finally {
      setLoading(false);
    }
  }

  async function searchWithFilters(): Promise<void> {
    setSearching(true);
    try {
      const result = await invoke<Session[]>("search_sessions_filtered", {
        query: searchQuery.trim() || null,
        ...filters,
        limit: 50,
      });
      setSessions(result);
    } catch (error) {
      console.error("Failed to search sessions:", error);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    loadSessions();
    loadProjects();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (hasActiveSearch) {
        searchWithFilters();
      } else {
        loadSessions();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, filters]);

  const { groupCounts, groupLabels, flatSessions } = useMemo(() => {
    const groups = groupSessionsByDate(sessions);
    const labels = Object.keys(groups);
    const counts = labels.map((label) => groups[label].length);
    const flat = labels.flatMap((label) => groups[label]);
    return { groupCounts: counts, groupLabels: labels, flatSessions: flat };
  }, [sessions]);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p, label: p.split(/[/\\]/).pop() || p })),
    [projects],
  );

  function handleDeleteSession(sessionId: string): void {
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search and Filter Header */}
      <div className="p-3 border-b border-white/5 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 group">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search: A B, A|B, -A, "A|B" (${getModKey()}K)`}
              title='space=AND, |=OR, -=NOT, "..."=literal'
              className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-9 pr-3 text-sm text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:bg-white/8 focus:outline-none"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
              showFilters || activeFilterCount > 0
                ? "bg-blue-500/20 border-blue-500/30 text-blue-300"
                : "bg-white/5 border-white/10 text-gray-400 hover:text-gray-200"
            }`}
          >
            <Filter size={14} />
            {activeFilterCount > 0 && (
              <span className="text-[10px] bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-medium">Filters</span>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1"
                >
                  <X size={10} />
                  Clear all
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <FilterSelect
                label="Project"
                value={filters.project}
                onChange={(v) => updateFilter("project", v)}
                placeholder="All projects"
                options={projectOptions}
              />
              <FilterSelect
                label="Status"
                value={filters.status}
                onChange={(v) => updateFilter("status", v)}
                placeholder="All statuses"
                options={STATUS_OPTIONS}
              />
              <FilterSelect
                label="Model"
                value={filters.model}
                onChange={(v) => updateFilter("model", v)}
                placeholder="All models"
                options={MODEL_OPTIONS}
              />
              <FilterDate
                label="From Date"
                value={filters.dateFrom}
                onChange={(v) => updateFilter("dateFrom", v)}
              />
              <FilterDate
                label="To Date"
                value={filters.dateTo}
                onChange={(v) => updateFilter("dateTo", v)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {searching && (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        )}

        {!searching && sessions.length === 0 && (
          hasActiveSearch ? (
            <EmptyState
              icon={SearchX}
              title="No matching sessions"
              subtitle="Try different search terms or adjust filters"
            />
          ) : (
            <EmptyState
              icon={Clock}
              title="No sessions found"
              subtitle="Your Claude Code history will appear here"
            />
          )
        )}

        {!searching && sessions.length > 0 && (
          <GroupedVirtuoso
            groupCounts={groupCounts}
            groupContent={(index) => (
              <div className="px-3 pt-3 pb-1 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {groupLabels[index]}
                </h3>
              </div>
            )}
            itemContent={(index) => {
              const session = flatSessions[index];
              return (
                <div className="px-3 py-1">
                  <div className="flex gap-2">
                    <div
                      className="w-1 rounded-full shrink-0"
                      style={{ backgroundColor: getProviderColor(session.provider).primary }}
                    />
                    <div className="flex-1 min-w-0">
                      <SessionCard
                        key={session.session_id}
                        session={session}
                        compact
                        onDelete={handleDeleteSession}
                      />
                    </div>
                  </div>
                </div>
              );
            }}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
});

export default HistoryView;
