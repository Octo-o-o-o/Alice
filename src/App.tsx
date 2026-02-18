import { useState, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  FileText,
  ListTodo,
  Settings,
  Star,
  Zap,
} from "lucide-react";

import WorkspaceView from "./views/WorkspaceView";
import FavoriteView from "./views/FavoriteView";
import UsageView from "./views/UsageView";
import ReportView from "./views/ReportView";
import ConfigView from "./views/ConfigView";
import OnboardingWizard from "./components/OnboardingWizard";
import { ToastProvider } from "./contexts/ToastContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import type { AppConfig } from "./lib/types";

type ViewType = "tasks" | "favorites" | "usage" | "report" | "settings";

type IconComponent = React.ComponentType<{ size?: number }>;

interface TabDefinition {
  id: ViewType;
  icon: IconComponent;
  label: string;
}

const TABS: TabDefinition[] = [
  { id: "tasks", icon: ListTodo, label: "Tasks" },
  { id: "favorites", icon: Star, label: "Favorites" },
  { id: "usage", icon: Zap, label: "Usage" },
  { id: "report", icon: FileText, label: "Report" },
  { id: "settings", icon: Settings, label: "Settings" },
];

const SHORTCUT_VIEW_MAP: Record<string, ViewType> = {
  n: "tasks",
  ",": "settings",
};

interface TabProps {
  tab: TabDefinition;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
}

function ViewTab({ tab, isActive, onClick, badge }: TabProps): ReactElement {
  const Icon = tab.icon;
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center px-2 h-full space-y-0.5 transition-colors no-drag ${
        isActive ? "text-blue-400" : "text-gray-500 hover:text-gray-300"
      }`}
    >
      <div className="relative">
        <Icon size={16} />
        {badge != null && badge > 0 && (
          <span className="absolute -top-1 -right-2 bg-blue-500 text-white text-[8px] font-medium rounded-full w-3.5 h-3.5 flex items-center justify-center">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </div>
      <span className="text-[9px] font-medium">{tab.label}</span>
    </button>
  );
}

function App(): ReactElement {
  const [activeView, setActiveView] = useState<ViewType>("tasks");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [taskCount, setTaskCount] = useState(0);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const viewRef = useRef<{ refresh?: () => void }>(null);

  useEffect(() => {
    invoke<AppConfig>("get_config", {})
      .then((config) => {
        if (!config.onboarding_completed) {
          setShowOnboarding(true);
        }
      })
      .catch((error) => console.error("Failed to load config:", error))
      .finally(() => setIsLoading(false));
  }, []);

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey)) return;

      // Direct view shortcuts (Cmd+N -> tasks, Cmd+, -> settings)
      const mappedView = SHORTCUT_VIEW_MAP[e.key];
      if (mappedView) {
        e.preventDefault();
        setActiveView(mappedView);
        return;
      }

      // Refresh shortcut
      if (e.key === "r") {
        e.preventDefault();
        setRefreshKey((k) => k + 1);
        viewRef.current?.refresh?.();
        return;
      }

      // Numeric tab shortcuts (Cmd+1 through Cmd+5)
      const tabIndex = parseInt(e.key) - 1;
      if (tabIndex >= 0 && tabIndex < TABS.length) {
        e.preventDefault();
        setActiveView(TABS[tabIndex].id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const tasksBadge = activeSessionCount + taskCount;

  function renderView(): ReactElement {
    switch (activeView) {
      case "tasks":
        return (
          <WorkspaceView
            key={refreshKey}
            onTaskCountChange={setTaskCount}
            onActiveSessionCountChange={setActiveSessionCount}
          />
        );
      case "favorites":
        return <FavoriteView key={refreshKey} />;
      case "usage":
        return <UsageView key={refreshKey} />;
      case "report":
        return <ReportView key={refreshKey} />;
      case "settings":
        return <ConfigView key={refreshKey} />;
    }
  }

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
          <div className="h-3 drag-region shrink-0 bg-gray-950/80" />

          <main className="flex-1 overflow-hidden">{renderView()}</main>

          <nav className="h-12 border-t border-white/5 bg-gray-950/80 backdrop-blur-xl flex items-center justify-center gap-6 px-4 shrink-0">
            {TABS.map((tab) => (
              <ViewTab
                key={tab.id}
                tab={tab}
                isActive={activeView === tab.id}
                onClick={() => setActiveView(tab.id)}
                badge={tab.id === "tasks" ? tasksBadge : undefined}
              />
            ))}
          </nav>

          {showOnboarding && (
            <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
          )}
        </div>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
