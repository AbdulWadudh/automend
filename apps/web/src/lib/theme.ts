import { config } from "@automend/shared";
import { useCallback, useEffect, useState } from "react";

const { options, defaultOption, storageKey, darkClass } = config.webClient.theme;

export type Theme = (typeof options)[number];

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: string | null): value is Theme {
  return value !== null && (options as readonly string[]).includes(value);
}

export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(storageKey);

    return isTheme(stored) ? stored : defaultOption;
  } catch {
    // Private browsing and blocked storage both throw here. The default is a working app, not a crash.
    return defaultOption;
  }
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") {
    return theme;
  }

  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle(darkClass, resolveTheme(theme) === "dark");
}

/**
 * The chosen theme, applied and remembered.
 *
 * `system` keeps listening rather than resolving once, so a machine that switches at sunset switches the
 * app with it instead of holding whatever it was when the tab opened.
 */
export function useTheme(): { theme: Theme; setTheme: (next: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system") {
      return;
    }

    const media = window.matchMedia(DARK_QUERY);
    const follow = () => applyTheme("system");

    media.addEventListener("change", follow);

    return () => media.removeEventListener("change", follow);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);

    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Unwritable storage means the choice lasts for this tab, which is better than refusing to change.
    }
  }, []);

  return { theme, setTheme };
}
