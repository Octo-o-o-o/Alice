import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Inbox, ChevronDown, Check, Moon, Power, X, Clock } from "lucide-react";
import SessionCard from "../components/SessionCard";
import { Session, AutoActionState, AppConfig, AutoActionType } from "../lib/types";

interface ActiveViewProps {
  onSessionCountChange: (count: number) => void;
}

const AUTO_ACTION_OPTIONS: AutoActionType[] = ["none", "sleep", "shutdown"];
const DELAY_OPTIONS = [1, 3, 5, 10, 15, 30];

const ACTION_META: Record<string, { label: string; icon: React.ReactNode }> = {
  sleep: { label: "Sleep", icon: <Moon size={12} /> },
  shutdown: { label: "Shutdown", icon: <Power size={12} /> },
  none: { label: "None", icon: <Clock size={12} /> },
};

function getActionLabel(type: string): string {
  return ACTION_META[type]?.label ?? "None";
}

function getActionIcon(type: string): React.ReactNode {
  return ACTION_META[type]?.icon ?? <Clock size={12} />;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function CheckboxIndicator({ checked }: { checked: boolean }): React.ReactElement {
  return (
    <div
      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
        checked ? "bg-blue-500 border-blue-500" : "border-gray-400 dark:border-gray-600"
      }`}
    >
      {checked && <Check size={10} className="text-white" />}
    </div>
  );
}

function useClickOutside(refs: React.RefObject<HTMLElement | null>[], onClickOutside: () => void): void {
  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      const isOutside = refs.every(
        (ref) => !ref.current || !ref.current.contains(target)
      );
      if (isOutside) {
        onClickOutside();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [refs, onClickOutside]);
}

export default function ActiveView({ onSessionCountChange }: ActiveViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [autoActionState, setAutoActionState] = useState<AutoActionState | null>(null);
  const [autoActionEnabled, setAutoActionEnabled] = useState(false);
  const [autoActionType, setAutoActionType] = useState<AutoActionType>("none");
  const [autoActionDelay, setAutoActionDelay] = useState(5);
  const [isAutoActionDropdownOpen, setIsAutoActionDropdownOpen] = useState(false);
  const autoActionDropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside([dropdownRef, autoActionDropdownRef], () => {
    setIsDropdownOpen(false);
    setIsAutoActionDropdownOpen(false);
  });

  async function loadSessions(): Promise<void> {
    try {
      const result = await invoke<Session[]>("get_active_sessions");
      setSessions(result);
      onSessionCountChange(result.length);
    } catch (error) {
      console.error("Failed to load active sessions:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadAutoActionConfig(): Promise<void> {
    try {
      const config = await invoke<AppConfig>("get_config");
      setAutoActionEnabled(config.auto_action.enabled);
      setAutoActionType(config.auto_action.action_type);
      setAutoActionDelay(config.auto_action.delay_minutes);
    } catch (error) {
      console.error("Failed to load auto action config:", error);
    }
  }

  async function loadAutoActionState(): Promise<void> {
    try {
      const state = await invoke<AutoActionState>("get_auto_action_state");
      setAutoActionState(state);
    } catch (error) {
      console.error("Failed to load auto action state:", error);
    }
  }

  async function updateAutoActionConfig(key: string, value: boolean | string | number): Promise<void> {
    try {
      await invoke("update_config", { key: `auto_action.${key}`, value });
      await loadAutoActionConfig();
    } catch (error) {
      console.error("Failed to update auto action config:", error);
    }
  }

  async function cancelAutoAction(): Promise<void> {
    try {
      await invoke("cancel_auto_action_timer");
      setAutoActionState(null);
    } catch (error) {
      console.error("Failed to cancel auto action:", error);
    }
  }

  function selectActionType(type: AutoActionType): void {
    updateAutoActionConfig("action_type", type);
    updateAutoActionConfig("enabled", type !== "none");
    setAutoActionType(type);
    setAutoActionEnabled(type !== "none");
  }

  function selectDelay(mins: number): void {
    updateAutoActionConfig("delay_minutes", mins);
    setAutoActionDelay(mins);
  }

  useEffect(() => {
    loadSessions();
    loadAutoActionConfig();
    loadAutoActionState();

    const unlisten = listen("session-updated", () => {
      loadSessions();
    });

    const unlistenAutoAction = listen<AutoActionState>("auto-action-state", (event) => {
      setAutoActionState(event.payload);
    });

    const interval = setInterval(loadSessions, 5000);

    return () => {
      unlisten.then((fn) => fn());
      unlistenAutoAction.then((fn) => fn());
      clearInterval(interval);
    };
  }, []);

  const projectGroups = sessions.reduce<Record<string, Session[]>>((acc, session) => {
    const project = session.project_name;
    if (!acc[project]) {
      acc[project] = [];
    }
    acc[project].push(session);
    return acc;
  }, {});

  const projectList = Object.keys(projectGroups).sort();
  const isAllSelected = selectedProjects.size === 0;

  const filteredSessions = isAllSelected
    ? sessions
    : sessions.filter((s) => selectedProjects.has(s.project_name));

  function toggleProject(project: string): void {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project)) {
        next.delete(project);
      } else {
        next.add(project);
      }
      if (next.size === projectList.length) {
        return new Set();
      }
      return next;
    });
  }

  function selectAll(): void {
    setSelectedProjects(new Set());
    setIsDropdownOpen(false);
  }

  function getFilterLabel(): string {
    if (isAllSelected) return "All Projects";
    if (selectedProjects.size === 1) return Array.from(selectedProjects)[0];
    return `${selectedProjects.size} Projects`;
  }

  const isAutoActionActive = autoActionEnabled && autoActionType !== "none";

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
                <button
                  onClick={selectAll}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors border-b border-white/5"
                >
                  <CheckboxIndicator checked={isAllSelected} />
                  <span className={isAllSelected ? "text-blue-300" : "text-gray-300"}>
                    All Projects
                  </span>
                  <span className="ml-auto text-[10px] text-gray-500">
                    {sessions.length}
                  </span>
                </button>

                <div className="max-h-48 overflow-y-auto">
                  {projectList.map((project) => {
                    const isSelected = isAllSelected || selectedProjects.has(project);
                    return (
                      <button
                        key={project}
                        onClick={() => toggleProject(project)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors"
                      >
                        <CheckboxIndicator checked={isSelected} />
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
          <div className="relative" ref={autoActionDropdownRef}>
            <button
              onClick={() => setIsAutoActionDropdownOpen(!isAutoActionDropdownOpen)}
              className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg border transition-colors w-full justify-between ${
                isAutoActionActive
                  ? "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-300 hover:bg-blue-500/15"
                  : "bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8 hover:border-gray-300 dark:hover:border-white/20"
              }`}
            >
              <div className="flex items-center gap-2">
                {getActionIcon(autoActionType)}
                <span>
                  {isAutoActionActive
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
              <div className="absolute bottom-full left-0 mb-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-lg dark:shadow-xl z-50 overflow-hidden">
                <div className="p-2 space-y-1">
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider px-2 py-1">
                    After all tasks complete:
                  </div>
                  {AUTO_ACTION_OPTIONS.map((type) => {
                    const isSelected = autoActionType === type;
                    return (
                      <button
                        key={type}
                        onClick={() => selectActionType(type)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors ${
                          isSelected
                            ? "bg-blue-500/10 border border-blue-500/20"
                            : "hover:bg-gray-100 dark:hover:bg-white/5 border border-transparent"
                        }`}
                      >
                        <CheckboxIndicator checked={isSelected} />
                        <div className="shrink-0 text-gray-500 dark:text-gray-400">
                          {getActionIcon(type)}
                        </div>
                        <span className={`font-medium ${isSelected ? "text-blue-600 dark:text-blue-300" : "text-gray-700 dark:text-gray-300"}`}>
                          {getActionLabel(type)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {autoActionType !== "none" && (
                  <div className="border-t border-gray-100 dark:border-white/5 p-2 pt-3">
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wider px-2 py-1 mb-1">
                      Delay (minutes):
                    </div>
                    <div className="flex items-center gap-2 px-2">
                      {DELAY_OPTIONS.map((mins) => (
                        <button
                          key={mins}
                          onClick={() => selectDelay(mins)}
                          className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                            autoActionDelay === mins
                              ? "bg-blue-600 text-white shadow-sm"
                              : "bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 border border-transparent"
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
