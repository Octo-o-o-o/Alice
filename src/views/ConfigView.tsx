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
} from "lucide-react";
import { getModKey, getClaudeDir, isMacSync } from "../lib/platform";

interface AppConfig {
  launch_at_login: boolean;
  auto_hide_on_blur: boolean;
  notification_sound: boolean;
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
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [configResult, sysInfo] = await Promise.all([
        invoke<AppConfig>("get_config", {}),
        invoke<SystemInfo>("get_system_info", {}),
      ]);
      setConfig(configResult);
      setSystemInfo(sysInfo);
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
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
