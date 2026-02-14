import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings,
  Bell,
  Keyboard,
  Info,
  ExternalLink,
  CheckCircle2,
  XCircle,
  User,
  RefreshCw,
  HardDrive,
  Webhook,
  Download,
  RotateCcw,
  Sun,
  Moon,
  Monitor,
  Terminal,
  Layers,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  FolderOpen,
  Key,
  Cpu,
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { Theme, ClaudeEnvironment } from "../lib/types";
import { useToast } from "../contexts/ToastContext";
import { getModKey, getClaudeDir, isMacSync } from "../lib/platform";

interface AppConfig {
  launch_at_login: boolean;
  auto_hide_on_blur: boolean;
  notification_sound: boolean;
  voice_notifications: boolean;
  notifications: {
    on_task_completed: boolean;
    on_task_error: boolean;
    on_needs_input: boolean;
    on_queue_started: boolean;
    on_daily_report: boolean;
  };
  hooks_installed: boolean;
  data_retention_days: number;
  daily_report_time: string;
  terminal_app: string;
  custom_terminal_command: string;
  claude_environments: ClaudeEnvironment[];
  active_environment_id?: string | null;
}

interface TerminalOption {
  value: string;
  label: string;
}

interface SystemInfo {
  claude_installed: boolean;
  claude_version: string | null;
  credentials_exist: boolean;
  account_email: string | null;
  db_stats: {
    db_size_bytes: number;
    report_count: number;
  };
}

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
}

