export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "eoc.theme.v1";

export function storedTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system")
      return value;
  } catch {
    // Storage may be blocked; the in-memory selection still works.
  }
  return "system";
}

export function effectiveTheme(mode: ThemeMode, darkPreferred: boolean) {
  return mode === "system" ? (darkPreferred ? "dark" : "light") : mode;
}

export function applyTheme(mode: ThemeMode, darkPreferred: boolean): void {
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = effectiveTheme(mode, darkPreferred);
}

export function rememberTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // A storage failure does not block a presentation choice.
  }
}
