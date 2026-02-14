import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Plus,
  ListTodo,
  Play,
  Pause,
  Trash2,
  GripVertical,
  Square,
  ChevronRight,
  CheckSquare,
  Square as SquareEmpty,
  FolderOpen,
  X,
  Terminal,
  Inbox,
  ChevronDown,
  Check,
  Moon,
  Power,
  Clock,
} from "lucide-react";
import { Task, QueueStatusEvent, QueueStartResult, TerminalOption, Session, AutoActionState, AppConfig, AutoActionType } from "../lib/types";
import SessionCard from "../components/SessionCard";
import { useToast } from "../contexts/ToastContext";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type SubTab = "active" | "queue" | "backlog";

interface TaskViewProps {
  onTaskCountChange: (count: number) => void;
  onActiveSessionCountChange: (count: number) => void;
}

export default function TaskView({ onTaskCountChange, onActiveSessionCountChange }: TaskViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("active");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [queueRunning, setQueueRunning] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [showTerminalPicker, setShowTerminalPicker] = useState(false);
  const [terminalOptions, setTerminalOptions] = useState<TerminalOption[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState<string>("system");
  const [rememberChoice, setRememberChoice] = useState(true);
  // Project filter for active sessions
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Auto action state
  const [autoActionState, setAutoActionState] = useState<AutoActionState | null>(null);
  const [autoActionEnabled, setAutoActionEnabled] = useState(false);
  const [autoActionType, setAutoActionType] = useState<AutoActionType>("none");
  const [autoActionDelay, setAutoActionDelay] = useState(5);
  const [isAutoActionDropdownOpen, setIsAutoActionDropdownOpen] = useState(false);
  const autoActionDropdownRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadTasks = async () => {
    try {
      const result = await invoke<Task[]>("get_tasks", {});
      setTasks(result);
      onTaskCountChange(result.filter((t) => t.status !== "completed" && t.status !== "failed").length);
    } catch (error) {
      console.error("Failed to load tasks:", error);
    }
  };

  const loadSessions = async () => {
    try {
      const result = await invoke<Session[]>("get_active_sessions");
      setSessions(result);
      onActiveSessionCountChange(result.length);
    } catch (error) {
      console.error("Failed to load active sessions:", error);
    }
  };

  const loadProjects = async () => {
    try {
      const result = await invoke<string[]>("get_projects", {});
      setProjects(result);
    } catch (error) {
      console.error("Failed to load projects:", error);
    }
  };

  const loadTerminalOptions = async () => {
    try {
      const result = await invoke<TerminalOption[]>("get_available_terminals", {});
      setTerminalOptions(result);
      if (result.length > 1) {
        setSelectedTerminal(result[1].value);
      }
    } catch (error) {
      console.error("Failed to load terminal options:", error);
    }
  };

  const loadQueueStatus = async () => {
    try {
      const running = await invoke<boolean>("get_queue_status", {});
      setQueueRunning(running);
    } catch (error) {
      console.error("Failed to get queue status:", error);
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
      // Reset settings after cancel (one-time use)
      await invoke("update_config", { key: "auto_action.enabled", value: false });
      await invoke("update_config", { key: "auto_action.action_type", value: "none" });
      setAutoActionState(null);
      setAutoActionEnabled(false);
      setAutoActionType("none");
      toast.info("Auto action cancelled");
    } catch (error) {
      console.error("Failed to cancel auto action:", error);
    }
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

  useEffect(() => {
    const loadAll = async () => {
      await Promise.all([loadTasks(), loadSessions(), loadProjects(), loadQueueStatus(), loadAutoActionConfig(), loadAutoActionState()]);
      setLoading(false);
    };
    loadAll();

    // Listen for queue status updates
    const unlistenQueue = listen<QueueStatusEvent>("queue-status", (event) => {
      setQueueRunning(event.payload.is_running);
      setCurrentTaskId(event.payload.current_task_id);
      loadTasks();
    });

    // Listen for session updates
    const unlistenSession = listen("session-updated", () => {
      loadSessions();
    });

    // Listen for auto action state updates
    const unlistenAutoAction = listen<AutoActionState>("auto-action-state", (event) => {
      setAutoActionState(event.payload);
      // If timer finished (not active and was active before), reset settings
      if (!event.payload.timer_active) {
        loadAutoActionConfig(); // Reload config as it may have been reset by backend
      }
    });

    // Poll every 5 seconds for active sessions
    const interval = setInterval(loadSessions, 5000);

    return () => {
      unlistenQueue.then(fn => fn());
      unlistenSession.then(fn => fn());
      unlistenAutoAction.then(fn => fn());
      clearInterval(interval);
    };
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (projectPickerRef.current && !projectPickerRef.current.contains(event.target as Node)) {
        setShowProjectPicker(false);
      }
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

  const createTask = async () => {
    if (!newTaskPrompt.trim()) return;

    try {
      await invoke("create_task", {
        prompt: newTaskPrompt.trim(),
        project: selectedProject,
        priority: "medium",
        notes: null,
      });
      setNewTaskPrompt("");
      setSelectedProject(null);
      loadTasks();
      toast.success("Task created");
    } catch (error) {
      console.error("Failed to create task:", error);
      toast.error("Failed to create task");
    }
  };

  const updateTaskStatus = async (id: string, status: string) => {
    try {
      await invoke("update_task", {
        id,
        status,
        prompt: null,
        priority: null,
        sortOrder: null,
      });
      loadTasks();
    } catch (error) {
      console.error("Failed to update task:", error);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      await invoke("delete_task", { id });
      loadTasks();
      toast.info("Task deleted");
    } catch (error) {
      console.error("Failed to delete task:", error);
      toast.error("Failed to delete task");
    }
  };

  const startQueue = async () => {
    try {
      const result = await invoke<QueueStartResult>("start_queue", {});

      if (result.needs_terminal_choice) {
        await loadTerminalOptions();
        setShowTerminalPicker(true);
        return;
      }

      if (result.started) {
        setQueueRunning(true);
        toast.success("Queue started");
      }
    } catch (error) {
      console.error("Failed to start queue:", error);
      toast.error("Failed to start queue");
    }
  };

  const confirmTerminalChoice = async () => {
    try {
      await invoke("update_config", { key: "terminal_app", value: selectedTerminal });

      if (rememberChoice) {
        await invoke("update_config", { key: "terminal_choice_made", value: true });
      }

      setShowTerminalPicker(false);

      const result = await invoke<QueueStartResult>("start_queue", {});
      if (result.started) {
        setQueueRunning(true);
        toast.success("Queue started");
      }
    } catch (error) {
      console.error("Failed to save terminal choice:", error);
      toast.error("Failed to start queue");
    }
  };

  const stopQueue = async () => {
    try {
      await invoke("stop_queue", {});
      setQueueRunning(false);
      toast.info("Queue stopped");
    } catch (error) {
      console.error("Failed to stop queue:", error);
      toast.error("Failed to stop queue");
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    setOverId(over?.id as string | null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);

    if (!over) return;

    const activeTaskId = active.id as string;
    const overTaskId = over.id as string;

    const activeTask = tasks.find(t => t.id === activeTaskId);
    if (!activeTask) return;

    const fromBacklog = activeTask.status === "backlog";
    const fromQueue = activeTask.status === "queued" || activeTask.status === "running";

    const isOverBacklogDropzone = overTaskId === "backlog-dropzone";
    const isOverQueueDropzone = overTaskId === "queue-dropzone";
    const overTask = tasks.find(t => t.id === overTaskId);
    const toBacklog = isOverBacklogDropzone || (overTask && overTask.status === "backlog");
    const toQueue = isOverQueueDropzone || (overTask && (overTask.status === "queued" || overTask.status === "running"));

    if (fromBacklog && toQueue) {
      try {
        await invoke("update_task", {
          id: activeTaskId,
          status: "queued",
          prompt: null,
          priority: null,
          sortOrder: null,
        });
        loadTasks();
        toast.success("Task moved to queue");
      } catch (error) {
        console.error("Failed to move task to queue:", error);
        toast.error("Failed to move task");
      }
      return;
    }

    if (fromQueue && toBacklog && activeTask.status !== "running") {
      try {
        await invoke("update_task", {
          id: activeTaskId,
          status: "backlog",
          prompt: null,
          priority: null,
          sortOrder: null,
        });
        loadTasks();
        toast.success("Task moved to backlog");
      } catch (error) {
        console.error("Failed to move task to backlog:", error);
        toast.error("Failed to move task");
      }
      return;
    }

    if (activeTaskId !== overTaskId && overTask) {
      const sameSection = (fromBacklog && toBacklog) || (fromQueue && toQueue);
      if (sameSection) {
        const taskList = fromBacklog ? backlogTasks : queuedTasks;
        const oldIndex = taskList.findIndex((t) => t.id === activeTaskId);
        const newIndex = taskList.findIndex((t) => t.id === overTaskId);

        if (oldIndex !== -1 && newIndex !== -1) {
          const reordered = arrayMove(taskList, oldIndex, newIndex);

          if (fromBacklog) {
            setTasks((prev) => {
              const others = prev.filter((t) => t.status !== "backlog");
              return [...reordered, ...others];
            });
          } else {
            setTasks((prev) => {
              const others = prev.filter((t) => t.status !== "queued" && t.status !== "running");
              return [...others, ...reordered];
            });
          }

          try {
            await invoke("reorder_tasks", {
              taskIds: reordered.map((t) => t.id),
            });
          } catch (error) {
            console.error("Failed to reorder tasks:", error);
            toast.error("Failed to save order");
            loadTasks();
          }
        }
      }
    }
  };

  const backlogTasks = tasks.filter((t) => t.status === "backlog");
  const queuedTasks = tasks.filter((t) => t.status === "queued" || t.status === "running");
  const completedTasks = tasks.filter((t) => t.status === "completed" || t.status === "failed");

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

  // Multi-select handlers for backlog
  const toggleTaskSelection = useCallback((taskId: string, shiftKey: boolean) => {
    setSelectedTasks((prev) => {
      const newSet = new Set(prev);

      if (shiftKey && lastSelectedId) {
        const taskIds = backlogTasks.map((t) => t.id);
        const lastIndex = taskIds.indexOf(lastSelectedId);
        const currentIndex = taskIds.indexOf(taskId);

        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          for (let i = start; i <= end; i++) {
            newSet.add(taskIds[i]);
          }
        }
      } else {
        if (newSet.has(taskId)) {
          newSet.delete(taskId);
        } else {
          newSet.add(taskId);
        }
      }

      return newSet;
    });
    setLastSelectedId(taskId);
  }, [lastSelectedId, backlogTasks]);

  const selectAllBacklog = () => {
    setSelectedTasks(new Set(backlogTasks.map((t) => t.id)));
  };

  const clearSelection = () => {
    setSelectedTasks(new Set());
    setLastSelectedId(null);
  };

  const queueSelected = async () => {
    const tasksToQueue = Array.from(selectedTasks);
    if (tasksToQueue.length === 0) return;

    try {
      for (const taskId of tasksToQueue) {
        await invoke("update_task", {
          id: taskId,
          status: "queued",
          prompt: null,
          priority: null,
          sortOrder: null,
        });
      }
      loadTasks();
      clearSelection();
      toast.success(`${tasksToQueue.length} task${tasksToQueue.length > 1 ? "s" : ""} queued`);
    } catch (error) {
      console.error("Failed to queue tasks:", error);
      toast.error("Failed to queue tasks");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Terminal Selection Modal */}
      {showTerminalPicker && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-5 w-80 shadow-2xl">
            <div className="flex items-center gap-2 mb-4">
              <Terminal size={20} className="text-blue-400" />
              <h3 className="text-base font-semibold text-gray-200">Choose Terminal</h3>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Select where to run Claude Code tasks. You can watch the execution in a visible terminal.
            </p>

            <div className="space-y-2 mb-4">
              {terminalOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setSelectedTerminal(option.value)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedTerminal === option.value
                      ? "bg-blue-600 text-white"
                      : "bg-white/5 text-gray-300 hover:bg-white/10"
                  }`}
                >
                  {option.label}
                  {option.value === "background" && (
                    <span className="block text-xs opacity-60 mt-0.5">Hidden execution</span>
                  )}
                  {option.value !== "background" && option.value !== "custom" && (
                    <span className="block text-xs opacity-60 mt-0.5">Watch Claude work</span>
                  )}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberChoice}
                onChange={(e) => setRememberChoice(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/50"
              />
              <span className="text-xs text-gray-400">Remember my choice</span>
            </label>

            <div className="flex gap-2">
              <button
                onClick={() => setShowTerminalPicker(false)}
                className="flex-1 px-3 py-2 text-sm bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmTerminalChoice}
                className="flex-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                Start Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5 shrink-0">
        <button
          onClick={() => setActiveSubTab("active")}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === "active"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
          }`}
        >
          Active
          {sessions.length > 0 && (
            <span className="ml-1.5 bg-white/20 px-1.5 py-0.5 rounded text-[10px]">
              {sessions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("queue")}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === "queue"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
          }`}
        >
          Queue
          {queuedTasks.length > 0 && (
            <span className="ml-1.5 bg-white/20 px-1.5 py-0.5 rounded text-[10px]">
              {queuedTasks.length}
            </span>
          )}
          {queueRunning && (
            <span className="ml-1 w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse inline-block" />
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("backlog")}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeSubTab === "backlog"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
          }`}
        >
          Backlog
          {backlogTasks.length > 0 && (
            <span className="ml-1.5 bg-white/20 px-1.5 py-0.5 rounded text-[10px]">
              {backlogTasks.length}
            </span>
          )}
        </button>
      </div>

      {/* Active tab content */}
      {activeSubTab === "active" && (
        <div className="flex-1 flex flex-col overflow-hidden">
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
          {sessions.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
              <Inbox size={32} className="opacity-50" />
              <p className="text-sm">No active sessions</p>
              <p className="text-xs text-gray-600">
                Start a Claude Code session in any terminal
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredSessions.map((session) => (
                <SessionCard key={session.session_id} session={session} />
              ))}
            </div>
          )}

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
      )}

      {/* Queue tab content */}
      {activeSubTab === "queue" && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                Queue ({queuedTasks.length})
                {queueRunning && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-blue-400 bg-blue-500/20 px-1.5 py-0.5 rounded">
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                    Running
                  </span>
                )}
              </h3>
              {queuedTasks.length > 0 && (
                <div className="flex items-center gap-1">
                  {queueRunning ? (
                    <button
                      onClick={stopQueue}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                      title="Stop queue"
                    >
                      <Square size={12} />
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={startQueue}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded transition-colors"
                      title="Start queue"
                    >
                      <Play size={12} />
                      Start
                    </button>
                  )}
                </div>
              )}
            </div>

            <DroppableSection id="queue-dropzone" isOver={overId === "queue-dropzone"}>
              {queuedTasks.length === 0 ? (
                <div className="text-center py-8 text-gray-600 text-xs">
                  {activeId && backlogTasks.find(t => t.id === activeId) ? (
                    <p className="text-blue-400">Drop here to add to queue</p>
                  ) : (
                    <>
                      <ListTodo size={24} className="mx-auto mb-2 opacity-50" />
                      <p>No tasks in queue</p>
                      <p className="mt-1 text-gray-500">Add tasks from Backlog tab</p>
                    </>
                  )}
                </div>
              ) : (
                <SortableContext items={queuedTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {queuedTasks.map((task, index) => (
                      <SortableQueueItem
                        key={task.id}
                        task={task}
                        isFirst={index === 0}
                        isLast={index === queuedTasks.length - 1}
                        isCurrent={task.id === currentTaskId}
                        onRemove={() => updateTaskStatus(task.id, "backlog")}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}
            </DroppableSection>

            {/* Completed section */}
            {completedTasks.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <span className="flex items-center gap-1">
                      <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                      Completed ({completedTasks.length})
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {completedTasks.slice(0, 10).map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 p-2 bg-white/[0.02] rounded-lg opacity-60"
                      >
                        <span className={`w-2 h-2 rounded-full ${
                          task.status === "completed" ? "bg-green-500" : "bg-red-500"
                        }`} />
                        <span className="text-xs text-gray-400 truncate flex-1">
                          {task.prompt}
                        </span>
                        {task.result_cost_usd && (
                          <span className="text-[10px] text-gray-500">
                            ${task.result_cost_usd.toFixed(2)}
                          </span>
                        )}
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        </DndContext>
      )}

      {/* Backlog tab content */}
      {activeSubTab === "backlog" && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Add task input */}
            <div className="p-3 border-b border-white/5 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!isComposing) {
                    createTask();
                  }
                }}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newTaskPrompt}
                    onChange={(e) => setNewTaskPrompt(e.target.value)}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => setIsComposing(false)}
                    placeholder="Add a task..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:bg-white/8 focus:outline-none"
                  />
                  <div className="relative" ref={projectPickerRef}>
                    <button
                      type="button"
                      onClick={() => setShowProjectPicker(!showProjectPicker)}
                      className={`p-2 rounded-lg transition-colors ${
                        selectedProject
                          ? "bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
                          : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300"
                      }`}
                      title={selectedProject ? `Project: ${selectedProject.split(/[/\\]/).pop()}` : "Select project (optional)"}
                    >
                      <FolderOpen size={16} />
                    </button>
                    {showProjectPicker && (
                      <div className="absolute right-0 top-full mt-1 w-64 max-h-48 overflow-y-auto bg-gray-900 border border-white/10 rounded-lg shadow-xl z-50">
                        <div className="p-1.5">
                          {projects.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-500">No projects found</div>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedProject(null);
                                  setShowProjectPicker(false);
                                }}
                                className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
                                  !selectedProject
                                    ? "bg-blue-600/20 text-blue-400"
                                    : "text-gray-400 hover:bg-white/5"
                                }`}
                              >
                                No project (auto-detect)
                              </button>
                              {projects.map((project) => (
                                <button
                                  key={project}
                                  type="button"
                                  onClick={() => {
                                    setSelectedProject(project);
                                    setShowProjectPicker(false);
                                  }}
                                  className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
                                    selectedProject === project
                                      ? "bg-blue-600/20 text-blue-400"
                                      : "text-gray-300 hover:bg-white/5"
                                  }`}
                                  title={project}
                                >
                                  {project.split(/[/\\]/).pop()}
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!newTaskPrompt.trim()}
                    className="p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {selectedProject && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-400">
                    <FolderOpen size={12} />
                    <span className="truncate">{selectedProject.split(/[/\\]/).pop()}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedProject(null)}
                      className="p-0.5 hover:text-blue-300"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </form>
            </div>

            {/* Backlog list */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Backlog ({backlogTasks.length})
                </h3>
                {backlogTasks.length > 0 && (
                  <div className="flex items-center gap-2">
                    {selectedTasks.size > 0 ? (
                      <>
                        <span className="text-[10px] text-blue-400">
                          {selectedTasks.size} selected
                        </span>
                        <button
                          onClick={queueSelected}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded transition-colors"
                        >
                          <Play size={10} />
                          Queue Selected
                        </button>
                        <button
                          onClick={clearSelection}
                          className="text-[10px] text-gray-500 hover:text-gray-300"
                        >
                          Clear
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={selectAllBacklog}
                        className="text-[10px] text-gray-500 hover:text-gray-300"
                      >
                        Select all
                      </button>
                    )}
                  </div>
                )}
              </div>

              <DroppableSection id="backlog-dropzone" isOver={overId === "backlog-dropzone"}>
                {backlogTasks.length === 0 ? (
                  <div className="text-center py-6 text-gray-500 text-sm">
                    <ListTodo size={24} className="mx-auto mb-2 opacity-50" />
                    <p>No tasks yet</p>
                    {activeId && queuedTasks.find(t => t.id === activeId) && (
                      <p className="text-xs text-blue-400 mt-2">Drop here to move to backlog</p>
                    )}
                  </div>
                ) : (
                  <SortableContext items={backlogTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {backlogTasks.map((task) => (
                        <SortableTaskItem
                          key={task.id}
                          task={task}
                          isSelected={selectedTasks.has(task.id)}
                          onToggleSelect={(shiftKey) => toggleTaskSelection(task.id, shiftKey)}
                          onMoveToQueue={() => updateTaskStatus(task.id, "queued")}
                          onDelete={() => deleteTask(task.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                )}
              </DroppableSection>
            </div>
          </div>
        </DndContext>
      )}
    </div>
  );
}

interface SortableTaskItemProps {
  task: Task;
  isSelected: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
  onMoveToQueue: () => void;
  onDelete: () => void;
}

function SortableTaskItem({ task, isSelected, onToggleSelect, onMoveToQueue, onDelete }: SortableTaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 p-2.5 border rounded-lg transition-colors ${
        isSelected
          ? "bg-blue-500/10 border-blue-500/30"
          : "bg-white/[0.03] border-white/[0.05] hover:bg-white/[0.06]"
      }`}
    >
      <button
        onClick={(e) => onToggleSelect(e.shiftKey)}
        className={`p-1 transition-colors ${
          isSelected ? "text-blue-400" : "text-gray-600 hover:text-gray-400"
        }`}
        title={isSelected ? "Deselect" : "Select (Shift+click for range)"}
      >
        {isSelected ? <CheckSquare size={14} /> : <SquareEmpty size={14} />}
      </button>

      <button
        {...attributes}
        {...listeners}
        className="p-1 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical size={12} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              task.priority === "high"
                ? "bg-red-500"
                : task.priority === "low"
                ? "bg-blue-500"
                : "bg-yellow-500"
            }`}
          />
          <span className="text-xs text-gray-200 truncate">{task.prompt}</span>
        </div>
        {task.project_path && (
          <div className="flex items-center gap-1 mt-1 ml-4">
            <FolderOpen size={10} className="text-gray-500" />
            <span className="text-[10px] text-gray-500 truncate">
              {task.project_path.split(/[/\\]/).pop()}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onMoveToQueue}
          className="p-1 text-gray-500 hover:text-blue-400"
          title="Add to queue"
        >
          <Play size={12} />
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-gray-500 hover:text-red-400"
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

interface SortableQueueItemProps {
  task: Task;
  isFirst: boolean;
  isLast: boolean;
  isCurrent: boolean;
  onRemove: () => void;
}

interface DroppableSectionProps {
  id: string;
  children: React.ReactNode;
  isOver?: boolean;
}

function DroppableSection({ id, children, isOver }: DroppableSectionProps) {
  const { setNodeRef, isOver: dropIsOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[60px] rounded-lg transition-colors ${
        (isOver || dropIsOver) ? "bg-blue-500/10 border-2 border-dashed border-blue-500/30" : ""
      }`}
    >
      {children}
    </div>
  );
}

function SortableQueueItem({ task, isLast, isCurrent, onRemove }: SortableQueueItemProps) {
  const isRunning = task.status === "running" || isCurrent;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: isRunning });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative pl-6">
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-white/10" />
      )}

      <div
        className={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 ${
          isRunning
            ? "bg-blue-500 border-blue-500 animate-pulse"
            : "bg-transparent border-gray-600"
        }`}
      />

      <div
        className={`bg-white/[0.03] border border-white/[0.05] rounded-lg p-2.5 group hover:bg-white/[0.06] transition-colors ${
          isRunning ? "border-l-2 border-l-blue-500" : ""
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-200 truncate flex-1">
            {task.prompt}
          </span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            {!isRunning && (
              <>
                <button
                  onClick={onRemove}
                  className="p-1 text-gray-500 hover:text-yellow-400"
                  title="Move back to backlog"
                >
                  <Pause size={12} />
                </button>
                <button
                  {...attributes}
                  {...listeners}
                  className="p-1 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing touch-none"
                >
                  <GripVertical size={12} />
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {task.project_path && (
            <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
              {task.project_path.split(/[/\\]/).pop()}
            </span>
          )}
          <span className={`text-[10px] ${isRunning ? "text-blue-400" : "text-gray-500"}`}>
            {isRunning ? "Running..." : "Queued"}
          </span>
        </div>

        {isRunning && (
          <div className="w-full bg-gray-800 rounded-full h-1 mt-2 overflow-hidden">
            <div className="bg-blue-500 h-1 w-full shimmer" />
          </div>
        )}
      </div>
    </div>
  );
}
