import React, { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { ToastContainer, type ToastData, type ToastType } from "../components/Toast";

const TOAST_TYPES: ToastType[] = ["success", "error", "info", "warning"];

type ToastShorthand = (message: string) => void;

interface ToastContextValue {
  showToast: (type: ToastType, message: string, duration?: number) => void;
  success: ToastShorthand;
  error: ToastShorthand;
  info: ToastShorthand;
  warning: ToastShorthand;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const showToast = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = `toast-${++toastId}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(() => {
    const shorthands = Object.fromEntries(
      TOAST_TYPES.map((type) => [type, (message: string) => showToast(type, message)])
    ) as Record<ToastType, ToastShorthand>;

    return { showToast, ...shorthands };
  }, [showToast]);

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
