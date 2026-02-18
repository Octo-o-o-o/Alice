import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  HashRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  Clipboard,
  Command,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  Inbox,
  ListChecks,
  Loader2,
  Pause,
  Play,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Star,
  Terminal,
  UserCheck,
} from "lucide-react";

import ActiveView from "./views/ActiveView";
import ConfigView from "./views/ConfigView";
import FavoriteView from "./views/FavoriteView";
import HistoryView from "./views/HistoryView";
import OnboardingWizard from "./components/OnboardingWizard";
import ReportsView from "./views/ReportsView";
import UsageView from "./views/UsageView";
import { useToast } from "./contexts/ToastContext";
import type {
  AppConfig,
  ProviderStatus,
  QueueStatusEvent,
  Session,
  Task,
  ToolGate,
  WindowContext,
} from "./lib/types";
import {
  SAMPLE_ARTIFACTS,
  SAMPLE_GATES,
  SAMPLE_PHASES,
  SAMPLE_RUNS,
  TOOL_MANIFESTS,
} from "./lib/tool-platform";
import {
  getWindowContext,
  openMainWindow,
  openQuickWindow,
} from "./lib/window-system";
import { ToastProvider } from "./contexts/ToastContext";
import { ThemeProvider } from "./contexts/ThemeContext";

// ---------------------------------------------------------------------------
// Route metadata for Command Palette
// ---------------------------------------------------------------------------

interface RouteMeta {
  path: string;
  label: string;
  window: "quick" | "main";
}

const QUICK_ROUTE_META: RouteMeta[] = [
  { path: "/quick/home", label: "Quick Home", window: "quick" },
  { path: "/quick/inbox", label: "Quick Inbox", window: "quick" },
  { path: "/quick/running", label: "Running Now", window: "quick" },
  { path: "/quick/tasks", label: "Quick Tasks", window: "quick" },
  { path: "/quick/usage", label: "Quick Usage", window: "quick" },
  { path: "/quick/jump", label: "Jump To Main", window: "quick" },
];

const MAIN_ROUTE_META: RouteMeta[] = [
  { path: "/app/home", label: "Home", window: "main" },
  { path: "/app/sessions/active", label: "Sessions Active", window: "main" },
  { path: "/app/sessions/history", label: "Sessions History", window: "main" },
  { path: "/app/tasks/queue", label: "Task Queue", window: "main" },
  { path: "/app/tasks/backlog", label: "Task Backlog", window: "main" },
  { path: "/app/tasks/favorites", label: "Task Favorites", window: "main" },
  { path: "/app/runs", label: "Run Center", window: "main" },
  { path: "/app/tools", label: "Tool Hub", window: "main" },
  { path: "/app/reports/daily", label: "Daily Report", window: "main" },
  { path: "/app/usage", label: "Usage", window: "main" },
  { path: "/app/providers", label: "Providers", window: "main" },
  { path: "/app/settings/general", label: "Settings", window: "main" },
];

