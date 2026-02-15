import { useState, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings,
  Keyboard,
  Info,
  ExternalLink,
  CheckCircle2,
  XCircle,
  User,
  RotateCcw,
  Sun,
  Moon,
  Monitor,
  Plus,
  Pencil,
  Trash2,
  Check,
  FolderOpen,
  Cpu,
  Database,
  FileText,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import type {
  Theme,
  ClaudeEnvironment,
  ProviderStatus,
  AppConfig,
  TerminalOption,
  SystemInfo,
} from "../lib/types";
import { useToast } from "../contexts/ToastContext";
import { getModKey, isMacSync } from "../lib/platform";
import ProviderConfigCard from "../components/ProviderConfigCard";

// --- Small, reusable sub-components ---

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
}

function Toggle({ enabled, onChange, label, description }: ToggleProps) {
  return (
    <div className="flex items-center justify-between py-2 group">
      <div className="pr-4 flex-1 min-w-0">
        <p className="text-secondary group-hover:text-primary transition-colors text-xs font-medium truncate">
          {label}
        </p>
        {description && (
          <p className="text-[10px] text-muted mt-0.5 leading-tight line-clamp-2">
            {description}
          </p>
        )}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-8 h-4.5 rounded-full transition-all duration-300 ease-in-out border flex-shrink-0 ${enabled
          ? "bg-blue-600 border-blue-600"
          : "bg-white/5 border-white/20 hover:border-white/40"
          }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform duration-300 ${enabled ? "translate-x-3.5" : "translate-x-0"
            }`}
        />
      </button>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
      {children}
    </h3>
  );
}

function TabPanel({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {children}
    </div>
  );
}

function ToggleGroup({ children }: { children: ReactNode }) {
  return (
    <div className="glass-panel px-3 py-1 divide-y divide-white/5">
      {children}
    </div>
  );
}

// --- Environment editing state ---

type EnvEditMode =
  | { kind: "idle" }
  | { kind: "adding"; form: Partial<ClaudeEnvironment> }
  | { kind: "editing"; envId: string; form: Partial<ClaudeEnvironment> };

const IDLE_MODE: EnvEditMode = { kind: "idle" };

// --- Tab definitions ---

const TABS = [
  { id: "general", label: "General", icon: Settings },
  { id: "providers", label: "Providers", icon: Cpu },
  { id: "about", label: "About", icon: Info },
];

const THEME_OPTIONS = [
  { value: "system", icon: Monitor, label: "System" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
] as const;

const SHORTCUTS = [
  { shortcut: "K", action: "Search" },
  { shortcut: "N", action: "New Task" },
  { shortcut: "R", action: "Refresh" },
  { shortcut: ",", action: "Settings" },
];

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
];

// --- Helpers ---

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function isActiveEnv(config: AppConfig, envId: string): boolean {
  return (
    config.active_environment_id === envId ||
    (!config.active_environment_id && envId === "default")
  );
}

function buildEnvData(form: Partial<ClaudeEnvironment>): ClaudeEnvironment {
  return {
    id: form.id || "",
    name: form.name || "",
    config_dir: form.config_dir || "",
    api_key: form.api_key || null,
    model: form.model || null,
    command: form.command || null,
    enabled: form.enabled ?? true,
  };
}

// --- Main component ---

export default function ConfigView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [terminalOptions, setTerminalOptions] = useState<TerminalOption[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [installingHooks, setInstallingHooks] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [activeTabId, setActiveTabId] = useState("general");
  const [envEditMode, setEnvEditMode] = useState<EnvEditMode>(IDLE_MODE);

  const toast = useToast();
  const { theme, setTheme } = useTheme();

  async function loadData(): Promise<void> {
    try {
      const [configResult, sysInfo, terminals, providers] = await Promise.all([
        invoke<AppConfig>("get_config", {}),
        invoke<SystemInfo>("get_system_info", {}),
        invoke<TerminalOption[]>("get_available_terminals", {}),
        invoke<ProviderStatus[]>("get_provider_statuses", {}),
      ]);
      setConfig(configResult);
      setSystemInfo(sysInfo);
      setTerminalOptions(terminals);
      setProviderStatuses(providers);
    } catch (error) {
      console.error("Failed to load config:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function updateSetting(
    key: string,
    value: boolean | number | string,
  ): Promise<void> {
    try {
      const result = await invoke<AppConfig>("update_config", { key, value });
      setConfig(result);
    } catch (error) {
      console.error("Failed to update config:", error);
    }
  }

  async function updateProviderConfig(
    providerId: string,
    enabled: boolean,
    dataDir: string | null,
  ): Promise<void> {
    try {
      const result = await invoke<AppConfig>("update_provider_config", {
        providerId,
        enabled,
        dataDir,
      });
      setConfig(result);
      const providers = await invoke<ProviderStatus[]>(
        "get_provider_statuses",
        {},
      );
      setProviderStatuses(providers);
      toast.success("Provider configuration updated");
    } catch (error) {
      console.error("Failed to update provider config:", error);
      toast.error("Failed to update provider configuration");
    }
  }

  async function installHooks(): Promise<void> {
    try {
      setInstallingHooks(true);
      const result = await invoke<{
        success: boolean;
        settings_path: string;
        hooks_file: string;
      }>("install_hooks", {});
      if (result.success) {
        toast.success("Hooks installed successfully");
        loadData();
      }
    } catch (error) {
      console.error("Failed to install hooks:", error);
      toast.error("Failed to install hooks");
    } finally {
      setInstallingHooks(false);
    }
  }

  async function rerunSetupWizard(): Promise<void> {
    try {
      await invoke("update_config", {
        key: "onboarding_completed",
        value: false,
      });
      window.location.reload();
    } catch (error) {
      console.error("Failed to reset onboarding:", error);
      toast.error("Failed to reset setup wizard");
    }
  }

  async function rescanSessions(): Promise<void> {
    setRescanning(true);
    try {
      const count = await invoke<number>("rescan_sessions");
      toast.success(`Rescanned ${count} sessions`);
      loadData();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("Rescan failed:", error);
      toast.error(`Rescan failed: ${errorMsg}`);
    } finally {
      setRescanning(false);
    }
  }

  // --- Environment management ---

  function startAddEnv(): void {
    setEnvEditMode({
      kind: "adding",
      form: {
        id: "",
        name: "",
        config_dir: "",
        api_key: "",
        model: "",
        command: "",
        enabled: true,
      },
    });
  }

  function startEditEnv(env: ClaudeEnvironment): void {
    setEnvEditMode({ kind: "editing", envId: env.id, form: { ...env } });
  }

  function updateEnvForm(updates: Partial<ClaudeEnvironment>): void {
    if (envEditMode.kind === "idle") return;
    setEnvEditMode({ ...envEditMode, form: { ...envEditMode.form, ...updates } });
  }

  async function saveEnv(): Promise<void> {
    if (envEditMode.kind === "idle") return;
    const { form } = envEditMode;

    if (!form.id || !form.name) {
      toast.error("ID and Name are required");
      return;
    }

    const envData = buildEnvData(form);
    const isAdding = envEditMode.kind === "adding";

    try {
      const command = isAdding
        ? "add_claude_environment"
        : "update_claude_environment";
      await invoke<AppConfig>(command, { env: envData });
      toast.success(isAdding ? "Environment added" : "Environment updated");
      loadData();
      setEnvEditMode(IDLE_MODE);
    } catch (error) {
      console.error("Failed to save environment:", error);
      toast.error(`Failed to save: ${error}`);
    }
  }

  async function deleteEnv(id: string): Promise<void> {
    if (id === "default") {
      toast.error("Cannot delete the default environment");
      return;
    }

    try {
      await invoke<AppConfig>("delete_claude_environment", { id });
      toast.success("Environment deleted");
      loadData();
    } catch (error) {
      console.error("Failed to delete environment:", error);
      toast.error(`Failed to delete: ${error}`);
    }
  }

  async function setActiveEnv(id: string): Promise<void> {
    try {
      await invoke<AppConfig>("set_active_environment", {
        environmentId: id,
      });
      toast.success("Active environment changed");
      loadData();
    } catch (error) {
      console.error("Failed to set active environment:", error);
      toast.error(`Failed to set active: ${error}`);
    }
  }

  // --- Render ---

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-950">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const envForm = envEditMode.kind !== "idle" ? envEditMode.form : null;
  const modKey = getModKey();

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-200 font-sans">
      {/* Header and Navigation */}
      <div className="flex-none bg-gray-900 border-b border-white/5">
        <div className="px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-100">Settings</h2>
        </div>

        <div className="flex gap-1.5 px-2 pb-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex-1 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all ${activeTabId === tab.id
                ? "bg-blue-600 text-white shadow-sm shadow-blue-900/20"
                : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200 border border-transparent hover:border-white/5"
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-4 space-y-6 pb-8">
          {activeTabId === "general" && (
            <TabPanel>
              <section className="space-y-3">
                <SectionHeading>Appearance</SectionHeading>
                <div className="glass-panel p-1 flex gap-1 justify-between">
                  {THEME_OPTIONS.map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value as Theme)}
                      className={`flex-1 flex flex-col items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium transition-all ${theme === value
                        ? "bg-blue-600/10 text-blue-400"
                        : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                        }`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeading>Behavior</SectionHeading>
                <ToggleGroup>
                  <Toggle
                    enabled={config.launch_at_login}
                    onChange={(v) => updateSetting("launch_at_login", v)}
                    label="Launch at login"
                    description="Start automatically"
                  />
                  <Toggle
                    enabled={config.auto_hide_on_blur}
                    onChange={(v) => updateSetting("auto_hide_on_blur", v)}
                    label="Auto-hide"
                    description="Close when clicking outside"
                  />
                </ToggleGroup>
              </section>

              <section className="space-y-3">
                <SectionHeading>Notifications</SectionHeading>
                <ToggleGroup>
                  <Toggle
                    enabled={config.notification_sound}
                    onChange={(v) => updateSetting("notification_sound", v)}
                    label="Sound Effect"
                    description="Play sound on completion"
                  />
                  <Toggle
                    enabled={config.voice_notifications}
                    onChange={(v) => updateSetting("voice_notifications", v)}
                    label="Voice Announcement"
                    description={
                      isMacSync() ? "Use macOS Voice" : "Use System Voice"
                    }
                  />
                  <Toggle
                    enabled={config.notifications.on_task_completed}
                    onChange={(v) =>
                      updateSetting("notifications.on_task_completed", v)
                    }
                    label="Task Completed"
                  />
                  <Toggle
                    enabled={config.notifications.on_task_error}
                    onChange={(v) =>
                      updateSetting("notifications.on_task_error", v)
                    }
                    label="Task Error"
                  />
                  <Toggle
                    enabled={config.notifications.on_needs_input}
                    onChange={(v) =>
                      updateSetting("notifications.on_needs_input", v)
                    }
                    label="Input Needed"
                  />
                </ToggleGroup>
              </section>

              <section className="space-y-3">
                <SectionHeading>Shell Integration</SectionHeading>
                <div className="glass-panel p-3">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-xs font-semibold text-gray-200">
                        Shell Hooks
                      </h3>
                      <p className="text-[10px] text-gray-500">
                        Enable real-time status updates.
                      </p>
                    </div>
                    <div
                      className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 ${config.hooks_installed
                        ? "bg-green-500/10 text-green-400"
                        : "bg-yellow-500/10 text-yellow-500"
                        }`}
                    >
                      {config.hooks_installed ? (
                        <CheckCircle2 size={10} />
                      ) : (
                        <XCircle size={10} />
                      )}
                      {config.hooks_installed ? "Active" : "Inactive"}
                    </div>
                  </div>
                  <button
                    onClick={installHooks}
                    disabled={installingHooks}
                    className="w-full flex justify-center items-center gap-2 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 rounded transition-colors"
                  >
                    {installingHooks ? (
                      <span className="animate-pulse">Installing...</span>
                    ) : config.hooks_installed ? (
                      "Reinstall"
                    ) : (
                      "Install Hooks"
                    )}
                  </button>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] text-gray-500 px-1">Terminal App</p>
                  <div className="grid grid-cols-2 gap-2">
                    {terminalOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() =>
                          updateSetting("terminal_app", option.value)
                        }
                        className={`px-2 py-2 text-[10px] font-medium rounded-lg border transition-all ${config.terminal_app === option.value
                          ? "bg-blue-600 text-white border-blue-500"
                          : "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10"
                          }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {config.terminal_app === "custom" && (
                    <div className="glass-panel p-2">
                      <input
                        type="text"
                        value={config.custom_terminal_command}
                        onChange={(e) =>
                          updateSetting("custom_terminal_command", e.target.value)
                        }
                        className="w-full bg-transparent text-xs text-gray-200 font-mono focus:outline-none"
                        placeholder='open -a "Term" ...'
                      />
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeading>Language</SectionHeading>
                <div className="glass-panel p-2 flex items-center justify-between">
                  <span className="text-xs text-gray-300">
                    Reports Language
                  </span>
                  <select
                    value={config.report_language || "auto"}
                    onChange={(e) =>
                      updateSetting("report_language", e.target.value)
                    }
                    className="bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none"
                  >
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="space-y-2">
                <SectionHeading>
                  <span className="flex items-center gap-2">
                    <Keyboard size={12} /> Shortcuts
                  </span>
                </SectionHeading>
                <div className="glass-panel p-2">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {SHORTCUTS.map((item) => (
                      <div
                        key={item.shortcut}
                        className="flex items-center justify-between px-1 py-1"
                      >
                        <span className="text-[10px] text-gray-500">
                          {item.action}
                        </span>
                        <kbd className="text-[9px] text-gray-500 bg-white/5 border border-white/10 rounded px-1 py-0.5 min-w-[24px] text-center font-mono">
                          {modKey}
                          {item.shortcut}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </TabPanel>
          )}

          {activeTabId === "providers" && (
            <TabPanel>
              <div className="glass-panel p-3 border-l-2 border-l-blue-500 bg-blue-500/5">
                <p className="text-xs text-blue-200/90 leading-relaxed">
                  Configure AI CLI providers and Claude Code environments.
                </p>
              </div>

              {/* AI Providers */}
              <section className="space-y-3">
                <SectionHeading>AI Providers</SectionHeading>
                <div className="space-y-2">
                  {providerStatuses.map((provider) => (
                    <ProviderConfigCard
                      key={provider.id}
                      provider={provider}
                      onToggle={(enabled) =>
                        updateProviderConfig(
                          provider.id,
                          enabled,
                          provider.custom_data_dir,
                        )
                      }
                      onDataDirChange={(dataDir) =>
                        updateProviderConfig(
                          provider.id,
                          provider.enabled,
                          dataDir,
                        )
                      }
                    />
                  ))}

                  {providerStatuses.length === 0 && (
                    <div className="text-center py-8 text-gray-500 border border-dashed border-white/10 rounded-xl">
                      <p className="text-xs">No providers found</p>
                    </div>
                  )}
                </div>
              </section>

              {/* Claude Environments */}
              <section className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <SectionHeading>Claude Environments</SectionHeading>
                  <button
                    onClick={startAddEnv}
                    disabled={envEditMode.kind === "adding"}
                    className="p-1 text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                    title="Add Environment"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {envEditMode.kind === "adding" && envForm && (
                  <div className="glass-panel p-3 space-y-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-medium text-blue-400">
                        New Profile
                      </h4>
                      <button
                        onClick={() => setEnvEditMode(IDLE_MODE)}
                        className="text-gray-500 hover:text-gray-300"
                      >
                        <XCircle size={14} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={envForm.name || ""}
                      onChange={(e) => {
                        const name = e.target.value;
                        const id = name
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, "");
                        updateEnvForm({ name, id });
                      }}
                      className="w-full bg-black/20 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50"
                      placeholder="Profile Name"
                    />
                    <div className="flex items-center gap-2 bg-black/20 border border-white/10 rounded px-2 py-1.5">
                      <FolderOpen size={12} className="text-gray-500" />
                      <input
                        type="text"
                        value={envForm.config_dir || ""}
                        onChange={(e) =>
                          updateEnvForm({ config_dir: e.target.value })
                        }
                        className="flex-1 bg-transparent text-xs text-gray-200 font-mono focus:outline-none"
                        placeholder="~/.claude-custom"
                      />
                    </div>
                    <button
                      onClick={saveEnv}
                      className="w-full py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded shadow-sm"
                    >
                      Create
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  {config.claude_environments?.map((env) => {
                    const isActive = isActiveEnv(config, env.id);
                    const isEditing =
                      envEditMode.kind === "editing" &&
                      envEditMode.envId === env.id;

                    return (
                      <div
                        key={env.id}
                        className={`glass-panel p-3 transition-colors ${isActive
                          ? "border-blue-500/30 bg-blue-500/5"
                          : "hover:bg-white/5"
                          }`}
                      >
                        {isEditing && envForm ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={envForm.name || ""}
                              onChange={(e) =>
                                updateEnvForm({ name: e.target.value })
                              }
                              className="w-full bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-gray-200"
                            />
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => setEnvEditMode(IDLE_MODE)}
                                className="px-2 py-1 text-[10px] text-gray-400"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={saveEnv}
                                className="px-2 py-1 text-[10px] bg-green-600 text-white rounded"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1 mr-2">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-medium text-gray-200 truncate">
                                  {env.name}
                                </span>
                                {isActive && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-glow-blue" />
                                )}
                              </div>
                              <div className="text-[10px] text-gray-500 font-mono truncate opacity-70">
                                {env.config_dir || "Default"}
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              {env.id !== "default" && !isActive && (
                                <button
                                  onClick={() => setActiveEnv(env.id)}
                                  className="p-1.5 text-gray-400 hover:text-blue-400 rounded"
                                  title="Activate"
                                >
                                  <Check size={14} />
                                </button>
                              )}
                              <button
                                onClick={() => startEditEnv(env)}
                                className="p-1.5 text-gray-400 hover:text-white rounded"
                                title="Edit"
                              >
                                <Pencil size={14} />
                              </button>
                              {env.id !== "default" && (
                                <button
                                  onClick={() => deleteEnv(env.id)}
                                  className="p-1.5 text-gray-400 hover:text-red-400 rounded"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </TabPanel>
          )}

          {activeTabId === "about" && (
            <TabPanel>
              <div className="flex flex-col items-center justify-center pt-8 pb-6 relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-blue-500/20 blur-[50px] rounded-full pointer-events-none" />

                <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-xl shadow-blue-500/20 mb-4 ring-1 ring-white/10 group">
                  <span className="text-4xl font-bold text-white tracking-tight group-hover:scale-105 transition-transform">A</span>
                </div>

                <div className="text-center z-10">
                  <h2 className="text-xl font-bold text-white tracking-tight mb-1">Alice</h2>
                  <p className="text-xs text-blue-200/80 font-medium mb-3">
                    Expert Companion for Claude Code
                  </p>

                  <div className="flex items-center justify-center gap-2">
                    <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-md border border-white/10 font-mono">
                      v0.1.0
                    </span>
                    <a
                      href="https://github.com/wangyixiao/Alice"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-md border border-white/10 transition-all flex items-center gap-1"
                    >
                      <ExternalLink size={10} />
                      GitHub
                    </a>
                  </div>
                </div>
              </div>

              <div className="space-y-3 px-2">
                {/* Account Status Card */}
                <div className="glass-panel p-4 relative overflow-hidden group hover:border-white/10 transition-colors">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${systemInfo?.credentials_exist
                        ? "bg-green-500/10 text-green-400 ring-1 ring-green-500/20"
                        : "bg-red-500/10 text-red-400 ring-1 ring-red-500/20"
                        }`}
                    >
                      <User size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-semibold text-gray-200">
                          {systemInfo?.credentials_exist ? "Connected" : "Disconnected"}
                        </span>
                        {systemInfo?.credentials_exist && (
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-[10px] text-green-500/80 font-medium uppercase tracking-wider">Active</span>
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 truncate">
                        {systemInfo?.account_email || "No account linked"}
                      </p>
                    </div>
                  </div>

                  {systemInfo?.claude_version && (
                    <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">Claude CLI Version</span>
                      <span className="text-[10px] text-gray-300 font-mono bg-white/5 px-1.5 py-0.5 rounded">
                        v{systemInfo.claude_version}
                      </span>
                    </div>
                  )}
                </div>

                {/* Data Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="glass-panel p-3 flex flex-col items-center justify-center gap-1 hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                      <Database size={12} />
                      <span>Database</span>
                    </div>
                    <span className="text-lg font-semibold text-gray-200 font-mono">
                      {systemInfo ? formatBytes(systemInfo.db_stats.db_size_bytes) : "-"}
                    </span>
                  </div>
                  <div className="glass-panel p-3 flex flex-col items-center justify-center gap-1 hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                      <FileText size={12} />
                      <span>Reports</span>
                    </div>
                    <span className="text-lg font-semibold text-gray-200 font-mono">
                      {systemInfo?.db_stats.report_count ?? 0}
                    </span>
                  </div>
                </div>

                {/* Actions Group */}
                <div className="glass-panel p-1 border-white/5">
                  <button
                    onClick={rescanSessions}
                    disabled={rescanning}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-300 hover:bg-white/5 rounded-lg transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 transition-colors">
                        <RotateCcw size={14} className={rescanning ? "animate-spin" : ""} />
                      </div>
                      <span className="font-medium">{rescanning ? "Rescanning..." : "Rescan Sessions"}</span>
                    </div>
                    <span className="text-[10px] text-gray-600 font-mono truncate max-w-[120px]">
                      All providers
                    </span>
                  </button>

                  <div className="h-px bg-white/5 mx-3 my-0.5" />

                  <button
                    onClick={rerunSetupWizard}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-300 hover:bg-white/5 rounded-lg transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded bg-red-500/10 text-red-400 group-hover:bg-red-500/20 transition-colors">
                        <RotateCcw size={14} />
                      </div>
                      <span className="font-medium text-red-200/80 group-hover:text-red-200 transition-colors">Reset Application Setup</span>
                    </div>
                  </button>
                </div>
              </div>
            </TabPanel>
          )}
        </div>
      </div>
    </div>
  );
}
