import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, ListTodo, Play, Pause, Trash2, GripVertical, Square, ChevronRight, CheckSquare, Square as SquareEmpty } from "lucide-react";
import { Task, QueueStatusEvent } from "../lib/types";
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

interface TasksViewProps {
  onTaskCountChange: (count: number) => void;
}

export default function TasksView({ onTaskCountChange }: TasksViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [queueRunning, setQueueRunning] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

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
    } finally {
      setLoading(false);
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

  useEffect(() => {
    loadTasks();
    loadQueueStatus();

    // Listen for queue status updates
    const unlisten = listen<QueueStatusEvent>("queue-status", (event) => {
      setQueueRunning(event.payload.is_running);
      setCurrentTaskId(event.payload.current_task_id);
      loadTasks(); // Refresh tasks when queue status changes
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  const createTask = async () => {
    if (!newTaskPrompt.trim()) return;

    try {
      await invoke("create_task", {
        prompt: newTaskPrompt.trim(),
        project: null,
        priority: "medium",
        notes: null,
      });
      setNewTaskPrompt("");
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
      await invoke("start_queue", {});
      setQueueRunning(true);
      toast.success("Queue started");
    } catch (error) {
      console.error("Failed to start queue:", error);
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

    // Find which section the task is being dragged from and to
    const activeTask = tasks.find(t => t.id === activeTaskId);
    if (!activeTask) return;

    const fromBacklog = activeTask.status === "backlog";
    const fromQueue = activeTask.status === "queued" || activeTask.status === "running";

    // Determine target section from the over element
    const isOverBacklogDropzone = overTaskId === "backlog-dropzone";
    const isOverQueueDropzone = overTaskId === "queue-dropzone";
    const overTask = tasks.find(t => t.id === overTaskId);
    const toBacklog = isOverBacklogDropzone || (overTask && overTask.status === "backlog");
    const toQueue = isOverQueueDropzone || (overTask && (overTask.status === "queued" || overTask.status === "running"));

    // Handle cross-section moves
    if (fromBacklog && toQueue) {
      // Move from backlog to queue
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
      // Move from queue to backlog
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

    // Handle reordering within the same section
    if (activeTaskId !== overTaskId && overTask) {
      const sameSection = (fromBacklog && toBacklog) || (fromQueue && toQueue);
      if (sameSection) {
        const taskList = fromBacklog ? backlogTasks : queuedTasks;
        const oldIndex = taskList.findIndex((t) => t.id === activeTaskId);
        const newIndex = taskList.findIndex((t) => t.id === overTaskId);

        if (oldIndex !== -1 && newIndex !== -1) {
          const reordered = arrayMove(taskList, oldIndex, newIndex);

          // Optimistically update UI
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

          // Persist to backend
          try {
            await invoke("reorder_tasks", {
              taskIds: reordered.map((t) => t.id),
            });
          } catch (error) {
            console.error("Failed to reorder tasks:", error);
            toast.error("Failed to save order");
            loadTasks(); // Revert to actual state
          }
        }
      }
    }
  };

  const backlogTasks = tasks.filter((t) => t.status === "backlog");
  const queuedTasks = tasks.filter((t) => t.status === "queued" || t.status === "running");
  const completedTasks = tasks.filter((t) => t.status === "completed" || t.status === "failed");

  // Multi-select handlers
  const toggleTaskSelection = useCallback((taskId: string, shiftKey: boolean) => {
    setSelectedTasks((prev) => {
      const newSet = new Set(prev);

      if (shiftKey && lastSelectedId) {
        // Shift+click: select range
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
        // Regular click: toggle selection
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
      {/* Add task input */}
      <div className="p-3 border-b border-white/5 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createTask();
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={newTaskPrompt}
            onChange={(e) => setNewTaskPrompt(e.target.value)}
            placeholder="Add a task..."
            className="flex-1 bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:bg-white/8 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newTaskPrompt.trim()}
            className="p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <Plus size={16} />
          </button>
        </form>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
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

            <DroppableSection id="queue-dropzone" isOver={overId === "queue-dropzone"}>
              {queuedTasks.length === 0 ? (
                <div className="text-center py-4 text-gray-600 text-xs">
                  {activeId && backlogTasks.find(t => t.id === activeId) ? (
                    <p className="text-blue-400">Drop here to add to queue</p>
                  ) : (
                    <p>Move tasks here to queue them for execution</p>
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
          </div>

        {/* Completed section */}
        {completedTasks.length > 0 && (
          <div className="p-3 border-t border-white/5">
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
      {/* Selection checkbox */}
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

      <div className="flex items-center gap-2 flex-1 min-w-0">
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
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-white/10" />
      )}

      {/* Status circle */}
      <div
        className={`absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 ${
          isRunning
            ? "bg-blue-500 border-blue-500 animate-pulse"
            : "bg-transparent border-gray-600"
        }`}
      />

      {/* Content */}
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

        {/* Progress bar for running task */}
        {isRunning && (
          <div className="w-full bg-gray-800 rounded-full h-1 mt-2 overflow-hidden">
            <div className="bg-blue-500 h-1 w-full shimmer" />
          </div>
        )}
      </div>
    </div>
  );
}
