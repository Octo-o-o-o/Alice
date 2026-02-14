import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Activity,
  ListTodo,
  Zap,
  Clock,
  Settings,
  Search,
} from "lucide-react";

import ActiveView from "./views/ActiveView";
import TasksView from "./views/TasksView";
import UsageView from "./views/UsageView";
import HistoryView from "./views/HistoryView";
import ConfigView from "./views/ConfigView";
import SearchOverlay from "./components/SearchOverlay";
import OnboardingWizard from "./components/OnboardingWizard";
import { ToastProvider } from "./contexts/ToastContext";

interface AppConfig {
  onboarding_completed: boolean;
}

type ViewType = "active" | "tasks" | "usage" | "history" | "config";

interface TabProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
}

function ViewTab({ icon: Icon, label, isActive, onClick, badge }: TabProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-full h-full space-y-0.5 transition-colors no-drag ${
        isActive ? "text-blue-400" : "text-gray-500 hover:text-gray-300"
      }`}
    >
      <div className="relative">
        <Icon size={16} />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1 -right-2 bg-blue-500 text-white text-[8px] font-medium rounded-full w-3.5 h-3.5 flex items-center justify-center">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </div>
      <span className="text-[9px] font-medium">{label}</span>
    </button>
  );
}

function App() {
  const [activeView, setActiveView] = useState<ViewType>("active");
  const [showSearch, setShowSearch] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [taskCount, setTaskCount] = useState(0);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const viewRef = useRef<{ refresh?: () => void }>(null);

  // Check if onboarding is needed
  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const config = await invoke<AppConfig>("get_config", {});
        if (!config.onboarding_completed) {
          setShowOnboarding(true);
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      } finally {
        setIsLoading(false);
      }
    };
    checkOnboarding();
  }, []);

  // Listen for session updates from Rust backend
  useEffect(() => {
    const unlisten = listen<{ session_id: string; status: string }>(
      "session-updated",
      (event) => {
        console.log("Session updated:", event.payload);
        // Trigger refresh of active sessions
        // This will be handled by the ActiveView component
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K for search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }

      // Cmd+N for new task
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setActiveView("tasks");
        // Focus on task input will be handled by TasksView
      }

      // Cmd+R for refresh
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        setRefreshKey((k) => k + 1);
        viewRef.current?.refresh?.();
      }

      // Cmd+, for settings
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setActiveView("config");
      }

      // Cmd+1-5 for tab switching
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        const views: ViewType[] = ["active", "tasks", "usage", "history", "config"];
        const index = parseInt(e.key) - 1;
        if (index >= 0 && index < views.length) {
          setActiveView(views[index]);
        }
      }

      // Escape to close search or dismiss
      if (e.key === "Escape") {
        setShowSearch(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const renderView = () => {
    switch (activeView) {
      case "active":
        return <ActiveView key={refreshKey} onSessionCountChange={setActiveSessionCount} />;
      case "tasks":
        return <TasksView key={refreshKey} onTaskCountChange={setTaskCount} />;
      case "usage":
        return <UsageView key={refreshKey} />;
      case "history":
        return <HistoryView key={refreshKey} />;
      case "config":
        return <ConfigView key={refreshKey} />;
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-950">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="h-full flex flex-col glass-panel overflow-hidden">
        {/* Header with search */}
        <header className="h-10 border-b border-white/5 bg-gray-950/80 backdrop-blur-xl flex items-center px-3 drag-region shrink-0">
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-2 flex-1 bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-sm text-gray-400 hover:bg-white/8 hover:text-gray-300 transition-colors no-drag"
          >
            <Search size={14} />
            <span className="text-xs">Search sessions...</span>
            <kbd className="ml-auto text-[10px] text-gray-600 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 font-mono">
              ⌘K
            </kbd>
          </button>
        </header>

        {/* Main content area */}
        <main className="flex-1 overflow-hidden">{renderView()}</main>

        {/* Bottom navigation */}
        <nav className="h-12 border-t border-white/5 bg-gray-950/80 backdrop-blur-xl flex items-center justify-around px-2 shrink-0">
          <ViewTab
            icon={Activity}
            label="Active"
            isActive={activeView === "active"}
            onClick={() => setActiveView("active")}
            badge={activeSessionCount}
          />
          <ViewTab
            icon={ListTodo}
            label="Tasks"
            isActive={activeView === "tasks"}
            onClick={() => setActiveView("tasks")}
            badge={taskCount}
          />
          <ViewTab
            icon={Zap}
            label="Usage"
            isActive={activeView === "usage"}
            onClick={() => setActiveView("usage")}
          />
          <ViewTab
            icon={Clock}
            label="History"
            isActive={activeView === "history"}
            onClick={() => setActiveView("history")}
          />
          <ViewTab
            icon={Settings}
            label="Config"
            isActive={activeView === "config"}
            onClick={() => setActiveView("config")}
          />
        </nav>

        {/* Search overlay */}
        {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}

        {/* Onboarding wizard */}
        {showOnboarding && (
          <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
        )}
      </div>
    </ToastProvider>
  );
}

export default App;
