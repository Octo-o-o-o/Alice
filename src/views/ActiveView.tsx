import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Inbox, ChevronDown, Check } from "lucide-react";
import SessionCard from "../components/SessionCard";
import { Session } from "../lib/types";

interface ActiveViewProps {
  onSessionCountChange: (count: number) => void;
}

export default function ActiveView({ onSessionCountChange }: ActiveViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set()); // empty = all selected
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadSessions = async () => {
    try {
      const result = await invoke<Session[]>("get_active_sessions");
      setSessions(result);
      onSessionCountChange(result.length);
    } catch (error) {
      console.error("Failed to load active sessions:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();

    // Listen for session updates
    const unlisten = listen("session-updated", () => {
      loadSessions();
    });

    // Poll every 5 seconds for active sessions
    const interval = setInterval(loadSessions, 5000);

    return () => {
      unlisten.then((fn) => fn());
      clearInterval(interval);
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Group sessions by project
  const projectGroups = sessions.reduce((acc, session) => {
    const project = session.project_name;
    if (!acc[project]) {
      acc[project] = [];
    }
    acc[project].push(session);
    return acc;
  }, {} as Record<string, Session[]>);

  const projectList = Object.keys(projectGroups).sort();
  const isAllSelected = selectedProjects.size === 0;

  const filteredSessions = isAllSelected
    ? sessions
    : sessions.filter((s) => selectedProjects.has(s.project_name));

  const toggleProject = (project: string) => {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) {
        next.delete(project);
      } else {
        next.add(project);
      }
      // If all projects are selected, reset to "All" state
      if (next.size === projectList.length) {
        return new Set();
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedProjects(new Set());
    setIsDropdownOpen(false);
  };

  const getFilterLabel = () => {
    if (isAllSelected) return "All Projects";
    if (selectedProjects.size === 1) {
      const project = Array.from(selectedProjects)[0];
      return project;
    }
    return `${selectedProjects.size} Projects`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
        <Inbox size={32} className="opacity-50" />
        <p className="text-sm">No active sessions</p>
        <p className="text-xs text-gray-600">
          Start a Claude Code session in any terminal
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Project filter dropdown */}
      {projectList.length > 1 && (
        <div className="px-3 py-2 border-b border-white/5 shrink-0">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 hover:bg-white/8 hover:border-white/20 transition-colors text-gray-300"
            >
              <FolderOpen size={12} className="text-gray-400" />
              <span>{getFilterLabel()}</span>
              <ChevronDown
                size={12}
                className={`text-gray-400 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
                {/* All Projects option */}
                <button
                  onClick={selectAll}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors border-b border-white/5"
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                    isAllSelected
                      ? "bg-blue-500 border-blue-500"
                      : "border-gray-600"
                  }`}>
                    {isAllSelected && <Check size={10} className="text-white" />}
                  </div>
                  <span className={isAllSelected ? "text-blue-300" : "text-gray-300"}>
                    All Projects
                  </span>
                  <span className="ml-auto text-[10px] text-gray-500">
                    {sessions.length}
                  </span>
                </button>

                {/* Project list */}
                <div className="max-h-48 overflow-y-auto">
                  {projectList.map((project) => {
                    const isSelected = isAllSelected || selectedProjects.has(project);
                    return (
                      <button
                        key={project}
                        onClick={() => toggleProject(project)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors"
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                          isSelected
                            ? "bg-blue-500 border-blue-500"
                            : "border-gray-600"
                        }`}>
                          {isSelected && <Check size={10} className="text-white" />}
                        </div>
                        <FolderOpen size={10} className="text-gray-400" />
                        <span className={isSelected ? "text-gray-200" : "text-gray-400"}>
                          {project}
                        </span>
                        <span className="ml-auto text-[10px] text-gray-500">
                          {projectGroups[project].length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredSessions.map((session) => (
          <SessionCard key={session.session_id} session={session} />
        ))}
      </div>
    </div>
  );
}
