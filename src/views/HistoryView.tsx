import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clock, Search, SearchX, Filter, X, ChevronDown } from "lucide-react";
import { GroupedVirtuoso } from "react-virtuoso";
import SessionCard from "../components/SessionCard";
import { Session } from "../lib/types";

interface Filters {
  project: string | null;
  status: string | null;
  model: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

export default function HistoryView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    project: null,
    status: null,
    model: null,
    dateFrom: null,
    dateTo: null,
  });

  const activeFilterCount = Object.values(filters).filter((v) => v !== null).length;

  const loadProjects = async () => {
    try {
      const result = await invoke<string[]>("get_projects", {});
      setProjects(result);
    } catch (error) {
      console.error("Failed to load projects:", error);
    }
  };

  const loadSessions = async () => {
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
  };

  const searchWithFilters = async () => {
    setSearching(true);
    try {
      const result = await invoke<Session[]>("search_sessions_filtered", {
        query: searchQuery.trim() || null,
        project: filters.project,
        status: filters.status,
        model: filters.model,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        limit: 50,
      });
      setSessions(result);
    } catch (error) {
      console.error("Failed to search sessions:", error);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    loadSessions();
    loadProjects();
  }, []);

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (searchQuery || activeFilterCount > 0) {
        searchWithFilters();
      } else {
        loadSessions();
      }
    }, 300);

    return () => clearTimeout(debounce);
  }, [searchQuery, filters]);

  const clearFilters = () => {
    setFilters({
      project: null,
      status: null,
      model: null,
      dateFrom: null,
      dateTo: null,
    });
  };

  // Group sessions by date
  const groupSessionsByDate = (sessions: Session[]) => {
    const groups: Record<string, Session[]> = {};
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();

    sessions.forEach((session) => {
      const date = new Date(session.last_active_at);
      let label: string;

      if (date.toDateString() === today) {
        label = "Today";
      } else if (date.toDateString() === yesterday) {
        label = "Yesterday";
      } else {
        const daysAgo = Math.floor(
          (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)
        );
        if (daysAgo < 7) {
          label = "This Week";
        } else {
          label = date.toLocaleDateString(undefined, {
            month: "short",
            year: "numeric",
          });
        }
      }

      if (!groups[label]) {
        groups[label] = [];
      }
      groups[label].push(session);
    });

    return groups;
  };

  // Memoize grouped sessions and prepare data for virtuoso
  const { groupCounts, groupLabels, flatSessions } = useMemo(() => {
    const groups = groupSessionsByDate(sessions);
    const labels = Object.keys(groups);
    const counts = labels.map((label) => groups[label].length);
    const flat = labels.flatMap((label) => groups[label]);
    return { groupCounts: counts, groupLabels: labels, flatSessions: flat };
  }, [sessions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search and Filter Header */}
      <div className="p-3 border-b border-white/5 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
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
                  onClick={clearFilters}
                  className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1"
                >
                  <X size={10} />
                  Clear all
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Project Filter */}
              <div className="relative">
                <label className="text-[10px] text-gray-500 mb-1 block">Project</label>
                <select
                  value={filters.project || ""}
                  onChange={(e) =>
                    setFilters({ ...filters, project: e.target.value || null })
                  }
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                >
                  <option value="">All projects</option>
                  {projects.map((p) => (
                    <option key={p} value={p}>
                      {p.split(/[/\\]/).pop()}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-7 text-gray-500 pointer-events-none" />
              </div>

              {/* Status Filter */}
              <div className="relative">
                <label className="text-[10px] text-gray-500 mb-1 block">Status</label>
                <select
                  value={filters.status || ""}
                  onChange={(e) =>
                    setFilters({ ...filters, status: e.target.value || null })
                  }
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                >
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="error">Error</option>
                  <option value="needs_input">Needs Input</option>
                </select>
                <ChevronDown size={12} className="absolute right-2 top-7 text-gray-500 pointer-events-none" />
              </div>

              {/* Model Filter */}
              <div className="relative">
                <label className="text-[10px] text-gray-500 mb-1 block">Model</label>
                <select
                  value={filters.model || ""}
                  onChange={(e) =>
                    setFilters({ ...filters, model: e.target.value || null })
                  }
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                >
                  <option value="">All models</option>
                  <option value="opus">Opus</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku</option>
                </select>
                <ChevronDown size={12} className="absolute right-2 top-7 text-gray-500 pointer-events-none" />
              </div>

              {/* Date From */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">From Date</label>
                <input
                  type="date"
                  value={filters.dateFrom || ""}
                  onChange={(e) =>
                    setFilters({ ...filters, dateFrom: e.target.value || null })
                  }
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                />
              </div>

              {/* Date To */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">To Date</label>
                <input
                  type="date"
                  value={filters.dateTo || ""}
                  onChange={(e) =>
                    setFilters({ ...filters, dateTo: e.target.value || null })
                  }
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {searching && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!searching && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            {searchQuery || activeFilterCount > 0 ? (
              <>
                <SearchX size={32} className="opacity-50" />
                <p className="text-sm">No matching sessions</p>
                <p className="text-xs text-gray-600">
                  Try different search terms or adjust filters
                </p>
              </>
            ) : (
              <>
                <Clock size={32} className="opacity-50" />
                <p className="text-sm">No sessions found</p>
                <p className="text-xs text-gray-600">
                  Your Claude Code history will appear here
                </p>
              </>
            )}
          </div>
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
            itemContent={(index) => (
              <div className="px-3 py-1">
                <SessionCard
                  key={flatSessions[index].session_id}
                  session={flatSessions[index]}
                  compact
                  onDelete={(sessionId) => {
                    setSessions((prev) =>
                      prev.filter((s) => s.session_id !== sessionId)
                    );
                  }}
                />
              </div>
            )}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}
