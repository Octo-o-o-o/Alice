import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Copy,
  CheckCircle2,
  AlertCircle,
  Zap,
  Play,
  Tag,
  GitBranch,
  Trash2,
  Download,
  MoreHorizontal,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { Session, ImageContent } from "../lib/types";
import { useToast } from "../contexts/ToastContext";
import { getProviderColor } from "../lib/provider-colors";
import ProviderBadge from "./ProviderBadge";
import ImageGallery from "./ImageGallery";

// --- Pure utility functions (no component state dependency) ---

function formatDuration(startMs: number, endMs?: number): string {
  const durationMs = (endMs || Date.now()) - startMs;
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

function getStatusDot(status: string): string {
  switch (status) {
    case "active":
      return "bg-blue-500 shadow-glow-blue animate-pulse";
    case "completed":
      return "bg-green-500";
    case "error":
      return "bg-red-500";
    case "needs_input":
      return "bg-yellow-500 animate-pulse";
    default:
      return "bg-gray-500";
  }
}

// --- Label input sub-component (used in both compact and full views) ---

interface LabelInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  isComposing: boolean;
}

function LabelInput({
  inputRef,
  value,
  onChange,
  onSave,
  onCancel,
  onCompositionStart,
  onCompositionEnd,
  isComposing,
}: LabelInputProps): React.ReactElement {
  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Enter" && !isComposing) {
      onSave();
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onSave}
      onKeyDown={handleKeyDown}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      placeholder="Add label..."
      className="w-32 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
    />
  );
}

// --- Main component ---

interface SessionCardProps {
  session: Session;
  compact?: boolean;
  onLabelChange?: (sessionId: string, label: string | null) => void;
  onDelete?: (sessionId: string) => void;
}