const ALL_ROUTE_META = [...QUICK_ROUTE_META, ...MAIN_ROUTE_META];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function statusDot(status: string): string {
  switch (status) {
    case "running": return "bg-blue-400 animate-pulse";
    case "completed": return "bg-green-500";
    case "failed": case "error": return "bg-red-500";
    case "blocked": case "needs_input": return "bg-amber-400";
    default: return "bg-gray-500";
  }
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function App(): React.ReactElement {
  return (
    <ThemeProvider>
      <ToastProvider>
        <HashRouter>
          <WindowSystemRouter />
        </HashRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------------------
// Window system router — decides quick vs main shell
// ---------------------------------------------------------------------------

function WindowSystemRouter(): React.ReactElement {
  const [windowContext, setWindowContext] = useState<WindowContext | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    async function load() {
      try {
        const [context, config] = await Promise.all([
          getWindowContext(),
          invoke<AppConfig>("get_config"),
        ]);
        setWindowContext(context);
        if (!config.onboarding_completed) setShowOnboarding(true);
      } catch (error) {
        console.error("Failed to initialize app:", error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (windowContext && location.pathname === "/") {
      navigate(windowContext.default_route, { replace: true });
    }
  }, [windowContext, location.pathname, navigate]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((p) => !p);
      } else if (e.key === "Escape") {
        setShowPalette(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const unlisten = listen<{ route: string }>("alice://navigate", (ev) => navigate(ev.payload.route));
    return () => { unlisten.then((fn) => fn()); };
  }, [navigate]);

  if (loading || !windowContext) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-950">
        <Loader2 size={20} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} currentRole={windowContext.role} />
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      {windowContext.role === "quick" ? (
        <QuickWindowShell onOpenPalette={() => setShowPalette(true)} />
      ) : (
        <MainWindowShell onOpenPalette={() => setShowPalette(true)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Command Palette (§3.3 — global Cmd/Ctrl+K)
// ---------------------------------------------------------------------------

function CommandPalette({ open, onClose, currentRole }: {
  open: boolean; onClose: () => void; currentRole: "quick" | "main";
}): React.ReactElement | null {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const options = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return ALL_ROUTE_META;
    return ALL_ROUTE_META.filter((r) => r.label.toLowerCase().includes(kw) || r.path.toLowerCase().includes(kw));
  }, [query]);

  if (!open) return null;

  async function activate(route: RouteMeta) {
    if (route.window === currentRole) navigate(route.path);
    else if (route.window === "main") await openMainWindow(route.path);
    else await openQuickWindow(route.path);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-start justify-center pt-20">
      <div className="w-[560px] max-w-[92vw] rounded-xl border border-white/10 bg-gray-950 shadow-2xl">
        <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
          <Command size={16} className="text-blue-400" />
          <input value={query} autoFocus onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索页面或输入路由..." className="flex-1 bg-transparent outline-none text-sm text-gray-100 placeholder:text-gray-500" />
          <kbd className="text-[10px] text-gray-500 border border-white/10 rounded px-1">ESC</kbd>
        </div>
        <div className="max-h-[380px] overflow-y-auto p-2 space-y-0.5">
          {options.map((item) => (
            <button key={`${item.window}-${item.path}`} onClick={() => activate(item)}
              className="w-full px-3 py-2 rounded-lg text-left hover:bg-white/5 transition-colors">
              <p className="text-sm text-gray-100">{item.label}</p>
              <p className="text-[11px] text-gray-500">{item.window.toUpperCase()} · {item.path}</p>
            </button>
          ))}
          {options.length === 0 && <p className="text-xs text-gray-500 px-2 py-3">无匹配路由</p>}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// QUICK WINDOW
// ===========================================================================

function QuickWindowShell({ onOpenPalette }: { onOpenPalette: () => void }): React.ReactElement {
  const navigate = useNavigate();

  // §3.3 keyboard shortcuts for quick window
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "1": navigate("/quick/home"); break;
        case "2": navigate("/quick/inbox"); break;
        case "3": navigate("/quick/running"); break;
        case "4": navigate("/quick/tasks"); break;
        case "t": case "T": openMainWindow("/app/sessions/active"); break;
        case "n": case "N": navigate("/quick/tasks"); break;
        case "j": case "J": navigate("/quick/jump"); break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const tabs = [
    { path: "/quick/home", label: "Home", key: "1" },
    { path: "/quick/inbox", label: "Inbox", key: "2" },
    { path: "/quick/running", label: "Run", key: "3" },
    { path: "/quick/tasks", label: "Tasks", key: "4" },
  ];

  return (
    <div className="h-full flex flex-col glass-panel overflow-hidden">
      <div className="h-3 drag-region shrink-0 bg-gray-950/80" />
      {/* Tab bar */}
      <nav className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 bg-gray-950/80 shrink-0">
        {tabs.map((tab) => (
          <NavLink key={tab.path} to={tab.path} className={({ isActive }) =>
            `px-2 py-1 rounded text-[11px] transition-colors ${isActive ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-white/5"}`}>
            {tab.label}<span className="ml-1 text-[9px] opacity-40">{tab.key}</span>
          </NavLink>
        ))}
        <div className="flex-1" />
        <button onClick={onOpenPalette} className="p-1 text-gray-500 hover:text-gray-200" title="Cmd/Ctrl+K">
          <Search size={12} />
        </button>
      </nav>
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/quick/home" element={<QuickHomePage />} />
          <Route path="/quick/inbox" element={<QuickInboxPage />} />
          <Route path="/quick/inbox/:itemId" element={<QuickInboxItemPage />} />
          <Route path="/quick/running" element={<QuickRunningPage />} />
          <Route path="/quick/runs/:runId" element={<QuickRunPage />} />
          <Route path="/quick/gates/:gateId" element={<QuickGatePage />} />
          <Route path="/quick/tasks" element={<QuickTasksPage />} />
          <Route path="/quick/usage" element={<QuickUsagePage />} />
          <Route path="/quick/jump" element={<QuickJumpPage />} />
          <Route path="*" element={<Navigate to="/quick/home" replace />} />
        </Routes>
      </main>
      {/* Footer: open main window deep link */}
      <footer className="px-3 py-1.5 border-t border-white/10 bg-gray-950/80 shrink-0">
        <button onClick={() => openMainWindow("/app/home")}
          className="w-full flex items-center justify-center gap-1 text-[10px] text-blue-400 hover:text-blue-300">
          Open Main Window <ArrowRight size={10} />
        </button>
      </footer>
    </div>
  );
}

// §5 Quick Home — full IA sketch
function QuickHomePage(): React.ReactElement {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const gates = SAMPLE_GATES;
  const runs = SAMPLE_RUNS;

  useEffect(() => {
    async function load() {
      try {
        const [s, t, p, q] = await Promise.all([
          invoke<Session[]>("get_active_sessions"),
          invoke<Task[]>("get_tasks"),
          invoke<ProviderStatus[]>("get_provider_statuses"),
          invoke<boolean>("get_queue_status"),
        ]);
        setSessions(s); setTasks(t); setProviders(p); setQueueRunning(q);
      } catch (e) { console.error("Quick load failed:", e); }
    }
    load();
    const interval = setInterval(load, 5000);
    const unsub = listen<QueueStatusEvent>("queue-status", (ev) => setQueueRunning(ev.payload.is_running));
    return () => { clearInterval(interval); unsub.then((fn) => fn()); };
  }, []);

  const enabledProviders = providers.filter((p) => p.enabled);
  const queuedCount = tasks.filter((t) => t.status === "queued" || t.status === "running").length;
  const inboxItems: { id: string; label: string; type: "gate" | "error" | "input"; to: string }[] = [];

  for (const g of gates.filter((x) => x.decision === "pending")) {
    inboxItems.push({ id: g.gate_id, label: `Gate: ${g.title}`, type: "gate", to: `/quick/gates/${g.gate_id}` });
  }
  for (const t of tasks.filter((x) => x.status === "failed")) {
    inboxItems.push({ id: `task-${t.id}`, label: `Failed: ${t.prompt.slice(0, 50)}`, type: "error", to: `/quick/tasks` });
  }
  for (const s of sessions.filter((x) => x.status === "needs_input")) {
    inboxItems.push({ id: `sess-${s.session_id}`, label: `Needs input: ${s.project_name}`, type: "input", to: `/quick/running` });
  }

  const recentCompleted = tasks.filter((t) => t.status === "completed").slice(0, 3);
  const runningRuns = runs.filter((r) => r.status === "running");

  return (
    <div className="h-full overflow-y-auto p-3 space-y-2.5">
      {/* Top Status: Provider Health / Queue */}
      <QuickCard title="Provider Health / Queue">
        <div className="flex items-center gap-3 flex-wrap">
          {enabledProviders.map((p) => (
            <span key={p.id} className="flex items-center gap-1 text-[11px]">
              <span className={`w-1.5 h-1.5 rounded-full ${p.installed ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-gray-300">{p.display_name}</span>
            </span>
          ))}
          <span className="text-[11px] text-gray-500">|</span>
          <span className="flex items-center gap-1 text-[11px]">
            <Activity size={10} className={queueRunning ? "text-blue-400" : "text-gray-500"} />
            <span className="text-gray-300">Queue: {queuedCount} {queueRunning ? "(running)" : "(idle)"}</span>
          </span>
        </div>
      </QuickCard>

      {/* Inbox */}
      <QuickCard title={`Inbox (${inboxItems.length})`}>
        {inboxItems.length === 0 ? (
          <p className="text-[11px] text-gray-500">All clear.</p>
        ) : (
          inboxItems.slice(0, 5).map((item) => (
            <Link key={item.id} to={item.to} className="flex items-center gap-2 py-1 text-xs hover:bg-white/5 rounded px-1 -mx-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.type === "gate" ? "bg-amber-400" : item.type === "error" ? "bg-red-500" : "bg-blue-400"}`} />
              <span className="text-gray-200 truncate">{item.label}</span>
            </Link>
          ))
        )}
      </QuickCard>

      {/* Running Now */}
      <QuickCard title="Running Now">
        {sessions.filter((s) => s.status === "active").slice(0, 3).map((s) => (
          <div key={s.session_id} className="flex items-center gap-2 py-1 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
            <span className="text-gray-200 truncate flex-1">{s.project_name}</span>
            <span className="text-gray-500">{relativeTime(s.last_active_at)}</span>
          </div>
        ))}
        {runningRuns.map((r) => (
          <Link key={r.run_id} to={`/quick/runs/${r.run_id}`} className="flex items-center gap-2 py-1 text-[11px] hover:bg-white/5 rounded px-1 -mx-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
            <span className="text-gray-200">{r.run_id} / {r.current_phase_id}</span>
            <span className="text-gray-500 ml-auto">{r.provider}</span>
          </Link>
        ))}
        {sessions.filter((s) => s.status === "active").length === 0 && runningRuns.length === 0 && (
          <p className="text-[11px] text-gray-500">Nothing running.</p>
        )}
      </QuickCard>

      {/* Quick Actions */}
      <QuickCard title="Quick Actions">
        <div className="grid grid-cols-3 gap-1.5">
          <QABtn icon={<Plus size={12} />} label="New Task" shortcut="N" onClick={() => openMainWindow("/app/tasks/backlog")} />
          <QABtn icon={<Star size={12} />} label="Favorites" onClick={() => openMainWindow("/app/tasks/favorites")} />
          <QABtn icon={<Pause size={12} />} label="Pause Q" onClick={async () => { try { await invoke("stop_queue"); } catch {} }} />
          <QABtn icon={<Play size={12} />} label="Start Q" onClick={async () => { try { await invoke("start_queue"); } catch {} }} />
          <QABtn icon={<Terminal size={12} />} label="Terminal" shortcut="T" onClick={() => openMainWindow("/app/sessions/active")} />
          <QABtn icon={<ArrowRight size={12} />} label="Jump" shortcut="J" onClick={() => openMainWindow("/app/home")} />
        </div>
      </QuickCard>

      {/* Recent Completed */}
      {recentCompleted.length > 0 && (
        <QuickCard title="Recent Completed">
          {recentCompleted.map((t) => (
            <div key={t.id} className="flex items-center gap-2 py-0.5 text-[11px]">
              <CheckCircle size={10} className="text-green-500 shrink-0" />
              <span className="text-gray-300 truncate">{t.prompt}</span>
            </div>
          ))}
        </QuickCard>
      )}
    </div>
  );
}

function QABtn({ icon, label, shortcut, onClick }: {
  icon: React.ReactNode; label: string; shortcut?: string; onClick: () => void;
}): React.ReactElement {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 py-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] transition-colors">
      {icon}
      <span className="text-[10px] text-gray-300">{label}</span>
      {shortcut && <kbd className="text-[8px] text-gray-600">{shortcut}</kbd>}
    </button>
  );
}

// Quick Inbox — shows real failures + needs_input + gates
function QuickInboxPage(): React.ReactElement {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => {
    Promise.all([invoke<Task[]>("get_tasks"), invoke<Session[]>("get_active_sessions")])
      .then(([t, s]) => { setTasks(t); setSessions(s); })
      .catch(console.error);
  }, []);

  const items: { id: string; label: string; detail: string; type: string; to: string }[] = [];
  for (const g of SAMPLE_GATES.filter((x) => x.decision === "pending")) {
    items.push({ id: g.gate_id, label: g.title, detail: g.reason, type: "gate", to: `/quick/gates/${g.gate_id}` });
  }
  for (const t of tasks.filter((x) => x.status === "failed")) {
    items.push({ id: t.id, label: `Task failed: ${t.prompt.slice(0, 60)}`, detail: t.result_output?.slice(0, 80) ?? "", type: "error", to: `/quick/tasks` });
  }
  for (const s of sessions.filter((x) => x.status === "needs_input")) {
    items.push({ id: s.session_id, label: `Needs input: ${s.project_name}`, detail: s.first_prompt?.slice(0, 80) ?? "", type: "input", to: `/quick/running` });
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-2">
      {items.length === 0 && <p className="text-xs text-gray-500 text-center py-8">No pending items.</p>}
      {items.map((item) => (
        <Link key={item.id} to={item.to}
          className={`block p-3 rounded-lg border ${item.type === "gate" ? "border-amber-500/30 bg-amber-500/10" : item.type === "error" ? "border-red-500/30 bg-red-500/10" : "border-blue-500/30 bg-blue-500/10"}`}>
          <p className="text-xs font-medium text-gray-100">{item.label}</p>
          {item.detail && <p className="text-[11px] text-gray-400 mt-1 truncate">{item.detail}</p>}
        </Link>
      ))}
    </div>
  );
}

function QuickInboxItemPage(): React.ReactElement {
  const { itemId } = useParams();
  const gate = SAMPLE_GATES.find((g) => g.gate_id === itemId);
  if (!gate) return <QuickNotFound label="Inbox item not found" />;
  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <QuickCard title={gate.title}><p className="text-xs text-gray-300">{gate.reason}</p></QuickCard>
      <GateActionButtons gate={gate} />
    </div>
  );
}

function QuickRunningPage(): React.ReactElement {
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => {
    invoke<Session[]>("get_active_sessions").then(setSessions).catch(console.error);
    const interval = setInterval(() => invoke<Session[]>("get_active_sessions").then(setSessions).catch(console.error), 5000);
    return () => clearInterval(interval);
  }, []);

  const running = SAMPLE_RUNS.filter((r) => r.status === "running");
  const activeSessions = sessions.filter((s) => s.status === "active" || s.status === "needs_input");

  return (
    <div className="h-full overflow-y-auto p-3 space-y-2">
      {running.map((run) => (
        <Link key={run.run_id} to={`/quick/runs/${run.run_id}`}
          className="block p-3 rounded-lg border border-blue-500/20 bg-blue-500/10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-xs text-blue-300 font-medium">{run.run_id}</span>
            <span className="text-xs text-gray-400 ml-auto">{run.provider}</span>
          </div>
          <p className="text-sm text-gray-100 mt-1">{run.project_name}</p>
          <p className="text-[11px] text-gray-400">Phase: {run.current_phase_id} · {relativeTime(run.updated_at)}</p>
        </Link>
      ))}
      {activeSessions.map((s) => (
        <div key={s.session_id} className="p-3 rounded-lg border border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusDot(s.status)}`} />
            <span className="text-xs text-gray-200 font-medium truncate">{s.project_name}</span>
            <span className="text-[10px] text-gray-500 ml-auto">{s.provider}</span>
          </div>
          {s.first_prompt && <p className="text-[11px] text-gray-400 mt-1 truncate">{s.first_prompt}</p>}
        </div>
      ))}
      {running.length === 0 && activeSessions.length === 0 && (
        <p className="text-xs text-gray-500 text-center py-8">Nothing running.</p>
      )}
    </div>
  );
}

function QuickRunPage(): React.ReactElement {
  const { runId } = useParams();
  const run = SAMPLE_RUNS.find((r) => r.run_id === runId);
  if (!run) return <QuickNotFound label="Run not found" />;
  const phases = SAMPLE_PHASES[run.run_id] ?? [];
  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <QuickCard title={`Run ${run.run_id}`}>
        <div className="space-y-1 text-xs text-gray-300">
          <p>Provider: {run.provider} · Status: {run.status}</p>
          <p>Current Phase: {run.current_phase_id ?? "—"}</p>
          {phases.map((ph) => (
            <div key={ph.phase_id} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot(ph.status)}`} />
              <span>{ph.phase_id}: {ph.name}</span>
            </div>
          ))}
        </div>
      </QuickCard>
      <TerminalBridgeButtons label={`Run ${run.run_id}`} copyText={`alice tool status --run ${run.run_id}`} />
      <button onClick={() => openMainWindow(`/app/runs/${run.run_id}/phases/${run.current_phase_id ?? "P-01"}`)}
        className="w-full px-3 py-2 text-xs rounded bg-blue-600 hover:bg-blue-500">
        Open in Main Window
      </button>
    </div>
  );
}

function QuickGatePage(): React.ReactElement {
  const { gateId } = useParams();
  const gate = SAMPLE_GATES.find((g) => g.gate_id === gateId);
  if (!gate) return <QuickNotFound label="Gate not found" />;
  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <QuickCard title={gate.title}><p className="text-xs text-gray-300">{gate.reason}</p></QuickCard>
      <GateActionButtons gate={gate} />
      <TerminalBridgeButtons label={`Gate ${gate.gate_id}`} copyText={`alice tool gate approve --gate ${gate.gate_id}`} />
      <button onClick={() => openMainWindow(`/app/runs/${gate.run_id}/gates`)}
        className="w-full px-3 py-2 text-xs rounded bg-white/10 hover:bg-white/15">Open Gate History in Main</button>
    </div>
  );
}

function GateActionButtons({ gate }: { gate: ToolGate }): React.ReactElement {
  const toast = useToast();
  async function act(action: "approve" | "reject" | "defer") {
    try {
      await invoke("tool_gate_decide", { gateId: gate.gate_id, decision: action });
      toast.success(`Gate ${action}d`);
    } catch {
      toast.info(`Gate ${action} (local only)`);
    }
  }
  // §3.3 keyboard shortcuts A/R/D
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "a" || e.key === "A") act("approve");
      if (e.key === "r" || e.key === "R") act("reject");
      if (e.key === "d" || e.key === "D") act("defer");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid grid-cols-3 gap-2">
      <button onClick={() => act("approve")} className="py-2 text-xs rounded bg-green-600/80 hover:bg-green-600">
        Approve <kbd className="text-[8px] opacity-60 ml-1">A</kbd>
      </button>
      <button onClick={() => act("reject")} className="py-2 text-xs rounded bg-red-600/80 hover:bg-red-600">
        Reject <kbd className="text-[8px] opacity-60 ml-1">R</kbd>
      </button>
      <button onClick={() => act("defer")} className="py-2 text-xs rounded bg-amber-600/80 hover:bg-amber-600">
        Defer <kbd className="text-[8px] opacity-60 ml-1">D</kbd>
      </button>
    </div>
  );
}

function QuickTasksPage(): React.ReactElement {
  const [tasks, setTasks] = useState<Task[]>([]);
  const toast = useToast();
  useEffect(() => { invoke<Task[]>("get_tasks").then(setTasks).catch(console.error); }, []);

  async function createQuickTask() {
    const prompt = window.prompt("Task prompt:");
    if (!prompt?.trim()) return;
    try {
      await invoke("create_task", { prompt: prompt.trim(), project: null, priority: "medium", notes: null });
      toast.success("Task created");
      invoke<Task[]>("get_tasks").then(setTasks);
    } catch { toast.error("Failed to create task"); }
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-2">
      <button onClick={createQuickTask} className="w-full flex items-center justify-center gap-1 py-2 text-xs rounded bg-blue-600 hover:bg-blue-500">
        <Plus size={12} /> New Task
      </button>
      {tasks.slice(0, 8).map((t) => (
        <div key={t.id} className="flex items-center gap-2 py-1.5 px-2 rounded bg-white/[0.03] text-[11px]">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(t.status)}`} />
          <span className="text-gray-200 truncate flex-1">{t.prompt}</span>
          <span className="text-gray-500">{t.status}</span>
        </div>
      ))}
      {tasks.length === 0 && <p className="text-xs text-gray-500 text-center py-4">No tasks.</p>}
    </div>
  );
}

