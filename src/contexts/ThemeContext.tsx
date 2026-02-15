import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Theme } from "../lib/types";

type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [systemIsDark, setSystemIsDark] = useState(darkModeQuery.matches);

  const resolvedTheme: ResolvedTheme = theme === "system"
    ? (systemIsDark ? "dark" : "light")
    : theme;

  // Load theme from config on mount
  useEffect(() => {
    invoke<{ theme: Theme }>("get_config", {})
      .then((config) => setThemeState(config.theme || "system"))
      .catch((error) => console.error("Failed to load theme config:", error));
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    const handleChange = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    darkModeQuery.addEventListener("change", handleChange);
    return () => darkModeQuery.removeEventListener("change", handleChange);
  }, []);

  // Apply theme class to document root
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback(async (newTheme: Theme) => {
    await invoke("update_config", { key: "theme", value: newTheme });
    setThemeState(newTheme);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
