import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Check,
  Copy,
  FolderOpen,
  GripVertical,
  Pencil,
  Play,
  Plus,
  Star,
  Tag,
  Trash2,
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

// --- Shared styles ---

const INPUT_CLASS =
  "w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none";

const TAGS_INPUT_CLASS =
  "flex-1 bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-xs text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none";

// --- Helpers ---

function projectName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

// --- Reusable sub-components ---

interface EmptyStateProps {
  title: string;
  subtitle: string;
}

function EmptyState({ title, subtitle }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
      <Star size={32} className="opacity-50" />
      <p className="text-sm">{title}</p>
      <p className="text-xs text-gray-600">{subtitle}</p>
    </div>
  );
}

interface FavoriteFormProps {
  name: string;
  prompt: string;
  tags: string;
  onNameChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  saveIcon?: React.ReactElement;
  autoFocusName?: boolean;
}

function FavoriteForm({
  name,
  prompt,
  tags,
  onNameChange,
  onPromptChange,
  onTagsChange,
  onSave,
  onCancel,
  saveLabel,
  saveIcon,
  autoFocusName = false,
}: FavoriteFormProps): React.ReactElement {
  const isSaveDisabled = !name.trim() || !prompt.trim();

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Name (e.g., 'Fix TypeScript errors')"
        className={INPUT_CLASS}
        autoFocus={autoFocusName}
      />
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder="Prompt template..."
        rows={3}
        className={`${INPUT_CLASS} resize-none`}
      />
      <div className="flex items-center gap-2">
        <Tag size={14} className="text-gray-500 shrink-0" />
        <input
          type="text"
          value={tags}
          onChange={(e) => onTagsChange(e.target.value)}
          placeholder="Tags (comma separated, e.g., 'debug, typescript')"
          className={TAGS_INPUT_CLASS}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={isSaveDisabled}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {saveIcon}
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

// --- Main view ---

export default function FavoriteView(): React.ReactElement {
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
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  async function loadFavorites(): Promise<void> {
    try {
      const result = await invoke<Favorite[]>("get_favorites", {});
      setFavorites(result);
    } catch (error) {
      console.error("Failed to load favorites:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadProjects(): Promise<void> {
    try {
      const result = await invoke<string[]>("get_projects", {});
      setProjects(result);
    } catch (error) {
      console.error("Failed to load projects:", error);
    }
  }

  useEffect(() => {
    loadFavorites();
    loadProjects();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (runPickerRef.current && !runPickerRef.current.contains(event.target as Node)) {
        setShowRunPicker(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function resetAddForm(): void {
    setNewName("");
    setNewPrompt("");
    setNewTags("");
    setShowAddForm(false);
  }

  async function createFavorite(): Promise<void> {
    if (!newName.trim() || !newPrompt.trim()) return;

    try {
      await invoke("create_favorite", {
        name: newName.trim(),
        prompt: newPrompt.trim(),
        projectPath: null,
        tags: newTags.trim() || null,
      });
      resetAddForm();
      loadFavorites();
      toast.success("Favorite created");
    } catch (error) {
      console.error("Failed to create favorite:", error);
      toast.error("Failed to create favorite");
    }
  }

  async function updateFavorite(id: string, name: string, prompt: string, tags: string): Promise<void> {
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
  }

  async function deleteFavorite(id: string): Promise<void> {
    try {
      await invoke("delete_favorite", { id });
      loadFavorites();
      toast.info("Favorite deleted");
    } catch (error) {
      console.error("Failed to delete favorite:", error);
      toast.error("Failed to delete favorite");
    }
  }

  async function copyPrompt(prompt: string): Promise<void> {
    try {
      await writeText(prompt);
      toast.success("Copied to clipboard");
    } catch (error) {
      console.error("Failed to copy:", error);
      toast.error("Failed to copy");
    }
  }

  async function runPrompt(prompt: string, projectPath: string): Promise<void> {
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
  }

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = favorites.findIndex((f) => f.id === active.id);
    const newIndex = favorites.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const filteredFavorites = favorites.filter((fav) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      fav.name.toLowerCase().includes(query) ||
      fav.prompt.toLowerCase().includes(query) ||
      (fav.tags && fav.tags.toLowerCase().includes(query))
    );
  });

  function renderFavoritesList(): React.ReactElement {
    if (favorites.length === 0) {
      return <EmptyState title="No favorites yet" subtitle="Save your frequently used prompts here" />;
    }
    if (filteredFavorites.length === 0) {
      return <EmptyState title="No matches found" subtitle="Try a different search term" />;
    }
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
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
          <FavoriteForm
            name={newName}
            prompt={newPrompt}
            tags={newTags}
            onNameChange={setNewName}
            onPromptChange={setNewPrompt}
            onTagsChange={setNewTags}
            onSave={createFavorite}
            onCancel={resetAddForm}
            saveLabel="Save"
            autoFocusName
          />
        </div>
      )}

      {/* Favorites list */}
      <div className="flex-1 overflow-y-auto p-3">
        {renderFavoritesList()}
      </div>
    </div>
  );
}

// --- Sortable item ---

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
}: SortableFavoriteItemProps): React.ReactElement {
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

  const tagList = parseTags(favorite.tags);

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style} className="p-3 bg-white/[0.03] border border-blue-500/30 rounded-lg">
        <FavoriteForm
          name={editName}
          prompt={editPrompt}
          tags={editTags}
          onNameChange={setEditName}
          onPromptChange={setEditPrompt}
          onTagsChange={setEditTags}
          onSave={() => onSave(editName, editPrompt, editTags)}
          onCancel={onCancel}
          saveLabel="Save"
          saveIcon={<Check size={12} />}
          autoFocusName
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative p-3 bg-white/[0.03] border border-white/[0.05] rounded-lg hover:bg-white/[0.06] transition-colors"
    >
      {/* Title row */}
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

        {/* Action buttons */}
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
                        {projectName(project)}
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