function QuickUsagePage(): React.ReactElement {
  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <QuickCard title="Usage Snapshot">
        <p className="text-xs text-gray-300">完整用量请在主窗口查看。</p>
      </QuickCard>
      <button onClick={() => openMainWindow("/app/usage")} className="w-full px-3 py-2 text-xs rounded bg-blue-600 hover:bg-blue-500">
        Open Full Usage
      </button>
    </div>
  );
}

function QuickJumpPage(): React.ReactElement {
  const targets = [
    { path: "/app/home", label: "Home" },
    { path: "/app/runs", label: "Run Center" },
    { path: "/app/tools", label: "Tool Hub" },
    { path: "/app/reports/daily", label: "Reports" },
    { path: "/app/sessions/active", label: "Sessions" },
    { path: "/app/tasks/queue", label: "Tasks" },
    { path: "/app/providers", label: "Providers" },
    { path: "/app/settings/general", label: "Settings" },
    { path: "/app/usage", label: "Usage" },
  ];
  return (
    <div className="h-full overflow-y-auto p-3 space-y-1.5">
      {targets.map((t) => (
        <button key={t.path} onClick={() => openMainWindow(t.path)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs rounded border border-white/10 hover:bg-white/5">
          <span className="text-gray-200">{t.label}</span>
          <span className="text-gray-500 text-[10px]">{t.path}</span>
        </button>
      ))}
    </div>
  );
}

// Quick UI primitives

function QuickCard({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
      <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

function QuickNotFound({ label }: { label: string }): React.ReactElement {
  return <div className="h-full flex items-center justify-center text-xs text-gray-500">{label}</div>;
}

// §3.3 Terminal bridging buttons — reusable
function TerminalBridgeButtons({ copyText, path }: {
  label?: string; copyText?: string; path?: string;
}): React.ReactElement {
  const toast = useToast();
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {copyText && (
        <button onClick={() => writeText(copyText).then(() => toast.success("CLI command copied"))}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-gray-300">
          <Clipboard size={10} /> Copy CLI Command
        </button>
      )}
      {path && (
        <>
          <button onClick={() => writeText(path).then(() => toast.success("Path copied"))}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-gray-300">
            <FolderOpen size={10} /> Copy Path
          </button>
          <button onClick={() => invoke("resume_session", { sessionId: "" }).catch(() => {})}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-gray-300">
            <Terminal size={10} /> Open in Terminal
          </button>
          <button onClick={() => invoke("resume_session", { sessionId: "" }).catch(() => {})}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-gray-300">
            <ExternalLink size={10} /> Open in Editor
          </button>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// MAIN WINDOW
// ===========================================================================

function MainWindowShell({ onOpenPalette }: { onOpenPalette: () => void }): React.ReactElement {
  const location = useLocation();
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    invoke<boolean>("get_queue_status").then(setQueueRunning).catch(() => {});
    invoke<Task[]>("get_tasks").then((ts) => setQueueCount(ts.filter((t) => t.status === "queued" || t.status === "running").length)).catch(() => {});
    const unsub = listen<QueueStatusEvent>("queue-status", (ev) => {
      setQueueRunning(ev.payload.is_running);
      setQueueCount(ev.payload.queued_count);
    });
    return () => { unsub.then((fn) => fn()); };
  }, []);

  // §6 breadcrumbs
  const crumbs = location.pathname.split("/").filter(Boolean);

  return (
    <div className="h-full flex flex-col bg-gray-950 text-gray-100">
      {/* §6 Header: search trigger + project switcher + breadcrumbs */}
      <header className="h-11 px-4 border-b border-white/10 flex items-center gap-3 shrink-0 drag-region">
        <Gauge size={14} className="text-blue-400 shrink-0 no-drag" />
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-[11px] text-gray-400 min-w-0 flex-1 no-drag">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={10} className="text-gray-600" />}
              <span className={i === crumbs.length - 1 ? "text-gray-200" : ""}>{c}</span>
            </span>
          ))}
        </nav>
        {/* Search trigger */}
        <button onClick={onOpenPalette}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/8 text-xs text-gray-400 no-drag">
          <Search size={12} /> <span>Search...</span> <kbd className="text-[9px] text-gray-600 ml-2">⌘K</kbd>
        </button>
        <button onClick={() => openQuickWindow("/quick/home")}
          className="text-[10px] px-2 py-1 rounded bg-white/10 hover:bg-white/15 no-drag shrink-0">Quick</button>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* §6 Primary Nav sidebar */}
        <aside className="w-[200px] border-r border-white/10 p-3 overflow-y-auto shrink-0">
          <MainNav />
        </aside>
        {/* Content */}
        <main className="flex-1 min-w-0 overflow-hidden">
          <Routes>
            <Route path="/app/home" element={<MainHomePage />} />
            <Route path="/app/sessions/active" element={<ActiveSessionsRoute />} />
            <Route path="/app/sessions/history" element={<HistoryView />} />
            <Route path="/app/sessions/:sessionId" element={<SessionDetailRoute />} />
            <Route path="/app/tasks/queue" element={<TaskQueueRoute />} />
            <Route path="/app/tasks/backlog" element={<TaskBacklogRoute />} />
            <Route path="/app/tasks/favorites" element={<FavoriteView />} />
            <Route path="/app/runs" element={<RunsCenterRoute />} />
            <Route path="/app/runs/:runId/overview" element={<RunOverviewRoute />} />
            <Route path="/app/runs/:runId/issues" element={<RunIssuesRoute />} />
            <Route path="/app/runs/:runId/phases" element={<RunPhasesRoute />} />
            <Route path="/app/runs/:runId/phases/:phaseId" element={<RunPhaseDetailRoute />} />
            <Route path="/app/runs/:runId/gates" element={<RunGatesRoute />} />
            <Route path="/app/runs/:runId/artifacts" element={<RunArtifactsRoute />} />
            <Route path="/app/runs/:runId/artifacts/:artifactId" element={<RunArtifactDetailRoute />} />
            <Route path="/app/tools" element={<ToolHubRoute />} />
            <Route path="/app/tools/optimization-audit" element={<OptimizationAuditRoute />} />
            <Route path="/app/tools/:toolId/runs" element={<ToolRunsRoute />} />
            <Route path="/app/reports/daily" element={<ReportsView />} />
            <Route path="/app/reports/audit" element={<AuditReportsRoute />} />
            <Route path="/app/reports/audit/:runId" element={<AuditReportDetailRoute />} />
            <Route path="/app/usage" element={<UsageView />} />
            <Route path="/app/providers" element={<ProvidersRoute />} />
            <Route path="/app/settings/general" element={<SettingsRoute section="general" />} />
            <Route path="/app/settings/providers" element={<SettingsRoute section="providers" />} />
            <Route path="/app/settings/automation" element={<SettingsRoute section="automation" />} />
            <Route path="/app/settings/experimental" element={<SettingsRoute section="experimental" />} />
            <Route path="*" element={<Navigate to="/app/home" replace />} />
          </Routes>
        </main>
      </div>

      {/* §6 Footer: background jobs / sync status */}
      <footer className="h-7 px-4 border-t border-white/10 flex items-center gap-4 text-[10px] text-gray-500 shrink-0">
        <span className="flex items-center gap-1">
          <Activity size={10} className={queueRunning ? "text-blue-400" : "text-gray-600"} />
          Queue: {queueCount} {queueRunning ? "running" : "idle"}
        </span>
        <span className="flex items-center gap-1"><RefreshCw size={10} /> Sync: live</span>
        <span className="flex-1" />
        <span>Alice v0.1.0</span>
      </footer>
    </div>
  );
}

