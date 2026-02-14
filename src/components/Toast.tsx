import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from "lucide-react";

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

const iconMap = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const colorMap = {
  success: "bg-green-500/20 border-green-500/30 text-green-300",
  error: "bg-red-500/20 border-red-500/30 text-red-300",
  info: "bg-blue-500/20 border-blue-500/30 text-blue-300",
  warning: "bg-yellow-500/20 border-yellow-500/30 text-yellow-300",
};

const iconColorMap = {
  success: "text-green-400",
  error: "text-red-400",
  info: "text-blue-400",
  warning: "text-yellow-400",
};

export function Toast({ toast, onDismiss }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);
  const Icon = iconMap[toast.type];
  const duration = toast.duration ?? 3000;

  useEffect(() => {
    if (duration > 0) {
      const exitTimer = setTimeout(() => {
        setIsExiting(true);
      }, duration - 200);

      const dismissTimer = setTimeout(() => {
        onDismiss(toast.id);
      }, duration);

      return () => {
        clearTimeout(exitTimer);
        clearTimeout(dismissTimer);
      };
    }
  }, [toast.id, duration, onDismiss]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border backdrop-blur-sm shadow-lg transition-all duration-200 ${
        colorMap[toast.type]
      } ${isExiting ? "opacity-0 translate-x-2" : "opacity-100 translate-x-0"}`}
    >
      <Icon size={16} className={iconColorMap[toast.type]} />
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

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-xs">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
