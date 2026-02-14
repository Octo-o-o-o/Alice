import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Terminal,
  Bell,
  Link2,
  FolderSearch,
  Loader2,
  Settings,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import type { OnboardingStatus, HookVerifyResult, ScanResult } from "../lib/types";

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4;

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Step 2: Hooks
  const [hooksInstalling, setHooksInstalling] = useState(false);
  const [hooksResult, setHooksResult] = useState<HookVerifyResult | null>(null);
  const [showHookPreview, setShowHookPreview] = useState(false);

  // Step 3: Preferences
  const [preferences, setPreferences] = useState({
    taskNotifications: true,
    notificationSound: true,
    voiceNotifications: false,
    launchAtLogin: false,
    hideOnBlur: true,
  });

  // Step 4: Scan
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  // Load onboarding status
  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const result = await invoke<OnboardingStatus>("get_onboarding_status", {});
      setStatus(result);

      // If hooks already installed, pre-set the result
      if (result.hooks_installed) {
        setHooksResult({
          success: true,
          settings_path: "",
          hooks_file: "",
          session_start_installed: true,
          session_end_installed: true,
        });
      }
    } catch (e) {
      console.error("Failed to load onboarding status:", e);
    } finally {
      setLoading(false);
    }
  };

  const installHooks = async () => {
    setHooksInstalling(true);
    try {
      const result = await invoke<HookVerifyResult>("install_and_verify_hooks", {});
      setHooksResult(result);
    } catch (e) {
      console.error("Failed to install hooks:", e);
      setHooksResult({
        success: false,
        settings_path: "",
        hooks_file: "",
        session_start_installed: false,
        session_end_installed: false,
      });
    } finally {
      setHooksInstalling(false);
    }
  };

  const savePreferences = async () => {
    try {
      await invoke("update_config", { key: "notification_sound", value: preferences.notificationSound });
      await invoke("update_config", { key: "voice_notifications", value: preferences.voiceNotifications });
      await invoke("update_config", { key: "launch_at_login", value: preferences.launchAtLogin });
      await invoke("update_config", { key: "auto_hide_on_blur", value: preferences.hideOnBlur });
      await invoke("update_config", { key: "notifications.on_task_completed", value: preferences.taskNotifications });
    } catch (e) {
      console.error("Failed to save preferences:", e);
    }
  };

  const startScan = useCallback(async () => {
    setScanning(true);
    setScanProgress(0);

    // Simulate progress animation
    const progressInterval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return prev + 10;
      });
    }, 150);

    try {
      const result = await invoke<ScanResult>("scan_claude_directory", {});
      clearInterval(progressInterval);
      setScanProgress(100);
      setScanResult(result);
    } catch (e) {
      console.error("Failed to scan:", e);
      clearInterval(progressInterval);
      setScanProgress(100);
      setScanResult({
        session_count: 0,
        project_count: 0,
        total_tokens: 0,
        projects: [],
      });
    } finally {
      setScanning(false);
    }
  }, []);

  const completeOnboarding = async () => {
    try {
      await invoke("update_config", { key: "onboarding_completed", value: true });
      onComplete();
    } catch (e) {
      console.error("Failed to complete onboarding:", e);
    }
  };

  const skipAll = async () => {
    try {
      await invoke("update_config", { key: "onboarding_completed", value: true });
      onComplete();
    } catch (e) {
      console.error("Failed to skip onboarding:", e);
    }
  };

  const canProceed = () => {
    if (step === 1) {
      // Must have CLI installed
      return status?.cli_installed === true;
    }
    return true;
  };

  const handleNext = async () => {
    if (step === 3) {
      await savePreferences();
    }

    if (step === 4) {
      await completeOnboarding();
    } else {
      setStep((step + 1) as Step);

      // Auto-start scan when entering step 4
      if (step === 3) {
        setTimeout(() => startScan(), 300);
      }
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((step - 1) as Step);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gray-950/95 backdrop-blur-xl flex items-center justify-center z-50">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-950/95 backdrop-blur-xl flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all ${
                s === step
                  ? "border-blue-500 bg-blue-500/20 text-blue-400"
                  : s < step
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-gray-700 text-gray-600"
              }`}
            >
              {s < step ? <CheckCircle2 size={16} /> : s}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-white/[0.03] border border-white/5 rounded-xl p-6 min-h-[320px]">
          {step === 1 && <Step1Welcome status={status} onRefresh={loadStatus} />}
          {step === 2 && (
            <Step2Hooks
              status={status}
              installing={hooksInstalling}
              result={hooksResult}
              showPreview={showHookPreview}
              onTogglePreview={() => setShowHookPreview(!showHookPreview)}
              onInstall={installHooks}
            />
          )}
          {step === 3 && (
            <Step3Preferences
              platform={status?.platform || "macos"}
              preferences={preferences}
              onChange={setPreferences}
            />
          )}
          {step === 4 && (
            <Step4Completion
              status={status}
              hooksResult={hooksResult}
              scanResult={scanResult}
              scanning={scanning}
              scanProgress={scanProgress}
              onStartScan={startScan}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={handleBack}
            className={`flex items-center gap-1 px-4 py-2 text-sm text-gray-400 hover:text-gray-300 transition-colors ${
              step === 1 ? "invisible" : ""
            }`}
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <button
            onClick={handleNext}
            disabled={!canProceed() || (step === 4 && scanning)}
            className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {step === 4 ? "Get Started" : "Continue"}
            <ArrowRight size={14} />
          </button>
        </div>

        {/* Skip option */}
        <button
          onClick={skipAll}
          className="w-full mt-4 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Skip setup (advanced users)
        </button>
      </div>
    </div>
  );
}

// Step 1: Welcome & Environment Check
function Step1Welcome({
  status,
  onRefresh,
}: {
  status: OnboardingStatus | null;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="w-14 h-14 mx-auto bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl flex items-center justify-center mb-3">
          <Sparkles size={28} className="text-white" />
        </div>
        <h2 className="text-lg font-semibold text-gray-100">Welcome to Alice</h2>
        <p className="text-sm text-gray-400 mt-1">Claude Code Desktop Assistant</p>
      </div>

      <div className="space-y-2">
        {/* CLI Status */}
        <div className="flex items-center gap-3 p-3 bg-white/[0.03] rounded-lg border border-white/5">
          {status?.cli_installed ? (
            <CheckCircle2 size={18} className="text-green-500 shrink-0" />
          ) : (
            <XCircle size={18} className="text-red-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200">Claude Code CLI</p>
            <p className="text-xs text-gray-500 truncate">
              {status?.cli_installed
                ? status.cli_version || "Installed"
                : "Not installed"}
            </p>
          </div>
        </div>

        {/* Login Status */}
        <div className="flex items-center gap-3 p-3 bg-white/[0.03] rounded-lg border border-white/5">
          {status?.credentials_found ? (
            <CheckCircle2 size={18} className="text-green-500 shrink-0" />
          ) : (
            <AlertTriangle size={18} className="text-yellow-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200">Login Status</p>
            <p className="text-xs text-gray-500 truncate">
              {status?.credentials_found
                ? status.account_email || "Connected"
                : "Not logged in (optional)"}
            </p>
          </div>
        </div>

        {/* Claude Directory */}
        <div className="flex items-center gap-3 p-3 bg-white/[0.03] rounded-lg border border-white/5">
          {status?.claude_dir_exists ? (
            <CheckCircle2 size={18} className="text-green-500 shrink-0" />
          ) : (
            <XCircle size={18} className="text-red-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200">Claude Directory</p>
            <p className="text-xs text-gray-500">
              {status?.claude_dir_exists
                ? status?.platform === "windows"
                  ? "%USERPROFILE%\\.claude\\ found"
                  : "~/.claude/ found"
                : "Not found"}
            </p>
          </div>
        </div>
      </div>

      {!status?.cli_installed && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-xs text-red-400">
            Claude Code CLI is required. Install it with:
          </p>
          <code className="text-xs text-red-300 bg-black/30 px-2 py-1 rounded mt-1 block">
            npm install -g @anthropic-ai/claude-code
          </code>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 mt-2"
          >
            <RefreshCw size={12} />
            Re-check
          </button>
        </div>
      )}

      {status?.existing_sessions_count ? (
        <p className="text-xs text-gray-500 text-center">
          Found {status.existing_sessions_count} existing sessions
        </p>
      ) : null}
    </div>
  );
}

// Step 2: Hooks Installation
function Step2Hooks({
  status,
  installing,
  result,
  showPreview,
  onTogglePreview,
  onInstall,
}: {
  status: OnboardingStatus | null;
  installing: boolean;
  result: HookVerifyResult | null;
  showPreview: boolean;
  onTogglePreview: () => void;
  onInstall: () => void;
}) {
  const isInstalled = result?.success || status?.hooks_installed;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="w-14 h-14 mx-auto bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center mb-3">
          <Link2 size={28} className="text-white" />
        </div>
        <h2 className="text-lg font-semibold text-gray-100">Enable Session Tracking</h2>
        <p className="text-sm text-gray-400 mt-1">
          Hooks let Alice track Claude Code sessions in real-time
        </p>
      </div>

      <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5 space-y-2">
        <p className="text-xs text-gray-400">
          Will add to {status?.platform === "windows" ? "%USERPROFILE%\\.claude\\settings.json" : "~/.claude/settings.json"}:
        </p>
        <ul className="text-xs text-gray-300 space-y-1">
          <li className="flex items-center gap-2">
            <CheckCircle2 size={12} className="text-blue-400" />
            SessionStart - Track when sessions begin
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 size={12} className="text-blue-400" />
            SessionEnd - Track when sessions complete
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 size={12} className="text-blue-400" />
            Stop - Track when Claude stops
          </li>
        </ul>
      </div>

      {/* Preview toggle */}
      <button
        onClick={onTogglePreview}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400"
      >
        {showPreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showPreview ? "Hide" : "Preview"} configuration
      </button>

      {showPreview && (
        <pre className="text-[10px] text-gray-400 bg-black/30 p-2 rounded overflow-x-auto max-h-24">
{status?.platform === "windows"
  ? `"hooks": {
  "SessionStart": [{
    "type": "command",
    "command": "powershell -Command ..."
  }]
}`
  : `"hooks": {
  "SessionStart": [{
    "type": "command",
    "command": "echo '{...}' >> ~/.alice/hooks-events.jsonl"
  }]
}`}
        </pre>
      )}

      {/* Install button or status */}
      {isInstalled ? (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <CheckCircle2 size={18} className="text-green-500" />
          <span className="text-sm text-green-400">Hooks installed successfully</span>
        </div>
      ) : (
        <button
          onClick={onInstall}
          disabled={installing}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
        >
          {installing ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Installing...
            </>
          ) : (
            <>
              <Link2 size={16} />
              Install Hooks
            </>
          )}
        </button>
      )}

      <p className="text-xs text-gray-600 text-center">
        You can skip this step, but real-time tracking won't work
      </p>
    </div>
  );
}

// Step 3: Preferences
function Step3Preferences({
  platform,
  preferences,
  onChange,
}: {
  platform: string;
  preferences: {
    taskNotifications: boolean;
    notificationSound: boolean;
    voiceNotifications: boolean;
    launchAtLogin: boolean;
    hideOnBlur: boolean;
  };
  onChange: (prefs: typeof preferences) => void;
}) {
  const toggle = (key: keyof typeof preferences) => {
    onChange({ ...preferences, [key]: !preferences[key] });
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="w-14 h-14 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mb-3">
          <Settings size={28} className="text-white" />
        </div>
        <h2 className="text-lg font-semibold text-gray-100">Preferences</h2>
        <p className="text-sm text-gray-400 mt-1">Customize your experience</p>
      </div>

      {/* Notifications */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Notifications</p>

        <label className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/5 cursor-pointer">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-gray-400" />
            <span className="text-sm text-gray-200">Task completion alerts</span>
          </div>
          <ToggleSwitch checked={preferences.taskNotifications} onChange={() => toggle("taskNotifications")} />
        </label>

        <label className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/5 cursor-pointer">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-gray-400" />
            <span className="text-sm text-gray-200">Notification sound</span>
          </div>
          <ToggleSwitch checked={preferences.notificationSound} onChange={() => toggle("notificationSound")} />
        </label>

        {(platform === "macos" || platform === "windows") && (
          <label className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/5 cursor-pointer">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-gray-400" />
              <span className="text-sm text-gray-200">Voice notifications</span>
            </div>
            <ToggleSwitch checked={preferences.voiceNotifications} onChange={() => toggle("voiceNotifications")} />
          </label>
        )}
      </div>

      {/* Behavior */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Behavior</p>

        <label className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/5 cursor-pointer">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-gray-400" />
            <span className="text-sm text-gray-200">Launch at startup</span>
          </div>
          <ToggleSwitch checked={preferences.launchAtLogin} onChange={() => toggle("launchAtLogin")} />
        </label>

        <label className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/5 cursor-pointer">
          <div className="flex items-center gap-2">
            {preferences.hideOnBlur ? <EyeOff size={16} className="text-gray-400" /> : <Eye size={16} className="text-gray-400" />}
            <span className="text-sm text-gray-200">Hide when clicking outside</span>
          </div>
          <ToggleSwitch checked={preferences.hideOnBlur} onChange={() => toggle("hideOnBlur")} />
        </label>
      </div>
    </div>
  );
}

// Step 4: Completion & Scan
function Step4Completion({
  status,
  hooksResult,
  scanResult,
  scanning,
  scanProgress,
  onStartScan,
}: {
  status: OnboardingStatus | null;
  hooksResult: HookVerifyResult | null;
  scanResult: ScanResult | null;
  scanning: boolean;
  scanProgress: number;
  onStartScan: () => void;
}) {
  return (
    <div className="space-y-4 text-center">
      <div className="w-14 h-14 mx-auto bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center">
        {scanning ? (
          <Loader2 size={28} className="text-white animate-spin" />
        ) : scanResult ? (
          <CheckCircle2 size={28} className="text-white" />
        ) : (
          <FolderSearch size={28} className="text-white" />
        )}
      </div>

      <h2 className="text-lg font-semibold text-gray-100">
        {scanning ? "Scanning Sessions..." : scanResult ? "All Set!" : "Almost Done"}
      </h2>

      {/* Scan progress */}
      {scanning && (
        <div className="space-y-2">
          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            Looking for sessions in {status?.platform === "windows" ? "%USERPROFILE%\\.claude\\" : "~/.claude/"}
          </p>
        </div>
      )}

      {/* Scan results */}
      {scanResult && !scanning && (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
            <p className="text-2xl font-bold text-emerald-400">{scanResult.session_count}</p>
            <p className="text-xs text-gray-500">Sessions</p>
          </div>
          <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
            <p className="text-2xl font-bold text-blue-400">{scanResult.project_count}</p>
            <p className="text-xs text-gray-500">Projects</p>
          </div>
        </div>
      )}

      {/* Configuration summary */}
      {scanResult && !scanning && (
        <div className="space-y-1 pt-2">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Setup Summary</p>
          <div className="flex items-center justify-center gap-4 text-xs">
            <span className="flex items-center gap-1 text-gray-400">
              <CheckCircle2 size={12} className="text-green-500" />
              CLI
            </span>
            <span className="flex items-center gap-1 text-gray-400">
              {hooksResult?.success || status?.hooks_installed ? (
                <CheckCircle2 size={12} className="text-green-500" />
              ) : (
                <XCircle size={12} className="text-yellow-500" />
              )}
              Hooks
            </span>
            <span className="flex items-center gap-1 text-gray-400">
              {status?.credentials_found ? (
                <CheckCircle2 size={12} className="text-green-500" />
              ) : (
                <AlertTriangle size={12} className="text-yellow-500" />
              )}
              Login
            </span>
          </div>
        </div>
      )}

      {/* Manual scan trigger if not auto-started */}
      {!scanning && !scanResult && (
        <button
          onClick={onStartScan}
          className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
        >
          Scan Sessions
        </button>
      )}

      <p className="text-xs text-gray-600">
        You can re-run this wizard anytime from Settings
      </p>
    </div>
  );
}

// Toggle switch component
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        onChange();
      }}
      className={`relative w-10 h-6 rounded-full transition-colors ${
        checked ? "bg-blue-600" : "bg-gray-700"
      }`}
    >
      <span
        className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}
