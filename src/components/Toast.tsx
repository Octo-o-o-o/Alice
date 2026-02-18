import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastData {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const EXIT_ANIMATION_MS = 200;
const DEFAULT_DURATION_MS = 3000;

const toastStyles: Record<ToastType, { icon: LucideIcon; iconColor: string; container: string }> = {
  success: {
    icon: CheckCircle2,
    iconColor: "text-green-400",
    container: "bg-green-500/20 border-green-500/30 text-green-300",
  },
  error: {
    icon: XCircle,
    iconColor: "text-red-400",
    container: "bg-red-500/20 border-red-500/30 text-red-300",
  },
  info: {
    icon: Info,
    iconColor: "text-blue-400",
    container: "bg-blue-500/20 border-blue-500/30 text-blue-300",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: "text-yellow-400",
    container: "bg-yellow-500/20 border-yellow-500/30 text-yellow-300",
  },
};

export function Toast({ toast, onDismiss }: ToastProps): React.ReactElement {
  const [isExiting, setIsExiting] = useState(false);
  const { icon: Icon, iconColor, container } = toastStyles[toast.type];
  const duration = toast.duration ?? DEFAULT_DURATION_MS;

  useEffect(() => {
    if (duration <= 0) return;

    const exitTimer = setTimeout(() => setIsExiting(true), duration - EXIT_ANIMATION_MS);
    const dismissTimer = setTimeout(() => onDismiss(toast.id), duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(dismissTimer);
    };
  }, [toast.id, duration, onDismiss]);

  function handleDismiss(): void {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), EXIT_ANIMATION_MS);
  }

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border backdrop-blur-sm shadow-lg transition-all duration-200 ${container} ${
        isExiting ? "opacity-0 translate-x-2" : "opacity-100 translate-x-0"
      }`}
    >
      <Icon size={16} className={iconColor} />
      <span className="text-sm flex-1">{toast.message}</span>
      <button
        onClick={handleDismiss}
        className="p-0.5 hover:bg-white/10 rounded transition-colors"
      >
        <X size={14} className="opacity-60" />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps): React.ReactElement {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-xs">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