function MainNav(): React.ReactElement {
  const groups = [
    {
      title: "Core",
      items: [
        { to: "/app/home", label: "Home", icon: Gauge },
        { to: "/app/runs", label: "Runs", icon: PlayCircle },
        { to: "/app/tools", label: "Tool Hub", icon: Shield },
        { to: "/app/reports/daily", label: "Reports", icon: ClipboardList },
      ],
    },
    {
      title: "Operations",
      items: [
        { to: "/app/sessions/active", label: "Sessions", icon: Terminal },
        { to: "/app/tasks/queue", label: "Tasks", icon: ListChecks },
        { to: "/app/usage", label: "Usage", icon: BarChart3 },
        { to: "/app/providers", label: "Providers", icon: UserCheck },
        { to: "/app/settings/general", label: "Settings", icon: Settings },
      ],
    },
  ];

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 px-2">{g.title}</h3>
          <div className="space-y-0.5">
            {g.items.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) =>
                `flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${isActive ? "bg-blue-500/20 text-blue-200" : "text-gray-300 hover:bg-white/5"}`}>
                <item.icon size={13} />{item.label}
              </NavLink>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Window pages
// ---------------------------------------------------------------------------

function MainHomePage(): React.ReactElement {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    Promise.all([invoke<Session[]>("get_active_sessions"), invoke<Task[]>("get_tasks")])
      .then(([s, t]) => { setSessions(s); setTasks(t); }).catch(console.error);
  }, []);

  const activeRun = SAMPLE_RUNS.find((r) => r.status === "running");
  const pendingGates = SAMPLE_GATES.filter((g) => g.decision === "pending");
  const recentCompleted = tasks.filter((t) => t.status === "completed").slice(0, 5);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Active Sessions" value={sessions.length} icon={<Terminal size={14} />} />
        <StatCard label="Queued Tasks" value={tasks.filter((t) => t.status === "queued").length} icon={<ListChecks size={14} />} />
        <StatCard label="Running Runs" value={SAMPLE_RUNS.filter((r) => r.status === "running").length} icon={<PlayCircle size={14} />} />
        <StatCard label="Pending Gates" value={pendingGates.length} icon={<Shield size={14} />} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <section className="rounded-lg border border-white/10 p-4 bg-white/[0.02]">
          <h2 className="text-sm font-semibold mb-3">Active Run</h2>
          {activeRun ? (
            <Link to={`/app/runs/${activeRun.run_id}/overview`} className="block hover:bg-white/5 rounded p-2 -mx-2">
              <p className="text-xs text-blue-300">{activeRun.run_id} · Phase {activeRun.current_phase_id}</p>
              <p className="text-sm text-gray-100 mt-1">{activeRun.project_name}</p>
              <p className="text-[11px] text-gray-500 mt-1">{activeRun.provider} · score {activeRun.score_before ?? "—"}</p>
            </Link>
          ) : <p className="text-xs text-gray-500">No active run.</p>}
        </section>

        <section className="rounded-lg border border-white/10 p-4 bg-white/[0.02]">
          <h2 className="text-sm font-semibold mb-3">Inbox / Gates</h2>
          {pendingGates.map((g) => (
            <Link key={g.gate_id} to={`/app/runs/${g.run_id}/gates`}
              className="flex items-center gap-2 py-1.5 hover:bg-white/5 rounded px-2 -mx-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-xs text-gray-200">{g.title}</span>
            </Link>
          ))}
          {pendingGates.length === 0 && <p className="text-xs text-gray-500">All clear.</p>}
        </section>
      </div>

      {recentCompleted.length > 0 && (
        <section className="rounded-lg border border-white/10 p-4 bg-white/[0.02]">
          <h2 className="text-sm font-semibold mb-3">Recent Completed Tasks</h2>
          {recentCompleted.map((t) => (
            <div key={t.id} className="flex items-center gap-2 py-1 text-xs">
              <CheckCircle size={12} className="text-green-500 shrink-0" />
              <span className="text-gray-300 truncate">{t.prompt}</span>
              {t.result_cost_usd != null && <span className="text-gray-500 ml-auto">${t.result_cost_usd.toFixed(2)}</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
      <div className="flex items-center gap-2 text-gray-400 mb-1">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span></div>
      <p className="text-xl font-semibold text-gray-100">{value}</p>
    </div>
  );
}

function ActiveSessionsRoute(): React.ReactElement {
  const [count, setCount] = useState(0);
  return (
    <div className="h-full">
      <div className="px-4 py-2 border-b border-white/10 text-xs text-gray-400">Active sessions: {count}</div>
      <div className="h-[calc(100%-33px)]"><ActiveView onSessionCountChange={setCount} /></div>
    </div>
  );
}

function SessionDetailRoute(): React.ReactElement {
  const { sessionId } = useParams();
  const [summary, setSummary] = useState("loading...");
  useEffect(() => {
    if (!sessionId) return;
    invoke<{ session: Session }>("get_session_detail", { sessionId })
      .then((r) => setSummary(r.session.project_name)).catch(() => setSummary("failed"));
  }, [sessionId]);
  return (
    <SimplePage title={`Session ${sessionId ?? "—"}`}>
      <p>Project: {summary}</p>
      <TerminalBridgeButtons label="Session" copyText={`claude --resume ${sessionId}`} path={`~/.claude/projects/`} />
    </SimplePage>
  );
}

function TaskQueueRoute(): React.ReactElement { return <TasksByStatus title="Queue" statuses={["queued", "running"]} />; }
function TaskBacklogRoute(): React.ReactElement { return <TasksByStatus title="Backlog" statuses={["backlog"]} />; }

function TasksByStatus({ title, statuses }: { title: string; statuses: Task["status"][] }): React.ReactElement {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => { invoke<Task[]>("get_tasks").then((r) => setTasks(r.filter((t) => statuses.includes(t.status)))).catch(console.error); }, []);
  return (
    <SimplePage title={`Tasks · ${title}`}>
      {tasks.slice(0, 20).map((t) => (
        <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-white/5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot(t.status)}`} />
          <span className="text-xs text-gray-200 truncate flex-1">{t.prompt}</span>
          <span className="text-[10px] text-gray-500">{t.status}</span>
        </div>
      ))}
      {tasks.length === 0 && <p className="text-xs text-gray-500">No tasks.</p>}
    </SimplePage>
  );
}

// ---------------------------------------------------------------------------
// Run Center + detail pages
// ---------------------------------------------------------------------------

function RunsCenterRoute(): React.ReactElement {
  return (
    <SimplePage title="Run Center">
      {SAMPLE_RUNS.map((run) => (
        <Link key={run.run_id} to={`/app/runs/${run.run_id}/overview`}
          className="block p-3 rounded-lg border border-white/10 hover:bg-white/5 mb-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusDot(run.status)}`} />
            <span className="text-sm font-medium text-gray-100">{run.run_id}</span>
            <span className="text-xs text-gray-400">{run.tool_id}</span>
            <span className="text-xs text-gray-500 ml-auto">{run.provider}</span>
          </div>
          <p className="text-xs text-gray-300 mt-1">{run.project_name} · score {run.score_before ?? "—"} {"→"} {run.score_after ?? "—"}</p>
        </Link>
      ))}
    </SimplePage>
  );
}

function RunSubNav({ runId }: { runId: string }): React.ReactElement {
  const tabs = [
    { to: `/app/runs/${runId}/overview`, label: "Overview" },
    { to: `/app/runs/${runId}/phases`, label: "Phases" },
    { to: `/app/runs/${runId}/issues`, label: "Issues" },
    { to: `/app/runs/${runId}/gates`, label: "Gates" },
    { to: `/app/runs/${runId}/artifacts`, label: "Artifacts" },
  ];
  return (
    <nav className="flex items-center gap-1 px-4 py-2 border-b border-white/10">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} className={({ isActive }) =>
          `px-2 py-1 text-[11px] rounded transition-colors ${isActive ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-white/5"}`}>
          {t.label}
        </NavLink>
      ))}
      <div className="flex-1" />
      <TerminalBridgeButtons label={`Run ${runId}`} copyText={`alice tool status --run ${runId}`} />
    </nav>
  );
}

