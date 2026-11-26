"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_MODE,
  DEFAULT_MODE_PREFERENCE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  STORAGE_KEY,
  isModePreference,
  isThemeId,
  resolveMode,
  type Mode,
  type ModePreference,
  type ThemeId,
} from "@/lib/themes";

/**
 * ThemeProvider - wraps the whole app, owns the two theming axes:
 *   • `theme` - the accent color (`data-theme` on <html>)
 *   • `mode`  - light / dark (`data-mode` on <html>)
 * The two are independent, so any accent renders in either mode.
 *
 * The boot script in `src/app/layout.tsx` has already applied both
 * `data-theme` and `data-mode` before React hydrates, so by the time
 * this Provider mounts the page is already painted correctly. We just
 * read what's there and keep it in sync going forward.
 *
 * Persistence is localStorage only (device-scoped). A future
 * follow-up could mirror to `profiles.preferences` for cross-device
 * sync, but a per-device choice is also defensible - your phone may
 * deserve a different theme than your laptop.
 */

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
  /** The concrete light/dark being shown (what `data-mode` carries). */
  mode: Mode;
  /** What the person picked: system, light or dark. */
  modePreference: ModePreference;
  setModePreference: (next: ModePreference) => void;
  /** Pick an explicit light/dark (leaves "system"). */
  setMode: (next: Mode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  // Whatever the boot script applied is the truth. Fall back to
  // localStorage / default if for some reason the attribute is missing
  // (e.g. someone bypassed the boot script in a custom layout).
  const fromAttr = document.documentElement.dataset.theme;
  if (isThemeId(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return DEFAULT_THEME;
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function readInitialPreference(): ModePreference {
  if (typeof window === "undefined") return DEFAULT_MODE_PREFERENCE;
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (isModePreference(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return DEFAULT_MODE_PREFERENCE;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);
  const [modePreference, setPreferenceState] =
    useState<ModePreference>(readInitialPreference);
  const [mode, setModeState] = useState<Mode>(() =>
    typeof window === "undefined"
      ? DEFAULT_MODE
      : resolveMode(readInitialPreference(), systemPrefersDark()),
  );

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Same private-browsing edge case as above; the in-memory state
      // still updates so the current tab works for the session.
    }
  }, []);

  const applyPreference = useCallback((next: ModePreference) => {
    const resolved = resolveMode(next, systemPrefersDark());
    setPreferenceState(next);
    setModeState(resolved);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.mode = resolved;
    }
  }, []);

  const setModePreference = useCallback(
    (next: ModePreference) => {
      applyPreference(next);
      try {
        localStorage.setItem(MODE_STORAGE_KEY, next);
      } catch {
        // Same private-browsing edge case as above.
      }
    },
    [applyPreference],
  );

  const setMode = useCallback(
    (next: Mode) => setModePreference(next),
    [setModePreference],
  );

  const toggleMode = useCallback(() => {
    setModePreference(mode === "dark" ? "light" : "dark");
  }, [mode, setModePreference]);

  // While following the system, track OS changes live.
  useEffect(() => {
    if (modePreference !== "system" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyPreference("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [modePreference, applyPreference]);

  // Sync from other tabs - change theme or mode in tab A, tab B
  // catches up without a refresh.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        if (isThemeId(e.newValue) && e.newValue !== theme) {
          setThemeState(e.newValue);
          document.documentElement.dataset.theme = e.newValue;
        }
        return;
      }
      if (e.key === MODE_STORAGE_KEY) {
        if (isModePreference(e.newValue) && e.newValue !== modePreference) {
          applyPreference(e.newValue);
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [theme, modePreference, applyPreference]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, mode, modePreference, setModePreference, setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider - return
    // no-op setters so callers don't crash. The boot script still
    // applied the right CSS attributes, so visually the page is fine.
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      mode: DEFAULT_MODE,
      modePreference: DEFAULT_MODE_PREFERENCE,
      setModePreference: () => {},
      setMode: () => {},
      toggleMode: () => {},
    };
  }
  return ctx;
}
