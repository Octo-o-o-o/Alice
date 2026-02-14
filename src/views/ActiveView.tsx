import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Inbox, ChevronDown, Check, Moon, Power, X, Clock } from "lucide-react";
import SessionCard from "../components/SessionCard";
import { Session, AutoActionState, AppConfig, AutoActionType } from "../lib/types";

interface ActiveViewProps {
  onSessionCountChange: (count: number) => void;
}

export default function ActiveView({ onSessionCountChange }: ActiveViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set()); // empty = all selected
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto action state
  const [autoActionState, setAutoActionState] = useState<AutoActionState | null>(null);
  const [autoActionEnabled, setAutoActionEnabled] = useState(false);
  const [autoActionType, setAutoActionType] = useState<AutoActionType>("none");
  const [autoActionDelay, setAutoActionDelay] = useState(5);
  const [isAutoActionDropdownOpen, setIsAutoActionDropdownOpen] = useState(false);
  const autoActionDropdownRef = useRef<HTMLDivElement>(null);

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

  // Load auto action config
  const loadAutoActionConfig = async () => {
    try {
      const config = await invoke<AppConfig>("get_config");
      setAutoActionEnabled(config.auto_action.enabled);
      setAutoActionType(config.auto_action.action_type);
      setAutoActionDelay(config.auto_action.delay_minutes);
    } catch (error) {
      console.error("Failed to load auto action config:", error);
    }
  };

  // Load auto action state
  const loadAutoActionState = async () => {
    try {
      const state = await invoke<AutoActionState>("get_auto_action_state");
      setAutoActionState(state);
    } catch (error) {
      console.error("Failed to load auto action state:", error);
    }
  };

  // Update auto action config
  const updateAutoActionConfig = async (key: string, value: boolean | string | number) => {
    try {
      await invoke("update_config", { key: `auto_action.${key}`, value });
      await loadAutoActionConfig();
    } catch (error) {
      console.error("Failed to update auto action config:", error);
    }
  };

  // Cancel auto action timer
  const cancelAutoAction = async () => {
    try {
      await invoke("cancel_auto_action_timer");
      setAutoActionState(null);
    } catch (error) {
      console.error("Failed to cancel auto action:", error);
    }
  };

  useEffect(() => {
    loadSessions();
    loadAutoActionConfig();
    loadAutoActionState();

    // Listen for session updates
    const unlisten = listen("session-updated", () => {
      loadSessions();
    });

    // Listen for auto action state updates
    const unlistenAutoAction = listen<AutoActionState>("auto-action-state", (event) => {
      setAutoActionState(event.payload);
    });

    // Poll every 5 seconds for active sessions
    const interval = setInterval(loadSessions, 5000);

    return () => {
      unlisten.then((fn) => fn());
      unlistenAutoAction.then((fn) => fn());
      clearInterval(interval);
    };
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (autoActionDropdownRef.current && !autoActionDropdownRef.current.contains(event.target as Node)) {
        setIsAutoActionDropdownOpen(false);
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

  // Format remaining time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Get action label
  const getActionLabel = (type: AutoActionType | string) => {
    switch (type) {
      case "sleep": return "Sleep";
      case "shutdown": return "Shutdown";
      default: return "None";
    }
  };

  // Get action icon
  const getActionIcon = (type: AutoActionType | string) => {
    switch (type) {
      case "sleep": return <Moon size={12} />;
      case "shutdown": return <Power size={12} />;
      default: return <Clock size={12} />;
    }
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

      {/* Auto Action Panel */}
      <div className="px-3 py-2 border-t border-white/5 shrink-0">
        {/* Timer active - show countdown */}
        {autoActionState?.timer_active ? (
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center gap-2">
              {getActionIcon(autoActionState.action_type)}
              <span className="text-xs text-amber-300">
                {getActionLabel(autoActionState.action_type)} in {formatTime(autoActionState.remaining_seconds)}
              </span>
            </div>
            <button
              onClick={cancelAutoAction}
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          /* Timer inactive - show config */
          <div className="relative" ref={autoActionDropdownRef}>
            <button
              onClick={() => setIsAutoActionDropdownOpen(!isAutoActionDropdownOpen)}
              className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full justify-between ${
                autoActionEnabled && autoActionType !== "none"
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/15"
                  : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/8 hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-2">
                {getActionIcon(autoActionType)}
                <span>
                  {autoActionEnabled && autoActionType !== "none"
                    ? `${getActionLabel(autoActionType)} after ${autoActionDelay}m`
                    : "Auto action off"}
                </span>
              </div>
              <ChevronDown
                size={12}
                className={`transition-transform ${isAutoActionDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {isAutoActionDropdownOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-full bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
                {/* Action type options */}
                <div className="p-2 space-y-1">
                  <div className="text-[10px] text-gray-500 px-2 py-1">After all tasks complete:</div>
                  {(["none", "sleep", "shutdown"] as AutoActionType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        updateAutoActionConfig("action_type", type);
                        updateAutoActionConfig("enabled", type !== "none");
                        setAutoActionType(type);
                        setAutoActionEnabled(type !== "none");
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-white/5 rounded transition-colors"
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                        autoActionType === type
                          ? "bg-blue-500 border-blue-500"
                          : "border-gray-600"
                      }`}>
                        {autoActionType === type && <Check size={10} className="text-white" />}
                      </div>
                      {getActionIcon(type)}
                      <span className={autoActionType === type ? "text-blue-300" : "text-gray-300"}>
                        {getActionLabel(type)}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Delay input */}
                {autoActionType !== "none" && (
                  <div className="border-t border-white/5 p-2">
                    <div className="text-[10px] text-gray-500 px-2 py-1">Delay (minutes):</div>
                    <div className="flex items-center gap-2 px-2">
                      {[1, 3, 5, 10, 15, 30].map((mins) => (
                        <button
                          key={mins}
                          onClick={() => {
                            updateAutoActionConfig("delay_minutes", mins);
                            setAutoActionDelay(mins);
                          }}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            autoActionDelay === mins
                              ? "bg-blue-500 text-white"
                              : "bg-white/5 text-gray-400 hover:bg-white/10"
                          }`}
                        >
                          {mins}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
