import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, X, Clock, FolderOpen } from "lucide-react";
import { Session } from "../lib/types";

interface SearchOverlayProps {
  onClose: () => void;
}

export default function SearchOverlay({ onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const debounce = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await invoke<Session[]>("search_sessions", {
          query: query.trim(),
          project: null,
          limit: 10,
        });
        setResults(result);
        setSelectedIndex(0);
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(debounce);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      // Handle selection
      const session = results[selectedIndex];
      console.log("Selected session:", session.session_id);
      onClose();
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  };

  return (
    <div
      className="absolute inset-0 bg-gray-950/80 backdrop-blur-sm z-50 flex items-start justify-center pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <Search size={18} className="text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-gray-500 hover:text-gray-300"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="py-8 text-center text-gray-500 text-sm">
              No results for "{query}"
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="py-2">
              {results.map((session, index) => (
                <button
                  key={session.session_id}
                  onClick={() => {
                    console.log("Selected:", session.session_id);
                    onClose();
                  }}
                  className={`w-full px-4 py-2.5 flex items-start gap-3 text-left transition-colors ${
                    index === selectedIndex
                      ? "bg-blue-500/20"
                      : "hover:bg-white/5"
                  }`}
                >
                  <div className="w-8 h-8 bg-gray-800 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                    <FolderOpen size={14} className="text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-200 truncate">
                        {session.first_prompt || "No prompt"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                        {session.project_name}
                      </span>
                      <span className="text-[10px] text-gray-600 flex items-center gap-1">
                        <Clock size={10} />
                        {formatTimeAgo(session.last_active_at)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && !query && (
            <div className="py-6 px-4 text-center text-gray-500 text-sm">
              <p>Start typing to search sessions</p>
              <p className="text-xs text-gray-600 mt-1">
                Search by prompt, project name, or content
              </p>
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between text-[10px] text-gray-600">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="bg-gray-800 px-1 rounded">↑↓</kbd> Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-gray-800 px-1 rounded">↵</kbd> Select
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="bg-gray-800 px-1 rounded">Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
