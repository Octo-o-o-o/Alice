import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ListTodo,
  Star,
  Zap,
  Clock,
  Settings,
} from "lucide-react";

import TaskView from "./views/TaskView";
import FavoriteView from "./views/FavoriteView";
import UsageView from "./views/UsageView";
import HistoryView, { HistoryViewRef } from "./views/HistoryView";
import ConfigView from "./views/ConfigView";
import OnboardingWizard from "./components/OnboardingWizard";
import { ToastProvider } from "./contexts/ToastContext";
import { ThemeProvider } from "./contexts/ThemeContext";

interface AppConfig {
  onboarding_completed: boolean;
}

type ViewType = "tasks" | "favorites" | "history" | "usage" | "settings";

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
      className={`flex flex-col items-center justify-center px-2 h-full space-y-0.5 transition-colors no-drag ${
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
  const [activeView, setActiveView] = useState<ViewType>("tasks");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [taskCount, setTaskCount] = useState(0);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const viewRef = useRef<{ refresh?: () => void }>(null);
  const historyViewRef = useRef<HistoryViewRef>(null);

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
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K for search - switch to history and focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setActiveView("history");
        setTimeout(() => {
          historyViewRef.current?.focusSearch();
        }, 50);
      }

      // Cmd+N for new task
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setActiveView("tasks");
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
        setActiveView("settings");
      }

      // Cmd+1-5 for tab switching
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        const views: ViewType[] = ["tasks", "favorites", "history", "usage", "settings"];
        const index = parseInt(e.key) - 1;
        if (index >= 0 && index < views.length) {
          setActiveView(views[index]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Combined badge for Tasks tab (active sessions + pending tasks)
  const tasksBadge = activeSessionCount + taskCount;

  const renderView = () => {
    switch (activeView) {
      case "tasks":
        return (
          <TaskView
            key={refreshKey}
            onTaskCountChange={setTaskCount}
            onActiveSessionCountChange={setActiveSessionCount}
          />
        );
      case "favorites":
        return <FavoriteView key={refreshKey} />;
      case "history":
        return <HistoryView key={refreshKey} ref={historyViewRef} />;
      case "usage":
        return <UsageView key={refreshKey} />;
      case "settings":
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
    <ThemeProvider>
      <ToastProvider>
        <div className="h-full flex flex-col glass-panel overflow-hidden">
        {/* Drag region for window */}
        <div className="h-3 drag-region shrink-0 bg-gray-950/80" />

        {/* Main content area */}
        <main className="flex-1 overflow-hidden">{renderView()}</main>

        {/* Bottom navigation */}
        <nav className="h-12 border-t border-white/5 bg-gray-950/80 backdrop-blur-xl flex items-center justify-center gap-6 px-4 shrink-0">
          <ViewTab
            icon={ListTodo}
            label="Tasks"
            isActive={activeView === "tasks"}
            onClick={() => setActiveView("tasks")}
            badge={tasksBadge}
          />
          <ViewTab
            icon={Star}
            label="Favorites"
            isActive={activeView === "favorites"}
            onClick={() => setActiveView("favorites")}
          />
          <ViewTab
            icon={Clock}
            label="History"
            isActive={activeView === "history"}
            onClick={() => setActiveView("history")}
          />
          <ViewTab
            icon={Zap}
            label="Usage"
            isActive={activeView === "usage"}
            onClick={() => setActiveView("usage")}
          />
          <ViewTab
            icon={Settings}
            label="Settings"
            isActive={activeView === "settings"}
            onClick={() => setActiveView("settings")}
          />
        </nav>

        {/* Onboarding wizard */}
        {showOnboarding && (
          <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
        )}
      </div>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
