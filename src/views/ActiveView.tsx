import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Inbox } from "lucide-react";
import SessionCard from "../components/SessionCard";
import { Session } from "../lib/types";

interface ActiveViewProps {
  onSessionCountChange: (count: number) => void;
}

export default function ActiveView({ onSessionCountChange }: ActiveViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

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

  // Group sessions by project
  const projectGroups = sessions.reduce((acc, session) => {
    const project = session.project_name;
    if (!acc[project]) {
      acc[project] = [];
    }
    acc[project].push(session);
    return acc;
  }, {} as Record<string, Session[]>);

  const filteredSessions = selectedProject
    ? sessions.filter((s) => s.project_name === selectedProject)
    : sessions;

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
      {/* Project filter */}
      {Object.keys(projectGroups).length > 1 && (
        <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 overflow-x-auto shrink-0">
          <button
            onClick={() => setSelectedProject(null)}
            className={`px-2 py-1 text-xs rounded-full shrink-0 transition-colors ${
              !selectedProject
                ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                : "text-gray-400 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            All Projects
          </button>
          {Object.keys(projectGroups).map((project) => (
            <button
              key={project}
              onClick={() => setSelectedProject(project)}
              className={`px-2 py-1 text-xs rounded-full shrink-0 transition-colors flex items-center gap-1 ${
                selectedProject === project
                  ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                  : "text-gray-400 hover:text-gray-300 hover:bg-white/5"
              }`}
            >
              <FolderOpen size={10} />
              {project}
              <span className="text-[10px] opacity-70">
                ({projectGroups[project].length})
              </span>
            </button>
          ))}
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
