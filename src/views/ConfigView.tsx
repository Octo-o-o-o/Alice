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
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { Theme } from "../lib/types";
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
