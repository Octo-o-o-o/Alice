import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Terminal,
  Bell,
  Zap,
  FolderSearch,
  Loader2,
} from "lucide-react";

interface SystemInfo {
  claude_installed: boolean;
  claude_version: string | null;
  credentials_exist: boolean;
  account_email: string | null;
}

interface ScanResult {
  session_count: number;
  project_count: number;
  total_tokens: number;
  projects: string[];
}

interface OnboardingWizardProps {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  const loadSystemInfo = async () => {
    try {
      const info = await invoke<SystemInfo>("get_system_info", {});
      setSystemInfo(info);
    } catch (error) {
      console.error("Failed to load system info:", error);
    } finally {
      setLoading(false);
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
    } catch (error) {
      console.error("Failed to scan:", error);
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
      await invoke("update_config", {
        key: "onboarding_completed",
        value: true,
      });
      onComplete();
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
    }
  };

  const steps = [
    {
      title: "Welcome to Alice",
      icon: Sparkles,
      content: (
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl flex items-center justify-center">
            <Sparkles size={32} className="text-white" />
          </div>
          <h2 className="text-lg font-semibold text-gray-100">
            Welcome to Alice
          </h2>
          <p className="text-sm text-gray-400 max-w-xs mx-auto">
            Your Claude Code desktop assistant for managing tasks, sessions, and workflows.
          </p>
        </div>
      ),
    },
    {
      title: "Claude Code Status",
      icon: Terminal,
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-white/[0.03] rounded-lg border border-white/5">
            {systemInfo?.claude_installed ? (
              <CheckCircle2 size={20} className="text-green-500 shrink-0" />
            ) : (
              <XCircle size={20} className="text-red-500 shrink-0" />
            )}
            <div>
              <p className="text-sm text-gray-200">Claude Code CLI</p>
              <p className="text-xs text-gray-500">
                {systemInfo?.claude_installed
                  ? systemInfo.claude_version || "Installed"
                  : "Not installed"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-white/[0.03] rounded-lg border border-white/5">
            {systemInfo?.credentials_exist ? (
              <CheckCircle2 size={20} className="text-green-500 shrink-0" />
            ) : (
              <XCircle size={20} className="text-yellow-500 shrink-0" />
            )}
            <div>
              <p className="text-sm text-gray-200">OAuth Credentials</p>
              <p className="text-xs text-gray-500">
                {systemInfo?.credentials_exist
                  ? systemInfo.account_email || "Connected"
                  : "Not logged in"}
              </p>
            </div>
          </div>

          {!systemInfo?.claude_installed && (
            <p className="text-xs text-yellow-400 bg-yellow-500/10 p-2 rounded">
              Install Claude Code CLI to use Alice. Run:{" "}
              <code className="bg-black/30 px-1 rounded">npm install -g @anthropic-ai/claude-code</code>
            </p>
          )}
        </div>
      ),
    },
    {
      title: "Features",
      icon: Zap,
      content: (
        <div className="space-y-3">
          {[
            {
              icon: Terminal,
              title: "Session Tracking",
              desc: "Monitor all your Claude Code sessions in real-time",
            },
            {
              icon: Bell,
              title: "Notifications",
              desc: "Get notified when tasks complete or need input",
            },
            {
              icon: Zap,
              title: "Usage Analytics",
              desc: "Track token usage and costs across projects",
            },
          ].map((feature, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 bg-white/[0.03] rounded-lg border border-white/5"
            >
              <feature.icon size={18} className="text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-gray-200">{feature.title}</p>
                <p className="text-xs text-gray-500">{feature.desc}</p>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "Scanning",
      icon: FolderSearch,
      content: (
        <div className="space-y-4 text-center">
          <div className="w-16 h-16 mx-auto bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center">
            {scanning ? (
              <Loader2 size={32} className="text-white animate-spin" />
            ) : scanResult ? (
              <CheckCircle2 size={32} className="text-white" />
            ) : (
              <FolderSearch size={32} className="text-white" />
            )}
          </div>

          {!scanResult && !scanning && (
            <>
              <h2 className="text-lg font-semibold text-gray-100">
                Scan Your Sessions
              </h2>
              <p className="text-sm text-gray-400 max-w-xs mx-auto">
                Let's scan your Claude Code history to set up Alice.
              </p>
              <button
                onClick={startScan}
                className="mt-4 px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
              >
                Start Scan
              </button>
            </>
          )}

          {scanning && (
            <>
              <h2 className="text-lg font-semibold text-gray-100">
                Scanning...
              </h2>
              <p className="text-sm text-gray-400">
                Looking for sessions in ~/.claude/
              </p>
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden mt-4">
                <div
                  className="h-2 bg-green-500 rounded-full transition-all duration-300"
                  style={{ width: `${scanProgress}%` }}
                />
              </div>
            </>
          )}

          {scanResult && !scanning && (
            <>
              <h2 className="text-lg font-semibold text-gray-100">
                Scan Complete!
              </h2>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
                  <p className="text-2xl font-bold text-green-400">
                    {scanResult.session_count}
                  </p>
                  <p className="text-xs text-gray-500">Sessions found</p>
                </div>
                <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
                  <p className="text-2xl font-bold text-blue-400">
                    {scanResult.project_count}
                  </p>
                  <p className="text-xs text-gray-500">Projects</p>
                </div>
              </div>
              {scanResult.total_tokens > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  Total tokens tracked:{" "}
                  {scanResult.total_tokens.toLocaleString()}
                </p>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gray-950/95 backdrop-blur-xl flex items-center justify-center z-50">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentStep = steps[step];
  const isLastStep = step === steps.length - 1;

  return (
    <div className="fixed inset-0 bg-gray-950/95 backdrop-blur-xl flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-sm">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === step
                  ? "bg-blue-500"
                  : i < step
                  ? "bg-blue-500/50"
                  : "bg-gray-700"
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="bg-white/[0.03] border border-white/5 rounded-xl p-6">
          {currentStep.content}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            className={`px-4 py-2 text-sm text-gray-400 hover:text-gray-300 transition-colors ${
              step === 0 ? "invisible" : ""
            }`}
          >
            Back
          </button>

          <button
            onClick={() => {
              if (isLastStep) {
                completeOnboarding();
              } else if (step === 3 && !scanResult) {
                // On scan step but not scanned yet - start scan
                startScan();
              } else {
                setStep(step + 1);
              }
            }}
            disabled={step === 3 && scanning}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isLastStep ? "Get Started" : step === 3 && !scanResult ? "Scan Now" : "Next"}
            <ArrowRight size={14} />
          </button>
        </div>

        {/* Skip */}
        <button
          onClick={completeOnboarding}
          className="w-full mt-4 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Skip setup
        </button>
      </div>
    </div>
  );
}