export default function SessionCard({
  session,
  compact = false,
  onLabelChange,
  onDelete,
}: SessionCardProps) {
  const [copied, setCopied] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(session.label || "");
  const [showActions, setShowActions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [images, setImages] = useState<ImageContent[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const providerBorderColor = getProviderColor(session.provider).primary;

  // Close actions menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setShowActions(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-focus label input when editing starts
  useEffect(() => {
    if (isEditingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [isEditingLabel]);

  // --- Shared command helper ---

  async function copyCommand(
    commandName: string,
    successMessage: string,
  ): Promise<void> {
    try {
      const command = await invoke<string>(commandName, {
        sessionId: session.session_id,
      });
      await writeText(command);
      toast.success(successMessage);
    } catch (error) {
      console.error(`Failed to copy ${commandName}:`, error);
      toast.error("Failed to copy command");
    }
  }

  // --- Event handlers ---

  async function saveLabel(): Promise<void> {
    const newLabel = labelValue.trim() || null;
    setIsEditingLabel(false);

    if (newLabel !== session.label) {
      try {
        await invoke("update_session_label", {
          sessionId: session.session_id,
          label: newLabel,
        });
        onLabelChange?.(session.session_id, newLabel);
        toast.success(newLabel ? "Label saved" : "Label removed");
      } catch (error) {
        console.error("Failed to save label:", error);
        toast.error("Failed to save label");
        setLabelValue(session.label || "");
      }
    }
  }

  function cancelLabelEdit(): void {
    setIsEditingLabel(false);
    setLabelValue(session.label || "");
  }

  async function handleResumeClick(): Promise<void> {
    await copyCommand("resume_session", "Resume command copied to clipboard");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleForkClick(): Promise<void> {
    await copyCommand("fork_session", "Fork command copied to clipboard");
    setShowActions(false);
  }

  async function handleCopySessionId(): Promise<void> {
    await writeText(session.session_id);
    toast.info("Session ID copied");
  }

  async function handleDelete(): Promise<void> {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await invoke("delete_session", { sessionId: session.session_id });
      toast.success("Session deleted");
      setShowActions(false);
      setConfirmDelete(false);
      onDelete?.(session.session_id);
    } catch (error) {
      console.error("Failed to delete session:", error);
      toast.error("Failed to delete session");
    }
  }

  async function handleExport(format: "json" | "markdown"): Promise<void> {
    try {
      const content = await invoke<string>("export_session", {
        sessionId: session.session_id,
        format,
      });

      const extension = format === "json" ? "json" : "md";
      const fileName = `session-${session.session_id.slice(0, 8)}.${extension}`;

      const filePath = await save({
        defaultPath: fileName,
        filters: [
          {
            name: format === "json" ? "JSON" : "Markdown",
            extensions: [extension],
          },
        ],
      });

      if (filePath) {
        await writeTextFile(filePath, content);
        toast.success(`Session exported to ${filePath.split(/[/\\]/).pop()}`);
      }
      setShowActions(false);
    } catch (error) {
      console.error("Failed to export session:", error);
      toast.error("Failed to export session");
    }
  }

  async function handleViewImages(): Promise<void> {
    setLoadingImages(true);
    try {
      const sessionImages = await invoke<ImageContent[]>("get_session_images", {
        sessionId: session.session_id,
      });
      setImages(sessionImages);
      if (sessionImages.length === 0) {
        toast.info("No images found in this session");
      } else {
        setShowImages(true);
      }
    } catch (error) {
      console.error("Failed to load images:", error);
      toast.error("Failed to load images");
    } finally {
      setLoadingImages(false);
    }
  }

  // --- Shared label input props ---

  const labelInputProps = {
    inputRef: labelInputRef,
    value: labelValue,
    onChange: setLabelValue,
    onSave: saveLabel,
    onCancel: cancelLabelEdit,
    onCompositionStart: () => setIsComposing(true),
    onCompositionEnd: () => setIsComposing(false),
    isComposing,
  };

  // --- Compact view ---

  if (compact) {
    return (
      <div
        className="group relative bg-white/[0.03] hover:bg-white/[0.06] border-t border-r border-b border-white/[0.05] hover:border-white/[0.1] rounded-lg p-2.5 transition-all border-l-[3px]"
        style={{ borderLeftColor: providerBorderColor }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded shrink-0">
              {session.project_name}
            </span>
            {session.label && (
              <span className="text-[10px] text-purple-300 bg-purple-500/20 px-1.5 py-0.5 rounded shrink-0">
                {session.label}
              </span>
            )}
            <span className="text-xs text-gray-300 truncate">
              {session.first_prompt || "No prompt"}
            </span>
          </div>
          <span className="text-[10px] text-gray-500 shrink-0">
            {formatTimeAgo(session.last_active_at)}
          </span>
        </div>

        {/* Hover actions */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingLabel(true);
            }}
            className="p-1.5 text-gray-500 hover:text-purple-300 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
            title="Edit label"
          >
            <Tag size={12} />
          </button>
          <button
            onClick={handleResumeClick}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            title="Copy resume command"
          >
            {copied ? <CheckCircle2 size={12} /> : <Play size={12} />}
            Resume
          </button>
        </div>

        {/* Label edit popup */}
        {isEditingLabel && (
          <div className="absolute left-2 top-full mt-1 z-20 bg-gray-900 border border-white/10 rounded-lg p-2 shadow-xl">
            <LabelInput {...labelInputProps} />
          </div>
        )}
      </div>
    );
  }

  // --- Full view ---

  return (
    <div
      className="group relative bg-white/[0.03] hover:bg-white/[0.06] border-t border-r border-b border-white/[0.05] hover:border-white/[0.1] rounded-lg p-3 transition-all border-l-[3px]"
      style={{ borderLeftColor: providerBorderColor }}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className={`w-1.5 h-1.5 rounded-full ${getStatusDot(session.status)}`} />
          <span className="font-medium text-blue-100 text-sm truncate">
            {session.project_name}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono text-gray-500">
            {session.status === "active"
              ? formatDuration(session.started_at)
              : formatTimeAgo(session.last_active_at)}
          </span>
          <ProviderBadge provider={session.provider} size="xs" />
        </div>
      </div>

      {/* Content Preview */}
      <p className="text-xs text-gray-400 line-clamp-2 mb-2 leading-relaxed">
        {session.first_prompt || "No prompt"}
      </p>

      {/* Progress bar for active sessions */}
      {session.status === "active" && (
        <div className="w-full bg-gray-800 rounded-full h-1 mt-2 overflow-hidden">
          <div className="bg-blue-500 h-1 w-full shimmer" />
        </div>
      )}

      {/* Label */}
      {(session.label || isEditingLabel) && (
        <div className="mb-2">
          {isEditingLabel ? (
            <LabelInput {...labelInputProps} />
          ) : (
            <button
              onClick={() => setIsEditingLabel(true)}
              className="text-[10px] text-purple-300 bg-purple-500/20 hover:bg-purple-500/30 px-1.5 py-0.5 rounded transition-colors flex items-center gap-1"
            >
              <Tag size={10} />
              {session.label}
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.05]">
        <div className="flex items-center gap-2">
          {session.model && (
            <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
              {session.model.replace("claude-", "").split("-")[0]}
            </span>
          )}
          {session.status === "needs_input" && (
            <span className="text-[10px] text-yellow-400 flex items-center gap-1">
              <AlertCircle size={10} />
              Needs input
            </span>
          )}
          {!session.label && !isEditingLabel && (
            <button
              onClick={() => setIsEditingLabel(true)}
              className="text-[10px] text-gray-500 hover:text-purple-300 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Tag size={10} />
              Add label
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 font-mono flex items-center gap-1">
            <Zap size={10} />
            {formatTokens(session.total_tokens)}
          </span>
          <span className="text-[10px] text-gray-500 font-mono opacity-70">
            ${session.total_cost_usd.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleResumeClick}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors shadow-lg"
          title="Copy resume command"
        >
          {copied ? <CheckCircle2 size={12} /> : <Play size={12} />}
          Resume
        </button>
        <button
          onClick={handleCopySessionId}
          className="p-1.5 text-gray-500 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors"
          title="Copy session ID"
        >
          <Copy size={12} />
        </button>
        {/* More actions dropdown */}
        <div ref={actionsRef} className="relative">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1.5 text-gray-500 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors"
            title="More actions"
          >
            <MoreHorizontal size={12} />
          </button>
          {showActions && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-gray-900 border border-white/10 rounded-lg shadow-xl z-30 overflow-hidden">
              <button
                onClick={handleViewImages}
                disabled={loadingImages}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <ImageIcon size={12} />
                {loadingImages ? "Loading..." : "View Images"}
              </button>
              <div className="border-t border-white/5" />
              <button
                onClick={handleForkClick}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 transition-colors"
              >
                <GitBranch size={12} />
                Fork Session
              </button>
              <button
                onClick={() => handleExport("markdown")}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 transition-colors"
              >
                <Download size={12} />
                Export as MD
              </button>
              <button
                onClick={() => handleExport("json")}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 transition-colors"
              >
                <Download size={12} />
                Export as JSON
              </button>
              <div className="border-t border-white/5" />
              <button
                onClick={handleDelete}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  confirmDelete
                    ? "text-red-400 bg-red-500/10"
                    : "text-gray-300 hover:bg-white/10"
                }`}
              >
                <Trash2 size={12} />
                {confirmDelete ? "Click to confirm" : "Delete"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Image Gallery Modal */}
      {showImages && images.length > 0 && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-6xl max-h-full overflow-auto bg-gray-900/95 rounded-lg p-4">
            <div className="flex justify-between items-center mb-4 sticky top-0 bg-gray-900/95 z-10 pb-2 border-b border-white/10">
              <h3 className="text-sm font-medium text-gray-200">
                Session Images ({images.length})
              </h3>
              <button
                onClick={() => setShowImages(false)}
                className="p-1.5 text-gray-500 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors"
                title="Close"
              >
                <X size={12} />
              </button>
            </div>
            <ImageGallery images={images} sessionId={session.session_id} />
          </div>
        </div>
      )}
    </div>
  );
}
