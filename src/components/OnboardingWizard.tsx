import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sparkles,
  Check,
  X,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Terminal,
  Bell,
  Link2,
  FolderSearch,
  Loader2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Cpu,
  Command,
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { OnboardingStatus, HookVerifyResult, ScanResult } from "../lib/types";

// --- Props types ---

interface OnboardingWizardProps {
  onComplete: () => void;
}

interface StepHeaderProps {
  title: string;
  subtitle: string;
  gradient?: string;
}

interface StatusItemProps {
  status: "success" | "warning" | "error";
  label: string;
  detail?: string;
  action?: React.ReactNode;
}

interface Step1Props {
  status: OnboardingStatus | null;
  onRefresh: () => void;
}

interface Step2Props {
  status: OnboardingStatus | null;
  installing: boolean;
  result: HookVerifyResult | null;
  showPreview: boolean;
  onTogglePreview: () => void;
  onInstall: () => void;
}

interface Preferences {
  taskNotifications: boolean;
  notificationSound: boolean;
  voiceNotifications: boolean;
  launchAtLogin: boolean;
  hideOnBlur: boolean;
}

interface Step3Props {
  platform: string;
  preferences: Preferences;
  onChange: (prefs: Preferences) => void;
}

interface Step4Props {
  scanResult: ScanResult | null;
  scanning: boolean;
  scanProgress: number;
  onStartScan: () => void;
}

// --- Shared sub-components ---

function StepHeader({ title, subtitle, gradient = "from-blue-400 to-purple-400" }: StepHeaderProps): React.ReactElement {
  return (
    <div className="text-center mb-8">
      <h2 className={`text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r ${gradient} mb-2 tracking-tight`}>
        {title}
      </h2>
      <p className="text-sm text-gray-400 font-medium">{subtitle}</p>
    </div>
  );
}

function StatusItem({ status, label, detail, action }: StatusItemProps): React.ReactElement {
  const icons = {
    success: Check,
    warning: AlertTriangle,
    error: X,
  };

  const colors = {
    success: "bg-emerald-500/20 text-emerald-400",
    warning: "bg-yellow-500/20 text-yellow-400",
    error: "bg-red-500/20 text-red-400",
  };

  const Icon = icons[status];

  return (
    <div className="flex items-center gap-4 py-3 group">
      <div className={`w-8 h-8 rounded-full ${colors[status]} flex items-center justify-center shrink-0 transition-transform group-hover:scale-110`}>
        <Icon size={16} strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-200">{label}</p>
          {detail && <span className="text-xs text-gray-500 font-mono">{detail}</span>}
        </div>
      </div>
      {action && <div className="ml-2">{action}</div>}
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }): React.ReactElement {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        onChange();
      }}
      className={`relative w-11 h-6 rounded-full transition-all duration-300 ease-in-out border ${checked
        ? "bg-blue-600 border-blue-500 shadow-[0_0_10px_rgba(37,99,235,0.3)]"
        : "bg-gray-800 border-gray-700 hover:border-gray-600"
        }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 bg-white rounded-full shadow-sm transition-transform duration-300 ${checked ? "translate-x-5" : ""
          }`}
      />
    </button>
  );
}

