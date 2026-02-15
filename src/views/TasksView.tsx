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
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
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
import { Task, QueueStatusEvent, QueueStartResult, TerminalOption } from "../lib/types";
import { useToast } from "../contexts/ToastContext";

// --- Helpers ---

function projectName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function priorityColor(priority: string): string {
  if (priority === "high") return "bg-red-500";
  if (priority === "low") return "bg-blue-500";
  return "bg-yellow-500";
}

function terminalSubtitle(value: string): string | null {
  if (value === "background") return "Hidden execution";
  if (value !== "custom") return "Watch Claude work";
  return null;
}

async function invokeUpdateTaskStatus(id: string, status: string): Promise<void> {
  await invoke("update_task", {
    id,
    status,
    prompt: null,
    priority: null,
    sortOrder: null,
  });
}

// --- Sub-components ---

interface TerminalPickerModalProps {
  terminalOptions: TerminalOption[];
  selectedTerminal: string;
  onSelectTerminal: (value: string) => void;
  rememberChoice: boolean;
  onRememberChange: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function TerminalPickerModal({
  terminalOptions,
  selectedTerminal,
  onSelectTerminal,
  rememberChoice,
  onRememberChange,
  onCancel,
  onConfirm,
}: TerminalPickerModalProps): React.ReactElement {
  return (
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
              onClick={() => onSelectTerminal(option.value)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedTerminal === option.value
                  ? "bg-blue-600 text-white"
                  : "bg-white/5 text-gray-300 hover:bg-white/10"
              }`}
            >
              {option.label}
              {terminalSubtitle(option.value) && (
                <span className="block text-xs opacity-60 mt-0.5">
                  {terminalSubtitle(option.value)}
                </span>
              )}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => onRememberChange(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/50"
          />
          <span className="text-xs text-gray-400">Remember my choice</span>
        </label>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 text-sm bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            Start Queue
          </button>
        </div>
      </div>
    </div>
  );
}

interface ProjectPickerProps {
  projects: string[];
  selectedProject: string | null;
  onSelect: (project: string | null) => void;
}

function ProjectPickerDropdown({ projects, selectedProject, onSelect }: ProjectPickerProps): React.ReactElement {
  return (
    <div className="absolute right-0 top-full mt-1 w-64 max-h-48 overflow-y-auto bg-gray-900 border border-white/10 rounded-lg shadow-xl z-50">
      <div className="p-1.5">
        {projects.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-500">No projects found</div>
        ) : (
          <>
            <ProjectOption
              label="No project (auto-detect)"
              isActive={!selectedProject}
              inactiveTextClass="text-gray-400"
              onClick={() => onSelect(null)}
            />
            {projects.map((project) => (
              <ProjectOption
                key={project}
                label={projectName(project)}
                title={project}
                isActive={selectedProject === project}
                inactiveTextClass="text-gray-300"
                onClick={() => onSelect(project)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface ProjectOptionProps {
  label: string;
  title?: string;
  isActive: boolean;
  inactiveTextClass: string;
  onClick: () => void;
}

function ProjectOption({ label, title, isActive, inactiveTextClass, onClick }: ProjectOptionProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
        isActive
          ? "bg-blue-600/20 text-blue-400"
          : `${inactiveTextClass} hover:bg-white/5`
      }`}
      title={title}
    >
      {label}
    </button>
  );
}

interface DroppableSectionProps {
  id: string;
  children: React.ReactNode;
}