function Toggle({ enabled, onChange, label, description }: ToggleProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm text-gray-200">{label}</p>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-9 h-5 rounded-full transition-colors ${
          enabled ? "bg-blue-500" : "bg-gray-700"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
            enabled ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export default function ConfigView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [terminalOptions, setTerminalOptions] = useState<TerminalOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingHooks, setInstallingHooks] = useState(false);
  const toast = useToast();
  const { theme, setTheme } = useTheme();

  // Environment management state
  const [editingEnv, setEditingEnv] = useState<ClaudeEnvironment | null>(null);
  const [isAddingEnv, setIsAddingEnv] = useState(false);
  const [envForm, setEnvForm] = useState<Partial<ClaudeEnvironment>>({});

  const loadData = async () => {
    try {
      const [configResult, sysInfo, terminals] = await Promise.all([
        invoke<AppConfig>("get_config", {}),
        invoke<SystemInfo>("get_system_info", {}),
        invoke<TerminalOption[]>("get_available_terminals", {}),
      ]);
      setConfig(configResult);
      setSystemInfo(sysInfo);
      setTerminalOptions(terminals);
    } catch (error) {
      console.error("Failed to load config:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const updateSetting = async (key: string, value: boolean | number | string) => {
    try {
      const result = await invoke<AppConfig>("update_config", {
        key,
        value,
      });
      setConfig(result);
    } catch (error) {
      console.error("Failed to update config:", error);
    }
  };

  const installHooks = async () => {
    try {
      setInstallingHooks(true);
      const result = await invoke<{ success: boolean; settings_path: string; hooks_file: string }>("install_hooks", {});
      if (result.success) {
        toast.success("Hooks installed successfully");
        loadData(); // Refresh config to show hooks_installed = true
      }
    } catch (error) {
      console.error("Failed to install hooks:", error);
      toast.error("Failed to install hooks");
    } finally {
      setInstallingHooks(false);
    }
  };

  const rerunSetupWizard = async () => {
    try {
      await invoke("update_config", { key: "onboarding_completed", value: false });
      // Reload the page to trigger the onboarding wizard
      window.location.reload();
    } catch (error) {
      console.error("Failed to reset onboarding:", error);
      toast.error("Failed to reset setup wizard");
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
  };

  // Environment management functions
  const startAddEnv = () => {
    setEnvForm({
      id: "",
      name: "",
      config_dir: "",
      api_key: "",
      model: "",
      command: "",
      enabled: true,
    });
    setIsAddingEnv(true);
    setEditingEnv(null);
  };

  const startEditEnv = (env: ClaudeEnvironment) => {
    setEnvForm({ ...env });
    setEditingEnv(env);
    setIsAddingEnv(false);
  };

  const cancelEnvEdit = () => {
    setEditingEnv(null);
    setIsAddingEnv(false);
    setEnvForm({});
  };

  const saveEnv = async () => {
    if (!envForm.id || !envForm.name) {
      toast.error("ID and Name are required");
      return;
    }

    try {
      const envData: ClaudeEnvironment = {
        id: envForm.id,
        name: envForm.name,
        config_dir: envForm.config_dir || "",
        api_key: envForm.api_key || null,
        model: envForm.model || null,
        command: envForm.command || null,
        enabled: envForm.enabled ?? true,
      };

      if (isAddingEnv) {
        await invoke<AppConfig>("add_claude_environment", { env: envData });
        toast.success("Environment added");
      } else {
        await invoke<AppConfig>("update_claude_environment", { env: envData });
        toast.success("Environment updated");
      }
      loadData();
      cancelEnvEdit();
    } catch (error) {
      console.error("Failed to save environment:", error);
      toast.error(`Failed to save: ${error}`);
    }
  };

  const deleteEnv = async (id: string) => {
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
  };

  const setActiveEnv = async (id: string) => {
    try {
      await invoke<AppConfig>("set_active_environment", { environmentId: id });
      toast.success("Active environment changed");
      loadData();
    } catch (error) {
      console.error("Failed to set active environment:", error);
      toast.error(`Failed to set active: ${error}`);
    }
  };

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 space-y-4">
        {/* Account */}
        <section>
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <User size={12} />
            Account
          </h3>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {systemInfo?.credentials_exist ? (
                  <CheckCircle2 size={14} className="text-green-500" />
                ) : (
                  <XCircle size={14} className="text-yellow-500" />
                )}
                <div>
                  <span className="text-sm text-gray-200">
                    {systemInfo?.credentials_exist ? "Connected" : "Not logged in"}
                  </span>
                  {systemInfo?.account_email && (
                    <p className="text-xs text-gray-500">{systemInfo.account_email}</p>
                  )}
                </div>
              </div>
            </div>
            {systemInfo?.claude_installed && systemInfo.claude_version && (
              <p className="text-xs text-gray-500 mt-2">
                Claude Code: {systemInfo.claude_version}
              </p>
            )}
            {!systemInfo?.claude_installed && (
              <p className="text-xs text-yellow-500 mt-2">
                Claude Code CLI not found. Please install it first.
              </p>
            )}
          </div>
        </section>

        {/* Claude Environments */}
        <section>
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Layers size={12} />
            Claude Environments
          </h3>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-3">
              Configure multiple Claude Code environments with custom API keys, models, or config directories.
            </p>

            {/* Environment List */}
            <div className="space-y-2 mb-3">
              {config?.claude_environments?.map((env) => (
                <div
                  key={env.id}
                  className={`p-2 rounded-lg border transition-colors ${
                    config.active_environment_id === env.id || (!config.active_environment_id && env.id === "default")
                      ? "border-blue-500/50 bg-blue-500/10"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  {editingEnv?.id === env.id ? (
                    // Edit Form
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={envForm.id || ""}
                          disabled
                          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-400 cursor-not-allowed"
                          placeholder="ID"
                        />
                        <input
                          type="text"
                          value={envForm.name || ""}
                          onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })}
                          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                          placeholder="Display Name"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <FolderOpen size={12} className="text-gray-500" />
                        <input
                          type="text"
                          value={envForm.config_dir || ""}
                          onChange={(e) => setEnvForm({ ...envForm, config_dir: e.target.value })}
                          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                          placeholder="Config dir (e.g., ~/.claude-yixiao)"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Key size={12} className="text-gray-500" />
                        <input
                          type="password"
                          value={envForm.api_key || ""}
                          onChange={(e) => setEnvForm({ ...envForm, api_key: e.target.value })}
                          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                          placeholder="API Key (optional)"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Cpu size={12} className="text-gray-500" />
                        <input
                          type="text"
                          value={envForm.model || ""}
                          onChange={(e) => setEnvForm({ ...envForm, model: e.target.value })}
                          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                          placeholder="Model (e.g., claude-sonnet-4-5-20250929)"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Terminal size={12} className="text-gray-500" />
                        <input
                          type="text"
                          value={envForm.command || ""}
                          onChange={(e) => setEnvForm({ ...envForm, command: e.target.value })}
                          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                          placeholder="CLI command (e.g., claude-yixiao)"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={cancelEnvEdit}
                          className="p-1 text-gray-400 hover:text-gray-200"
                        >
                          <X size={14} />
                        </button>
                        <button
                          onClick={saveEnv}
                          className="p-1 text-green-400 hover:text-green-300"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Display Mode
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-200 font-medium">{env.name}</span>
                          {(config.active_environment_id === env.id || (!config.active_environment_id && env.id === "default")) && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                              Active
                            </span>
                          )}
                          {!env.enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-500/20 text-gray-400 rounded">
                              Disabled
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 truncate mt-0.5">
                          {env.config_dir || "Default (~/.claude)"}
                          {env.model && ` • ${env.model}`}
                          {env.api_key && " • Custom API Key"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {env.id !== "default" && config.active_environment_id !== env.id && (
                          <button
                            onClick={() => setActiveEnv(env.id)}
                            className="p-1 text-gray-400 hover:text-blue-400"
                            title="Set as active"
                          >
                            <Check size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => startEditEnv(env)}
                          className="p-1 text-gray-400 hover:text-gray-200"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        {env.id !== "default" && (
                          <button
                            onClick={() => deleteEnv(env.id)}
                            className="p-1 text-gray-400 hover:text-red-400"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add New Environment Form */}
            {isAddingEnv ? (
              <div className="p-2 rounded-lg border border-white/10 bg-white/5 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={envForm.id || ""}
                    onChange={(e) => setEnvForm({ ...envForm, id: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
                    className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                    placeholder="ID (e.g., yixiao)"
                  />
                  <input
                    type="text"
                    value={envForm.name || ""}
                    onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })}
                    className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                    placeholder="Display Name"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <FolderOpen size={12} className="text-gray-500" />
                  <input
                    type="text"
                    value={envForm.config_dir || ""}
                    onChange={(e) => setEnvForm({ ...envForm, config_dir: e.target.value })}
                    className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                    placeholder="Config dir (e.g., ~/.claude-yixiao)"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Key size={12} className="text-gray-500" />
                  <input
                    type="password"
                    value={envForm.api_key || ""}
                    onChange={(e) => setEnvForm({ ...envForm, api_key: e.target.value })}
                    className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                    placeholder="API Key (optional)"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Cpu size={12} className="text-gray-500" />
                  <input
                    type="text"
                    value={envForm.model || ""}
                    onChange={(e) => setEnvForm({ ...envForm, model: e.target.value })}
                    className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                    placeholder="Model (e.g., claude-sonnet-4-5-20250929)"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Terminal size={12} className="text-gray-500" />
                  <input
                    type="text"
                    value={envForm.command || ""}
                    onChange={(e) => setEnvForm({ ...envForm, command: e.target.value })}
                    className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 font-mono focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
                    placeholder="CLI command (e.g., claude-yixiao)"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={cancelEnvEdit}
                    className="p-1 text-gray-400 hover:text-gray-200"
                  >
                    <X size={14} />
                  </button>
                  <button
                    onClick={saveEnv}
                    className="p-1 text-green-400 hover:text-green-300"
                  >
                    <Check size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={startAddEnv}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
              >
                <Plus size={12} />
                Add Environment
              </button>
            )}

            <p className="text-[10px] text-gray-600 mt-3">
              Tip: Use custom config directories to separate different Claude accounts (e.g., work vs personal).
            </p>
          </div>
        </section>

        {/* General */}
        <section>
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Settings size={12} />
            General
          </h3>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <Toggle
              enabled={config.launch_at_login}
              onChange={(v) => updateSetting("launch_at_login", v)}
              label="Launch at login"
              description="Start Alice when you log in"
            />
            <div className="border-t border-white/5 my-2" />
            <Toggle
              enabled={config.auto_hide_on_blur}
              onChange={(v) => updateSetting("auto_hide_on_blur", v)}
              label="Auto-hide on blur"
              description="Hide panel when clicking outside"
            />
            <div className="border-t border-white/5 dark:border-white/5 my-2" />
            <div className="py-2">
              <p className="text-sm text-gray-200 dark:text-gray-200 mb-1">Theme</p>
              <p className="text-xs text-gray-500 mb-2">Choose your preferred appearance</p>
              <div className="flex gap-2">
                {([
                  { value: "system", icon: Monitor, label: "System" },
                  { value: "light", icon: Sun, label: "Light" },
                  { value: "dark", icon: Moon, label: "Dark" },
                ] as const).map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value as Theme)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      theme === value
                        ? "bg-blue-500 text-white"
                        : "bg-white/10 dark:bg-white/10 text-gray-300 dark:text-gray-300 hover:bg-white/15 dark:hover:bg-white/15"
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Hooks */}
        <section>
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Webhook size={12} />
            Hooks Integration
          </h3>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {config.hooks_installed ? (
                  <CheckCircle2 size={14} className="text-green-500" />
                ) : (
                  <XCircle size={14} className="text-yellow-500" />
                )}
                <span className="text-sm text-gray-200">
                  {config.hooks_installed ? "Hooks installed" : "Hooks not installed"}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Hooks provide real-time session event tracking for better status updates and notifications.
            </p>
            <button
              onClick={installHooks}
              disabled={installingHooks}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
            >
              {installingHooks ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download size={12} />
                  {config.hooks_installed ? "Reinstall Hooks" : "Install Hooks"}
                </>
              )}
            </button>
          </div>
        </section>

        {/* Task Execution */}
        <section>
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Terminal size={12} />
            Task Execution
          </h3>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <div className="py-2">
              <p className="text-sm text-gray-200 mb-1">Terminal Application</p>
              <p className="text-xs text-gray-500 mb-2">
                Choose where to run queued tasks. Select a visible terminal to watch Claude work.
              </p>
              <div className="flex flex-wrap gap-2">
                {terminalOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateSetting("terminal_app", option.value)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      config?.terminal_app === option.value
                        ? "bg-blue-500 text-white"
                        : "bg-white/10 text-gray-300 hover:bg-white/15"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {config?.terminal_app === "custom" && (
              <>
                <div className="border-t border-white/5 my-2" />
                <div className="py-2">
                  <p className="text-sm text-gray-200 mb-1">Custom Terminal Command</p>
                  <p className="text-xs text-gray-500 mb-2">
                    Use {"{dir}"} for working directory and {"{cmd}"} for the command
                  </p>
                  <input
                    type="text"
                    value={config.custom_terminal_command}
                    onChange={(e) => updateSetting("custom_terminal_command", e.target.value)}
                    placeholder='e.g., open -a "Alacritty" --args -e sh -c "cd {dir} && {cmd}"'
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-xs text-gray-200 placeholder:text-gray-600 focus:ring-1 focus:ring-blue-500/50 focus:outline-none font-mono"
                  />
                </div>
              </>
            )}
            {config?.terminal_app === "background" && (
              <p className="text-xs text-yellow-500/80 mt-2">
                ⚠️ Background mode runs tasks invisibly. You won't see Claude's output.
              </p>
            )}
            {config?.terminal_app && config.terminal_app !== "background" && (
              <p className="text-xs text-green-500/80 mt-2">
                ✓ Tasks will open in a visible terminal window where you can watch Claude work.
              </p>
            )}
          </div>
        </section>

        {/* Notifications */}
        <section>
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Bell size={12} />
            Notifications
          </h3>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
            <Toggle
              enabled={config.notification_sound}
              onChange={(v) => updateSetting("notification_sound", v)}
              label="Notification sound"
              description="Play sound on task completion"
            />
            <Toggle
              enabled={config.voice_notifications}
              onChange={(v) => updateSetting("voice_notifications", v)}
              label="Voice notifications"
              description={isMacSync() ? "Speak notifications using macOS TTS" : "Speak notifications using system TTS"}
            />
            <div className="border-t border-white/5 my-2" />
            <Toggle
              enabled={config.notifications.on_task_completed}
              onChange={(v) => updateSetting("notifications.on_task_completed", v)}
              label="Task completed"
            />
            <Toggle
              enabled={config.notifications.on_task_error}
              onChange={(v) => updateSetting("notifications.on_task_error", v)}
              label="Task error"
            />
            <Toggle
              enabled={config.notifications.on_needs_input}
              onChange={(v) => updateSetting("notifications.on_needs_input", v)}
              label="Needs input"
            />
            <Toggle
              enabled={config.notifications.on_queue_started}
              onChange={(v) => updateSetting("notifications.on_queue_started", v)}
              label="Queue task started"
            />
          </div>
        </section>

        {/* Data */}
        <section>
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <HardDrive size={12} />
            Data
          </h3>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Database size</span>
              <span className="text-xs text-gray-300 font-mono">
                {systemInfo ? formatBytes(systemInfo.db_stats.db_size_bytes) : "..."}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Reports saved</span>
              <span className="text-xs text-gray-300 font-mono">
                {systemInfo?.db_stats.report_count ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Claude data</span>
              <span className="text-xs text-gray-300 font-mono">{getClaudeDir()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Alice data</span>
              <span className="text-xs text-gray-300 font-mono">{isMacSync() ? "~/.alice/" : "%USERPROFILE%\\.alice\\"}</span>
            </div>
            <div className="border-t border-white/5 my-2" />
            <div className="flex items-center gap-2">
              <button
                onClick={loadData}
                className="px-3 py-1 text-xs bg-white/10 hover:bg-white/15 text-gray-300 rounded transition-colors flex items-center gap-1"
              >
                <RefreshCw size={10} />
                Refresh
              </button>
              <button
                onClick={async () => {
                  try {
                    const count = await invoke<number>("rescan_sessions");
                    toast.success(`Rescanned ${count} sessions`);
                    loadData();
                  } catch (error) {
                    console.error("Failed to rescan:", error);
                    toast.error("Failed to rescan sessions");
                  }
                }}
                className="px-3 py-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded transition-colors flex items-center gap-1"
              >
                <RotateCcw size={10} />
                Rescan Sessions
              </button>
            </div>
          </div>
        </section>

        {/* Shortcuts */}
        <section>
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Keyboard size={12} />
            Keyboard Shortcuts
          </h3>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 space-y-2">
            {[
              { shortcut: `${getModKey()}K`, action: "Open search" },
              { shortcut: `${getModKey()}N`, action: "Add new task" },
              { shortcut: `${getModKey()}R`, action: "Refresh view" },
              { shortcut: `${getModKey()},`, action: "Open settings" },
              { shortcut: `${getModKey()}1-5`, action: "Switch tabs" },
              { shortcut: "Esc", action: "Close / Dismiss" },
            ].map((item) => (
              <div
                key={item.shortcut}
                className="flex items-center justify-between"
              >
                <span className="text-xs text-gray-400">{item.action}</span>
                <kbd className="text-[10px] text-gray-500 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 font-mono">
                  {item.shortcut}
                </kbd>
              </div>
            ))}
          </div>
        </section>

        {/* About */}
        <section>
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Info size={12} />
            About
          </h3>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Version</span>
              <span className="text-xs text-gray-300">0.1.0</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Built with</span>
              <span className="text-xs text-gray-300">Tauri 2.0 + React</span>
            </div>
            <div className="border-t border-white/5 my-2" />
            <div className="flex items-center gap-2">
              <a
                href="https://github.com/anthropics/claude-code"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 text-xs bg-white/10 hover:bg-white/15 text-gray-300 rounded transition-colors flex items-center gap-1"
              >
                Claude Code
                <ExternalLink size={10} />
              </a>
              <button
                onClick={rerunSetupWizard}
                className="px-3 py-1 text-xs bg-white/10 hover:bg-white/15 text-gray-300 rounded transition-colors flex items-center gap-1"
              >
                <RotateCcw size={10} />
                Re-run Setup Wizard
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