function RunOverviewRoute(): React.ReactElement {
  const { runId } = useParams();
  const run = SAMPLE_RUNS.find((r) => r.run_id === runId);
  if (!run) return <SimplePage title="Run Overview">Run not found.</SimplePage>;
  const phases = SAMPLE_PHASES[run.run_id] ?? [];
  return (
    <div className="h-full flex flex-col">
      <RunSubNav runId={run.run_id} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Status" value={0} icon={<span className={`w-2 h-2 rounded-full ${statusDot(run.status)}`} />} />
          <StatCard label="Score Before" value={run.score_before ?? 0} icon={<BarChart3 size={14} />} />
          <StatCard label="Score After" value={run.score_after ?? 0} icon={<BarChart3 size={14} />} />
        </div>
        <p className="text-xs text-gray-400">{run.residual_risk ? `Residual risk: ${run.residual_risk}` : "No residual risk recorded."}</p>
        <h3 className="text-sm font-semibold">Phases</h3>
        {phases.map((ph) => (
          <Link key={ph.phase_id} to={`/app/runs/${run.run_id}/phases/${ph.phase_id}`}
            className="flex items-center gap-3 p-3 rounded border border-white/10 hover:bg-white/5">
            <span className={`w-2 h-2 rounded-full ${statusDot(ph.status)}`} />
            <span className="text-xs text-gray-200 font-medium">{ph.phase_id}: {ph.name}</span>
            <span className="text-[10px] text-gray-500 ml-auto">{ph.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function RunIssuesRoute(): React.ReactElement {
  const { runId } = useParams();
  return (
    <div className="h-full flex flex-col">
      <RunSubNav runId={runId ?? ""} />
      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="text-sm font-semibold mb-3">Issues Board</h2>
        <p className="text-xs text-gray-400">多模型发现结果归并与冲突仲裁。当 run 连接真实 provider 后将展示发现的 issue 列表。</p>
      </div>
    </div>
  );
}

function RunPhasesRoute(): React.ReactElement {
  const { runId } = useParams();
  const phases = runId ? SAMPLE_PHASES[runId] ?? [] : [];
  return (
    <div className="h-full flex flex-col">
      <RunSubNav runId={runId ?? ""} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {phases.map((ph) => (
          <Link key={ph.phase_id} to={`/app/runs/${runId}/phases/${ph.phase_id}`}
            className="flex items-center gap-3 p-3 rounded border border-white/10 hover:bg-white/5">
            <span className={`w-2 h-2 rounded-full ${statusDot(ph.status)}`} />
            <span className="text-xs font-medium text-gray-200">{ph.phase_id}: {ph.name}</span>
            <span className="text-[10px] text-gray-500 ml-auto">{ph.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// §8.2 Phase Cockpit
function RunPhaseDetailRoute(): React.ReactElement {
  const { runId, phaseId } = useParams();
  const phase = (runId ? SAMPLE_PHASES[runId] : [])?.find((p) => p.phase_id === phaseId);
  const gates = SAMPLE_GATES.filter((g) => g.run_id === runId && g.phase_id === phaseId);
  const artifacts = SAMPLE_ARTIFACTS.filter((a) => a.run_id === runId && a.phase_id === phaseId);

  if (!phase) return <SimplePage title="Phase Detail">Phase not found.</SimplePage>;
  return (
    <div className="h-full flex flex-col">
      <RunSubNav runId={runId ?? ""} />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${statusDot(phase.status)}`} />
          <h2 className="text-base font-semibold">{phase.phase_id}: {phase.name}</h2>
          <span className="text-xs text-gray-400 ml-auto">{phase.status}</span>
        </div>
        {/* DoD checklist */}
        <section className="rounded-lg border border-white/10 p-4">
          <h3 className="text-sm font-semibold mb-2">Definition of Done</h3>
          {phase.dod.map((item) => (
            <div key={item} className="flex items-center gap-2 py-1">
              <CheckCircle size={12} className={phase.status === "completed" ? "text-green-500" : "text-gray-600"} />
              <span className="text-xs text-gray-300">{item}</span>
            </div>
          ))}
        </section>
        {/* Verification */}
        <section className="rounded-lg border border-white/10 p-4">
          <h3 className="text-sm font-semibold mb-2">Verification</h3>
          <p className="text-xs text-gray-300">{phase.verification_summary}</p>
          {phase.rollback_notes && <p className="text-xs text-amber-300 mt-2">Rollback: {phase.rollback_notes}</p>}
        </section>
        {/* Gates */}
        {gates.length > 0 && (
          <section className="rounded-lg border border-amber-500/20 p-4 bg-amber-500/5">
            <h3 className="text-sm font-semibold mb-2 text-amber-200">Gates</h3>
            {gates.map((g) => (
              <div key={g.gate_id} className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-200">{g.title}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded ${g.decision === "pending" ? "bg-amber-500/20 text-amber-300" : "bg-green-500/20 text-green-300"}`}>
                  {g.decision}
                </span>
              </div>
            ))}
          </section>
        )}
        {/* Artifacts */}
        {artifacts.length > 0 && (
          <section className="rounded-lg border border-white/10 p-4">
            <h3 className="text-sm font-semibold mb-2">Artifacts</h3>
            {artifacts.map((a) => (
              <Link key={a.artifact_id} to={`/app/runs/${runId}/artifacts/${a.artifact_id}`}
                className="flex items-center gap-2 py-1 text-xs text-blue-300 hover:text-blue-200">
                <FileText size={12} /> {a.title} ({a.kind})
              </Link>
            ))}
          </section>
        )}
        <TerminalBridgeButtons label={`Phase ${phase.phase_id}`} copyText={`alice tool phase status --run ${runId} --phase ${phaseId}`} />
      </div>
    </div>
  );
}

function RunGatesRoute(): React.ReactElement {
  const { runId } = useParams();
  const gates = SAMPLE_GATES.filter((g) => g.run_id === runId);
  return (
    <div className="h-full flex flex-col">
      <RunSubNav runId={runId ?? ""} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {gates.map((g) => (
          <div key={g.gate_id} className="flex items-center justify-between p-3 rounded border border-white/10">
            <div>
              <p className="text-xs font-medium text-gray-200">{g.gate_id}: {g.title}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{g.reason}</p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded ${g.decision === "pending" ? "bg-amber-500/20 text-amber-300" : g.decision === "approved" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>
              {g.decision}
            </span>
          </div>
        ))}
        {gates.length === 0 && <p className="text-xs text-gray-500">No gates for this run.</p>}
      </div>
    </div>
  );
}

function RunArtifactsRoute(): React.ReactElement {
  const { runId } = useParams();
  const artifacts = SAMPLE_ARTIFACTS.filter((a) => a.run_id === runId);
  return (
    <div className="h-full flex flex-col">
      <RunSubNav runId={runId ?? ""} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {artifacts.map((a) => (
          <Link key={a.artifact_id} to={`/app/runs/${runId}/artifacts/${a.artifact_id}`}
            className="flex items-center gap-3 p-3 rounded border border-white/10 hover:bg-white/5">
            <FileText size={14} className="text-gray-400" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-200">{a.title}</p>
              <p className="text-[10px] text-gray-500">{a.kind} · {a.path}</p>
            </div>
            <span className="text-[10px] text-gray-500">{relativeTime(a.created_at)}</span>
          </Link>
        ))}
        {artifacts.length === 0 && <p className="text-xs text-gray-500">No artifacts.</p>}
      </div>
    </div>
  );
}

function RunArtifactDetailRoute(): React.ReactElement {
  const { artifactId } = useParams();
  const artifact = SAMPLE_ARTIFACTS.find((a) => a.artifact_id === artifactId);
  if (!artifact) return <SimplePage title="Artifact">Not found.</SimplePage>;
  return (
    <SimplePage title={`Artifact: ${artifact.title}`}>
      <div className="space-y-2">
        <p>Kind: {artifact.kind}</p>
        <p>Path: {artifact.path}</p>
        <p>Created: {relativeTime(artifact.created_at)}</p>
        <TerminalBridgeButtons label={artifact.title} copyText={`cat ${artifact.path}`} path={artifact.path} />
      </div>
    </SimplePage>
  );
}

// ---------------------------------------------------------------------------
// §8.2 Optimization Audit tool — 5 sub-views
// ---------------------------------------------------------------------------

function OptimizationAuditRoute(): React.ReactElement {
  const activeRun = SAMPLE_RUNS.find((r) => r.status === "running" && r.tool_id === "optimization-audit");
  const completedRuns = SAMPLE_RUNS.filter((r) => r.status === "completed" && r.tool_id === "optimization-audit");
  const allPhases = activeRun ? SAMPLE_PHASES[activeRun.run_id] ?? [] : [];

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <h2 className="text-base font-semibold">Optimization Audit</h2>

      {/* Run Timeline */}
      <section className="rounded-lg border border-white/10 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><PlayCircle size={14} /> Run Timeline</h3>
        {activeRun ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full ${statusDot(activeRun.status)}`} />
              <span className="text-xs text-gray-100">{activeRun.run_id} · {activeRun.project_name}</span>
            </div>
            <div className="ml-5 border-l border-white/10 pl-3 space-y-1.5">
              {allPhases.map((ph) => (
                <Link key={ph.phase_id} to={`/app/runs/${activeRun.run_id}/phases/${ph.phase_id}`}
                  className="flex items-center gap-2 text-xs hover:bg-white/5 rounded py-1 px-1 -mx-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot(ph.status)}`} />
                  <span className="text-gray-200">{ph.phase_id}: {ph.name}</span>
                  <span className="text-gray-500 ml-auto">{ph.status}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : <p className="text-xs text-gray-500">No active optimization run.</p>}
      </section>

      {/* Issues Board */}
      <section className="rounded-lg border border-white/10 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Inbox size={14} /> Issues Board</h3>
        <p className="text-xs text-gray-400">多模型发现结果将在此归并显示。支持去重、冲突仲裁和优先级排序。</p>
        {activeRun && <Link to={`/app/runs/${activeRun.run_id}/issues`} className="text-xs text-blue-300 mt-2 inline-block">View Issues →</Link>}
      </section>

      {/* Phase Cockpit */}
      <section className="rounded-lg border border-white/10 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Shield size={14} /> Phase Cockpit</h3>
        {allPhases.map((ph) => (
          <div key={ph.phase_id} className="py-2 border-b border-white/5 last:border-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${statusDot(ph.status)}`} />
              <span className="text-xs font-medium text-gray-200">{ph.phase_id}: {ph.name}</span>
            </div>
            <div className="ml-4 mt-1 text-[11px] text-gray-400">
              DoD: {ph.dod.join("; ")} | Verification: {ph.verification_summary}
              {ph.rollback_notes && <span className="text-amber-300"> | Rollback: {ph.rollback_notes}</span>}
            </div>
          </div>
        ))}
      </section>

      {/* Score Compare */}
      <section className="rounded-lg border border-white/10 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><BarChart3 size={14} /> Score Compare</h3>
        <div className="grid grid-cols-2 gap-4">
          {[activeRun, ...completedRuns].filter(Boolean).map((run) => run && (
            <div key={run.run_id} className="rounded border border-white/10 p-3">
              <p className="text-xs text-gray-200 font-medium">{run.run_id}</p>
              <div className="flex items-end gap-4 mt-2">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Before</p>
                  <p className="text-lg font-semibold text-gray-100">{run.score_before ?? "—"}</p>
                </div>
                <ArrowRight size={14} className="text-gray-600 mb-1" />
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">After</p>
                  <p className="text-lg font-semibold text-green-400">{run.score_after ?? "—"}</p>
                </div>
              </div>
              {run.residual_risk && <p className="text-[10px] text-amber-300 mt-1">Risk: {run.residual_risk}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* Artifact Explorer */}
      <section className="rounded-lg border border-white/10 p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><FileText size={14} /> Artifact Explorer</h3>
        {SAMPLE_ARTIFACTS.map((a) => (
          <Link key={a.artifact_id} to={`/app/runs/${a.run_id}/artifacts/${a.artifact_id}`}
            className="flex items-center gap-2 py-1.5 text-xs text-blue-300 hover:text-blue-200">
            <FileText size={12} /> {a.title} <span className="text-gray-500">({a.kind})</span>
          </Link>
        ))}
      </section>
    </div>
  );
}

function ToolHubRoute(): React.ReactElement {
  return (
    <SimplePage title="Tool Hub">
      <p className="text-gray-400 mb-3">所有工具通过 manifest 统一接入，无需改动窗口框架。</p>
      {TOOL_MANIFESTS.map((tool) => (
        <Link key={tool.tool_id} to={tool.tool_id === "optimization-audit" ? "/app/tools/optimization-audit" : `/app/tools/${tool.tool_id}/runs`}
          className="block p-3 rounded-lg border border-white/10 hover:bg-white/5 mb-2">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-blue-400" />
            <span className="text-sm font-medium text-gray-100">{tool.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ml-auto ${tool.risk_level === "high" ? "bg-red-500/20 text-red-300" : "bg-yellow-500/20 text-yellow-300"}`}>
              {tool.risk_level} risk
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">{tool.category} · {tool.state_machine.steps.length} steps · {tool.state_machine.gates.length} gates</p>
        </Link>
      ))}
    </SimplePage>
  );
}

function ToolRunsRoute(): React.ReactElement {
  const { toolId } = useParams();
  const runs = SAMPLE_RUNS.filter((r) => r.tool_id === toolId);
  return (
    <SimplePage title={`Tool: ${toolId ?? "—"}`}>
      {runs.map((run) => (
        <Link key={run.run_id} to={`/app/runs/${run.run_id}/overview`}
          className="flex items-center gap-2 py-2 border-b border-white/5 hover:bg-white/5 rounded px-1">
          <span className={`w-2 h-2 rounded-full ${statusDot(run.status)}`} />
          <span className="text-xs text-gray-200">{run.run_id}</span>
          <span className="text-xs text-gray-500 ml-auto">{run.status}</span>
        </Link>
      ))}
      {runs.length === 0 && <p>No runs.</p>}
    </SimplePage>
  );
}

function AuditReportsRoute(): React.ReactElement {
  return (
    <SimplePage title="Audit Reports">
      {SAMPLE_RUNS.map((run) => (
        <Link key={run.run_id} to={`/app/reports/audit/${run.run_id}`}
          className="block py-2 text-xs text-blue-300 hover:text-blue-200 border-b border-white/5">
          {run.run_id} · {run.project_name} · score {run.score_before ?? "—"} {"→"} {run.score_after ?? "—"}
        </Link>
      ))}
    </SimplePage>
  );
}

function AuditReportDetailRoute(): React.ReactElement {
  const { runId } = useParams();
  const run = SAMPLE_RUNS.find((r) => r.run_id === runId);
  const phases = runId ? SAMPLE_PHASES[runId] ?? [] : [];
  return (
    <SimplePage title={`Audit Report: ${runId ?? "—"}`}>
      {run && (
        <div className="space-y-3">
          <p>Provider: {run.provider} · Score: {run.score_before ?? "—"} {"→"} {run.score_after ?? "—"}</p>
          {run.residual_risk && <p className="text-amber-300">Residual risk: {run.residual_risk}</p>}
          <h3 className="font-semibold">Phases</h3>
          {phases.map((ph) => (
            <div key={ph.phase_id} className="pl-3 border-l-2 border-white/10 py-1">
              <p className="font-medium">{ph.phase_id}: {ph.name} ({ph.status})</p>
              <p className="text-gray-400">{ph.verification_summary}</p>
            </div>
          ))}
          <TerminalBridgeButtons label="Audit Report" copyText={`alice tool report --run ${runId}`} />
        </div>
      )}
      {!run && <p>Run not found.</p>}
    </SimplePage>
  );
}

function ProvidersRoute(): React.ReactElement {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  useEffect(() => { invoke<ProviderStatus[]>("get_provider_statuses").then(setProviders).catch(console.error); }, []);
  return (
    <SimplePage title="Provider Health & Configuration">
      {providers.map((p) => (
        <div key={p.id} className="flex items-center gap-3 py-2 border-b border-white/5">
          <span className={`w-2 h-2 rounded-full ${p.installed ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-xs font-medium text-gray-200">{p.display_name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.enabled ? "bg-green-500/20 text-green-300" : "bg-gray-500/20 text-gray-400"}`}>
            {p.enabled ? "enabled" : "disabled"}
          </span>
          <span className="text-[10px] text-gray-500 ml-auto">{p.version ?? "n/a"} · {p.data_dir}</span>
        </div>
      ))}
      {providers.length === 0 && <p>No providers configured.</p>}
    </SimplePage>
  );
}

function SettingsRoute({ section }: { section: string }): React.ReactElement {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-white/10 text-xs text-blue-300">
        Settings: {section.charAt(0).toUpperCase() + section.slice(1)}
      </div>
      <div className="flex-1 overflow-hidden"><ConfigView /></div>
    </div>
  );
}

function SimplePage({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="text-sm font-semibold mb-3">{title}</h2>
      <div className="text-xs text-gray-300 space-y-2">{children}</div>
    </div>
  );
}

export default App;