function DroppableSection({ id, children }: DroppableSectionProps): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[60px] rounded-lg transition-colors ${
        isOver ? "bg-blue-500/10 border-2 border-dashed border-blue-500/30" : ""
      }`}
    >
      {children}
    </div>
  );
}

function useSortableItem(id: string, disabled = false) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  return { attributes, listeners, setNodeRef, style, isDragging };
}

interface SortableTaskItemProps {
  task: Task;
  isSelected: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
  onMoveToQueue: () => void;
  onDelete: () => void;
}

function SortableTaskItem({
  task,
  isSelected,
  onToggleSelect,
  onMoveToQueue,
  onDelete,
}: SortableTaskItemProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, style } = useSortableItem(task.id);

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
          <span className={`w-2 h-2 rounded-full shrink-0 ${priorityColor(task.priority)}`} />
          <span className="text-xs text-gray-200 truncate">{task.prompt}</span>
        </div>
        {task.project_path && (
          <div className="flex items-center gap-1 mt-1 ml-4">
            <FolderOpen size={10} className="text-gray-500" />
            <span className="text-[10px] text-gray-500 truncate">
              {projectName(task.project_path)}
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
  isLast: boolean;
  isCurrent: boolean;
  onRemove: () => void;
}

function SortableQueueItem({
  task,
  isLast,
  isCurrent,
  onRemove,
}: SortableQueueItemProps): React.ReactElement {
  const isRunning = task.status === "running" || isCurrent;
  const { attributes, listeners, setNodeRef, style } = useSortableItem(task.id, isRunning);

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
              {projectName(task.project_path)}
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

// --- Main component ---

interface TasksViewProps {
  onTaskCountChange: (count: number) => void;
}

export default function TasksView({ onTaskCountChange }: TasksViewProps): React.ReactElement {
  const [tasks, setTasks] = useState<Task[]>([]);
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
  const [isComposing, setIsComposing] = useState(false);
  const [showTerminalPicker, setShowTerminalPicker] = useState(false);
  const [terminalOptions, setTerminalOptions] = useState<TerminalOption[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState<string>("system");
  const [rememberChoice, setRememberChoice] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const backlogTasks = tasks.filter((t) => t.status === "backlog");
  const queuedTasks = tasks.filter((t) => t.status === "queued" || t.status === "running");
  const completedTasks = tasks.filter((t) => t.status === "completed" || t.status === "failed");

  // --- Data loading ---

  const loadTasks = async () => {
    try {
      const result = await invoke<Task[]>("get_tasks", {});
      setTasks(result);
      onTaskCountChange(
        result.filter((t) => t.status !== "completed" && t.status !== "failed").length
      );
    } catch (error) {
      console.error("Failed to load tasks:", error);
    } finally {
      setLoading(false);
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

  useEffect(() => {
    loadTasks();
    loadProjects();

    invoke<boolean>("get_queue_status", {})
      .then(setQueueRunning)
      .catch((error) => console.error("Failed to get queue status:", error));

    const unlisten = listen<QueueStatusEvent>("queue-status", (event) => {
      setQueueRunning(event.payload.is_running);
      setCurrentTaskId(event.payload.current_task_id);
      loadTasks();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!showProjectPicker) return;

    function handleClickOutside(event: MouseEvent): void {
      if (projectPickerRef.current && !projectPickerRef.current.contains(event.target as Node)) {
        setShowProjectPicker(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showProjectPicker]);

  // --- Task actions ---

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
      await invokeUpdateTaskStatus(id, status);
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

  // --- Queue controls ---

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

  // --- Multi-select ---

  const toggleTaskSelection = useCallback(
    (taskId: string, shiftKey: boolean) => {
      setSelectedTasks((prev) => {
        const next = new Set(prev);

        if (shiftKey && lastSelectedId) {
          const taskIds = backlogTasks.map((t) => t.id);
          const lastIndex = taskIds.indexOf(lastSelectedId);
          const currentIndex = taskIds.indexOf(taskId);

          if (lastIndex !== -1 && currentIndex !== -1) {
            const start = Math.min(lastIndex, currentIndex);
            const end = Math.max(lastIndex, currentIndex);
            for (let i = start; i <= end; i++) {
              next.add(taskIds[i]);
            }
          }
        } else if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
        }

        return next;
      });
      setLastSelectedId(taskId);
    },
    [lastSelectedId, backlogTasks]
  );

  const clearSelection = () => {
    setSelectedTasks(new Set());
    setLastSelectedId(null);
  };

  const queueSelected = async () => {
    const ids = Array.from(selectedTasks);
    if (ids.length === 0) return;

    try {
      for (const taskId of ids) {
        await invokeUpdateTaskStatus(taskId, "queued");
      }
      loadTasks();
      clearSelection();
      toast.success(`${ids.length} task${ids.length > 1 ? "s" : ""} queued`);
    } catch (error) {
      console.error("Failed to queue tasks:", error);
      toast.error("Failed to queue tasks");
    }
  };

  // --- Drag and drop ---

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(event.active.id as string);
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeTaskId = active.id as string;
    const overTaskId = over.id as string;
    const activeTask = tasks.find((t) => t.id === activeTaskId);
    if (!activeTask) return;

    const isBacklog = (t: Task) => t.status === "backlog";
    const isQueued = (t: Task) => t.status === "queued" || t.status === "running";

    const fromBacklog = isBacklog(activeTask);
    const fromQueue = isQueued(activeTask);

    const overTask = tasks.find((t) => t.id === overTaskId);
    const toBacklog = overTaskId === "backlog-dropzone" || (overTask && isBacklog(overTask));
    const toQueue = overTaskId === "queue-dropzone" || (overTask && isQueued(overTask));

    // Cross-section: backlog -> queue
    if (fromBacklog && toQueue) {
      try {
        await invokeUpdateTaskStatus(activeTaskId, "queued");
        loadTasks();
        toast.success("Task moved to queue");
      } catch (error) {
        console.error("Failed to move task to queue:", error);
        toast.error("Failed to move task");
      }
      return;
    }

    // Cross-section: queue -> backlog (only if not running)
    if (fromQueue && toBacklog && activeTask.status !== "running") {
      try {
        await invokeUpdateTaskStatus(activeTaskId, "backlog");
        loadTasks();
        toast.success("Task moved to backlog");
      } catch (error) {
        console.error("Failed to move task to backlog:", error);
        toast.error("Failed to move task");
      }
      return;
    }

    // Reorder within same section
    if (activeTaskId === overTaskId || !overTask) return;

    const sameSection = (fromBacklog && toBacklog) || (fromQueue && toQueue);
    if (!sameSection) return;

    const sectionTasks = fromBacklog ? backlogTasks : queuedTasks;
    const oldIndex = sectionTasks.findIndex((t) => t.id === activeTaskId);
    const newIndex = sectionTasks.findIndex((t) => t.id === overTaskId);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sectionTasks, oldIndex, newIndex);

    // Optimistic update
    setTasks((prev) => {
      if (fromBacklog) {
        const others = prev.filter((t) => t.status !== "backlog");
        return [...reordered, ...others];
      }
      const others = prev.filter((t) => t.status !== "queued" && t.status !== "running");
      return [...others, ...reordered];
    });

    try {
      await invoke("reorder_tasks", { taskIds: reordered.map((t) => t.id) });
    } catch (error) {
      console.error("Failed to reorder tasks:", error);
      toast.error("Failed to save order");
      loadTasks();
    }
  }

  // --- Project picker callbacks ---

  function handleSelectProject(project: string | null): void {
    setSelectedProject(project);
    setShowProjectPicker(false);
  }

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {showTerminalPicker && (
        <TerminalPickerModal
          terminalOptions={terminalOptions}
          selectedTerminal={selectedTerminal}
          onSelectTerminal={setSelectedTerminal}
          rememberChoice={rememberChoice}
          onRememberChange={setRememberChoice}
          onCancel={() => setShowTerminalPicker(false)}
          onConfirm={confirmTerminalChoice}
        />
      )}

      {/* Task input */}
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
                title={
                  selectedProject
                    ? `Project: ${projectName(selectedProject)}`
                    : "Select project (optional)"
                }
              >
                <FolderOpen size={16} />
              </button>
              {showProjectPicker && (
                <ProjectPickerDropdown
                  projects={projects}
                  selectedProject={selectedProject}
                  onSelect={handleSelectProject}
                />
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
              <span className="truncate">{projectName(selectedProject)}</span>
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-y-auto">
          {/* Backlog section */}
          <div className="p-3">
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
                      onClick={() => setSelectedTasks(new Set(backlogTasks.map((t) => t.id)))}
                      className="text-[10px] text-gray-500 hover:text-gray-300"
                    >
                      Select all
                    </button>
                  )}
                </div>
              )}
            </div>

            <DroppableSection id="backlog-dropzone">
              {backlogTasks.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">
                  <ListTodo size={24} className="mx-auto mb-2 opacity-50" />
                  <p>No tasks yet</p>
                  {activeId && queuedTasks.find((t) => t.id === activeId) && (
                    <p className="text-xs text-blue-400 mt-2">Drop here to move to backlog</p>
                  )}
                </div>
              ) : (
                <SortableContext
                  items={backlogTasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
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

          {/* Queue section */}
          <div className="p-3 border-t border-white/5">
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

            <DroppableSection id="queue-dropzone">
              {queuedTasks.length === 0 ? (
                <div className="text-center py-4 text-gray-600 text-xs">
                  {activeId && backlogTasks.find((t) => t.id === activeId) ? (
                    <p className="text-blue-400">Drop here to add to queue</p>
                  ) : (
                    <p>Move tasks here to queue them for execution</p>
                  )}
                </div>
              ) : (
                <SortableContext
                  items={queuedTasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {queuedTasks.map((task, index) => (
                      <SortableQueueItem
                        key={task.id}
                        task={task}
                        isLast={index === queuedTasks.length - 1}
                        isCurrent={task.id === currentTaskId}
                        onRemove={() => updateTaskStatus(task.id, "backlog")}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}
            </DroppableSection>
          </div>

          {/* Completed section */}
          {completedTasks.length > 0 && (
            <div className="p-3 border-t border-white/5">
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <ChevronRight
                      size={12}
                      className="transition-transform group-open:rotate-90"
                    />
                    Completed ({completedTasks.length})
                  </span>
                </summary>
                <div className="mt-2 space-y-2">
                  {completedTasks.slice(0, 10).map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 p-2 bg-white/[0.02] rounded-lg opacity-60"
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          task.status === "completed" ? "bg-green-500" : "bg-red-500"
                        }`}
                      />
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
    </div>
  );
}
