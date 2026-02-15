import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";
import { ToastContainer, ToastData, ToastType } from "../components/Toast";

interface ToastContextValue {
  showToast: (type: ToastType, message: string, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const showToast = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = `toast-${++toastId}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    showToast,
    success: (message: string) => showToast("success", message),
    error: (message: string) => showToast("error", message),
    info: (message: string) => showToast("info", message),
    warning: (message: string) => showToast("warning", message),
  }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