// --- Main component ---

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps): React.ReactElement {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Step 2: Hooks
  const [hooksInstalling, setHooksInstalling] = useState(false);
  const [hooksResult, setHooksResult] = useState<HookVerifyResult | null>(null);
  const [showHookPreview, setShowHookPreview] = useState(false);

  // Step 3: Preferences
  const [preferences, setPreferences] = useState<Preferences>({
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

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const result = await invoke<OnboardingStatus>("get_onboarding_status", {});
      setStatus(result);

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
      setScanResult({ session_count: 0, project_count: 0, total_tokens: 0, projects: [] });
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

  const canProceed = step !== 1 || status?.cli_installed === true;

  const handleNext = async () => {
    if (step === 3) {
      await savePreferences();
    }

    if (step === 4) {
      await completeOnboarding();
    } else {
      setStep((step + 1) as 1 | 2 | 3 | 4);
      if (step === 3) {
        setTimeout(() => startScan(), 300);
      }
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((step - 1) as 1 | 2 | 3 | 4);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gray-950/80 backdrop-blur-xl flex items-center justify-center z-50">
        <Loader2 size={32} className="text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-6">
      {/* Background Ambient Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[20%] left-[20%] w-96 h-96 bg-blue-600/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-[20%] right-[20%] w-96 h-96 bg-purple-600/10 rounded-full blur-[100px]" />
      </div>

      <div className="relative w-full max-w-lg bg-gray-900/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Top Glint */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

        {/* Content Area */}
        <div className="p-8 flex-1 overflow-y-auto custom-scrollbar">
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
              scanResult={scanResult}
              scanning={scanning}
              scanProgress={scanProgress}
              onStartScan={startScan}
            />
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-6 bg-white/[0.02] border-t border-white/5 flex items-center justify-between relative mt-auto">

          {/* Progress Indicators (Dots) */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${s === step ? "w-6 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" :
                  s < step ? "w-1.5 bg-blue-500/50" : "w-1.5 bg-gray-700"
                  }`}
              />
            ))}
          </div>

          <button
            onClick={handleBack}
            className={`flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors hover:bg-white/5 rounded-lg ${step === 1 ? "opacity-0 pointer-events-none" : ""
              }`}
          >
            <ArrowLeft size={16} />
            Back
          </button>

          <button
            onClick={handleNext}
            disabled={!canProceed || (step === 4 && scanning)}
            className="group flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:from-blue-700 active:to-indigo-700 text-white text-sm font-medium rounded-lg shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {step === 4 ? "Get Started" : "Continue"}
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>

      {/* Skip Button - Outside the card for minimalism */}
      <button
        onClick={completeOnboarding}
        className="absolute bottom-6 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        Skip setup (advanced users)
      </button>
    </div>
  );
}

// --- Step components ---

function Step1Welcome({ status, onRefresh }: Step1Props): React.ReactElement {

  const cliStatus = status?.cli_installed ? "success" : "error";
  const loginStatus = status?.credentials_found ? "success" : "warning";
  const dirStatus = status?.claude_dir_exists ? "success" : "warning";

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-center mb-6">
        <div className="w-20 h-20 bg-gradient-to-tr from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
          <Sparkles size={40} className="text-white fill-white/20" />
        </div>
      </div>

      <StepHeader
        title="Welcome to Alice"
        subtitle="Your intelligent companion for Claude Code"
      />

      <div className="space-y-1 mt-8">
        <StatusItem
          status={cliStatus}
          label="Claude Code CLI"
          detail={status?.cli_installed ? status.cli_version || "Installed" : "Not Found"}
          action={!status?.cli_installed && (
            <button
              onClick={onRefresh}
              className="p-1.5 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-md transition-colors"
              title="Refresh Status"
            >
              <RefreshCw size={14} />
            </button>
          )}
        />

        <StatusItem
          status={loginStatus}
          label="Authentication"
          detail={status?.credentials_found ? "Connected" : "Not connected"}
        />

        <StatusItem
          status={dirStatus}
          label="Claude Directory"
          detail={status?.claude_dir_exists ? "Found" : "Not found"}
        />
      </div>

      {!status?.cli_installed && (
        <div className="mt-6 p-4 bg-red-500/5 border border-red-500/10 rounded-xl">
          <div className="flex gap-3 mb-2">
            <Terminal size={16} className="text-red-400 mt-0.5" />
            <p className="text-sm text-red-300 font-medium">Installation Required</p>
          </div>
          <code className="block w-full p-2.5 bg-black/40 rounded-lg text-xs font-mono text-gray-300 select-all border border-white/5">
            npm install -g @anthropic-ai/claude-code
          </code>
        </div>
      )}
    </div>
  );
}

function Step2Hooks({ status, installing, result, showPreview, onTogglePreview, onInstall }: Step2Props): React.ReactElement {
  const isInstalled = result?.success || status?.hooks_installed;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <StepHeader
        title="Enable Tracking"
        subtitle="Connect Alice to your Claude Code sessions"
        gradient="from-emerald-400 to-cyan-400"
      />

      <div className="space-y-4">
        {/* Feature Cards */}
        <div className="grid grid-cols-1 gap-3">
          <div className="p-4 bg-white/5 border border-white/5 rounded-xl hover:bg-white/[0.07] transition-colors">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Zap size={18} className="text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-200">Real-time Activity</h3>
                <p className="text-xs text-gray-500">Track when sessions start and end</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-white/5 border border-white/5 rounded-xl hover:bg-white/[0.07] transition-colors">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Cpu size={18} className="text-purple-400" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-200">Token Usage</h3>
                <p className="text-xs text-gray-500">Monitor costs and token consumption</p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Area */}
        <div className="mt-8">
          {isInstalled ? (
            <div className="flex flex-col items-center justify-center p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mb-3">
                <Check size={24} className="text-emerald-400" />
              </div>
              <p className="text-emerald-400 font-medium text-sm">Hooks Installed Successfully</p>
            </div>
          ) : (
            <button
              onClick={onInstall}
              disabled={installing}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
            >
              {installing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Installing Hooks...</span>
                </>
              ) : (
                <>
                  <Link2 size={18} />
                  <span>Install Session Hooks</span>
                </>
              )}
            </button>
          )}
        </div>

        <button
          onClick={onTogglePreview}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mt-4 transition-colors"
        >
          {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showPreview ? "Hide details" : "Show technical details"}
        </button>

        {showPreview && (
          <div className="mt-2 p-3 bg-black/40 rounded-lg border border-white/5">
            <pre className="text-[10px] text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap">
              {status?.platform === "windows"
                ? "Checking %USERPROFILE%\\.claude\\settings.json"
                : "Checking ~/.claude/config.json and hooks setup..."}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function PreferenceItem({ icon: Icon, label, description, checked, onChange }: { icon: LucideIcon; label: string; description: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors group">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg transition-colors ${checked ? "bg-blue-500/20 text-blue-400" : "bg-gray-800 text-gray-500 group-hover:bg-gray-700"}`}>
          <Icon size={18} />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-200">{label}</p>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

function Step3Preferences({ platform, preferences, onChange }: Step3Props): React.ReactElement {
  const toggle = (key: keyof Preferences) => {
    onChange({ ...preferences, [key]: !preferences[key] });
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <StepHeader
        title="Preferences"
        subtitle="Customize your experience"
        gradient="from-pink-400 to-rose-400"
      />

      <div className="space-y-1">
        <PreferenceItem
          icon={Bell}
          label="Task Alerts"
          description="Notify when long-running tasks finish"
          checked={preferences.taskNotifications}
          onChange={() => toggle("taskNotifications")}
        />

        <PreferenceItem
          icon={Command}
          label="Launch at Login"
          description="Start Alice automatically"
          checked={preferences.launchAtLogin}
          onChange={() => toggle("launchAtLogin")}
        />

        <PreferenceItem
          icon={preferences.hideOnBlur ? EyeOff : Eye}
          label="Auto-Hide"
          description="Hide window when clicking away"
          checked={preferences.hideOnBlur}
          onChange={() => toggle("hideOnBlur")}
        />

        {(platform === "macos" || platform === "windows") && (
          <PreferenceItem
            icon={preferences.voiceNotifications ? Zap : Bell}
            label="Voice Feedback"
            description="Spoken notifications for events"
            checked={preferences.voiceNotifications}
            onChange={() => toggle("voiceNotifications")}
          />
        )}
      </div>
    </div>
  );
}

function Step4Completion({ scanResult, scanning, scanProgress, onStartScan }: Step4Props): React.ReactElement {
  const scanDone = scanResult != null && !scanning;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-center">
      <div className="mb-8 relative inline-flex items-center justify-center">
        {/* Background pulses */}
        {scanning && (
          <>
            <div className="absolute inset-0 bg-emerald-500/30 rounded-full animate-ping opacity-75" />
            <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-pulse" />
          </>
        )}

        <div className={`w-20 h-20 rounded-2xl flex items-center justify-center shadow-xl transition-all duration-500 ${scanning ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" :
          scanDone ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-500/40" :
            "bg-gray-800 text-gray-400"
          }`}>
          {scanning ? <Loader2 size={40} className="animate-spin" /> :
            scanDone ? <Check size={40} className="drop-shadow-md" /> :
              <FolderSearch size={40} />}
        </div>
      </div>

      <h2 className="text-2xl font-bold text-white mb-2">
        {scanning ? "Scanning Sessions..." : scanDone ? "All Set!" : "Finalizing..."}
      </h2>

      <p className="text-sm text-gray-400 mb-8 max-w-xs mx-auto">
        {scanning ? "Indexing your Claude Code history in the background." :
          scanDone ? "Alice is ready to help you manage your coding sessions." :
            "One last step to index your data."}
      </p>

      {scanning && (
        <div className="max-w-xs mx-auto mb-8">
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-300 ease-out" style={{ width: `${scanProgress}%` }} />
          </div>
          <p className="text-xs text-gray-600 mt-2 font-mono">{scanProgress}% completed</p>
        </div>
      )}

      {scanDone && scanResult && (
        <div className="grid grid-cols-2 gap-4 animate-in fade-in zoom-in-50 duration-500">
          <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl">
            <p className="text-3xl font-bold text-emerald-400 tracking-tight">{scanResult.session_count}</p>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mt-1">Sessions</p>
          </div>
          <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl">
            <p className="text-3xl font-bold text-blue-400 tracking-tight">{scanResult.project_count}</p>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mt-1">Projects</p>
          </div>
        </div>
      )}

      {!scanning && !scanDone && (
        <button
          onClick={onStartScan}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-emerald-500/20"
        >
          Start Session Scan
        </button>
      )}
    </div>
  );
}
