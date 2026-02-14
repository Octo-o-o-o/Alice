import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Plus,
  Star,
  Copy,
  Play,
  Pencil,
  Trash2,
  GripVertical,
  FolderOpen,
  Check,
  Tag,
} from "lucide-react";
import { Favorite } from "../lib/types";
import { useToast } from "../contexts/ToastContext";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export default function FavoriteView() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newTags, setNewTags] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [showRunPicker, setShowRunPicker] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const runPickerRef = useRef<HTMLDivElement>(null);
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

  const loadFavorites = async () => {
    try {
      const result = await invoke<Favorite[]>("get_favorites", {});
      setFavorites(result);
    } catch (error) {
      console.error("Failed to load favorites:", error);
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

  useEffect(() => {
    loadFavorites();
    loadProjects();
  }, []);

  // Close pickers when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (runPickerRef.current && !runPickerRef.current.contains(event.target as Node)) {
        setShowRunPicker(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const createFavorite = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;

    try {
      await invoke("create_favorite", {
        name: newName.trim(),
        prompt: newPrompt.trim(),
        projectPath: null,
        tags: newTags.trim() || null,
      });
      setNewName("");
      setNewPrompt("");
      setNewTags("");
      setShowAddForm(false);
      loadFavorites();
      toast.success("Favorite created");
    } catch (error) {
      console.error("Failed to create favorite:", error);
      toast.error("Failed to create favorite");
    }
  };

  const updateFavorite = async (id: string, name: string, prompt: string, tags: string) => {
    try {
      await invoke("update_favorite", {
        id,
        name,
        prompt,
        projectPath: null,
        tags: tags.trim() || null,
      });
      setEditingId(null);
      loadFavorites();
      toast.success("Favorite updated");
    } catch (error) {
      console.error("Failed to update favorite:", error);
      toast.error("Failed to update favorite");
    }
  };

  const deleteFavorite = async (id: string) => {
    try {
      await invoke("delete_favorite", { id });
      loadFavorites();
      toast.info("Favorite deleted");
    } catch (error) {
      console.error("Failed to delete favorite:", error);
      toast.error("Failed to delete favorite");
    }
  };

  const copyPrompt = async (prompt: string) => {
    try {
      await writeText(prompt);
      toast.success("Copied to clipboard");
    } catch (error) {
      console.error("Failed to copy:", error);
      toast.error("Failed to copy");
    }
  };

  const runPrompt = async (prompt: string, projectPath: string) => {
    try {
      await invoke("create_task", {
        prompt,
        project: projectPath,
        priority: "medium",
        notes: null,
      });
      setShowRunPicker(null);
      toast.success("Task created from favorite");
    } catch (error) {
      console.error("Failed to create task:", error);
      toast.error("Failed to create task");
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = favorites.findIndex((f) => f.id === active.id);
    const newIndex = favorites.findIndex((f) => f.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reordered = arrayMove(favorites, oldIndex, newIndex);
      setFavorites(reordered);

      try {
        await invoke("reorder_favorites", {
          favoriteIds: reordered.map((f) => f.id),
        });
      } catch (error) {
        console.error("Failed to reorder favorites:", error);
        toast.error("Failed to save order");
        loadFavorites();
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Filter favorites based on search query
  const filteredFavorites = favorites.filter((fav) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      fav.name.toLowerCase().includes(query) ||
      fav.prompt.toLowerCase().includes(query) ||
      (fav.tags && fav.tags.toLowerCase().includes(query))
    );
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header with search */}
      <div className="px-3 py-2 border-b border-white/5 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-300">Favorite Prompts</h2>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
        {favorites.length > 0 && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search favorites..."
            className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-xs text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
          />
        )}
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="p-3 border-b border-white/5 bg-white/[0.02] shrink-0">
          <div className="space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (e.g., 'Fix TypeScript errors')"
              className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
              autoFocus
            />
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="Prompt template..."
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none resize-none"
            />
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-gray-500 shrink-0" />
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="Tags (comma separated, e.g., 'debug, typescript')"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-xs text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewName("");
                  setNewPrompt("");
                  setNewTags("");
                }}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createFavorite}
                disabled={!newName.trim() || !newPrompt.trim()}
                className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Favorites list */}
      <div className="flex-1 overflow-y-auto p-3">
        {favorites.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <Star size={32} className="opacity-50" />
            <p className="text-sm">No favorites yet</p>
            <p className="text-xs text-gray-600">
              Save your frequently used prompts here
            </p>
          </div>
        ) : filteredFavorites.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <Star size={32} className="opacity-50" />
            <p className="text-sm">No matches found</p>
            <p className="text-xs text-gray-600">
              Try a different search term
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={filteredFavorites.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {filteredFavorites.map((favorite) => (
                  <SortableFavoriteItem
                    key={favorite.id}
                    favorite={favorite}
                    isEditing={editingId === favorite.id}
                    projects={projects}
                    showRunPicker={showRunPicker === favorite.id}
                    runPickerRef={runPickerRef}
                    onEdit={() => setEditingId(favorite.id)}
                    onSave={(name, prompt, tags) => updateFavorite(favorite.id, name, prompt, tags)}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => deleteFavorite(favorite.id)}
                    onCopy={() => copyPrompt(favorite.prompt)}
                    onRunClick={() => setShowRunPicker(favorite.id)}
                    onRunProject={(projectPath) => runPrompt(favorite.prompt, projectPath)}
                    onCloseRunPicker={() => setShowRunPicker(null)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

interface SortableFavoriteItemProps {
  favorite: Favorite;
  isEditing: boolean;
  projects: string[];
  showRunPicker: boolean;
  runPickerRef: React.RefObject<HTMLDivElement | null>;
  onEdit: () => void;
  onSave: (name: string, prompt: string, tags: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onRunClick: () => void;
  onRunProject: (projectPath: string) => void;
  onCloseRunPicker: () => void;
}

function SortableFavoriteItem({
  favorite,
  isEditing,
  projects,
  showRunPicker,
  runPickerRef,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onCopy,
  onRunClick,
  onRunProject,
  onCloseRunPicker,
}: SortableFavoriteItemProps) {
  const [editName, setEditName] = useState(favorite.name);
  const [editPrompt, setEditPrompt] = useState(favorite.prompt);
  const [editTags, setEditTags] = useState(favorite.tags || "");

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: favorite.id, disabled: isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  useEffect(() => {
    if (isEditing) {
      setEditName(favorite.name);
      setEditPrompt(favorite.prompt);
      setEditTags(favorite.tags || "");
    }
  }, [isEditing, favorite]);

  // Parse tags string into array
  const tagList = favorite.tags
    ? favorite.tags.split(",").map((t) => t.trim()).filter((t) => t)
    : [];

  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="p-3 bg-white/[0.03] border border-blue-500/30 rounded-lg"
      >
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none mb-2"
          autoFocus
        />
        <textarea
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none resize-none mb-2"
        />
        <div className="flex items-center gap-2 mb-3">
          <Tag size={14} className="text-gray-500 shrink-0" />
          <input
            type="text"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder="Tags (comma separated)"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-xs text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(editName, editPrompt, editTags)}
            disabled={!editName.trim() || !editPrompt.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <Check size={12} />
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative p-3 bg-white/[0.03] border border-white/[0.05] rounded-lg hover:bg-white/[0.06] transition-colors"
    >
      {/* Title row with buttons */}
      <div className="flex items-center gap-2 mb-1">
        <button
          {...attributes}
          {...listeners}
          className="p-1 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing touch-none shrink-0"
        >
          <GripVertical size={12} />
        </button>
        <Star size={12} className="text-yellow-500 shrink-0" />
        <span className="text-sm font-medium text-gray-200 truncate flex-1 min-w-0 group-hover:mr-[120px] transition-all">
          {favorite.name}
        </span>
        {/* Action buttons - positioned absolutely on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 absolute right-3">
          <button
            onClick={onCopy}
            className="p-1.5 text-gray-500 hover:text-blue-400 rounded transition-colors"
            title="Copy prompt"
          >
            <Copy size={14} />
          </button>
          <div className="relative">
            <button
              onClick={onRunClick}
              className="p-1.5 text-gray-500 hover:text-green-400 rounded transition-colors"
              title="Run as task"
            >
              <Play size={14} />
            </button>
            {showRunPicker && (
              <div
                ref={runPickerRef}
                className="absolute right-0 top-full mt-1 w-64 max-h-48 overflow-y-auto bg-gray-900 border border-white/10 rounded-lg shadow-xl z-50"
              >
                <div className="px-3 py-2 border-b border-white/5">
                  <span className="text-xs text-gray-400">Select project to run in:</span>
                </div>
                <div className="p-1.5">
                  {projects.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500">No projects found</div>
                  ) : (
                    projects.map((project) => (
                      <button
                        key={project}
                        onClick={() => {
                          onRunProject(project);
                          onCloseRunPicker();
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 rounded transition-colors flex items-center gap-2"
                      >
                        <FolderOpen size={12} className="text-gray-500" />
                        {project.split(/[/\\]/).pop()}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onEdit}
            className="p-1.5 text-gray-500 hover:text-yellow-400 rounded transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-gray-500 hover:text-red-400 rounded transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Prompt */}
      <p className="text-xs text-gray-400 ml-9 whitespace-pre-wrap break-words">
        {favorite.prompt}
      </p>

      {/* Tags */}
      {tagList.length > 0 && (
        <div className="flex items-center gap-1.5 mt-1.5 ml-9 flex-wrap">
          {tagList.map((tag, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded"
            >
              <Tag size={8} />
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
