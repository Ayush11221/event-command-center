import { useEffect, useState } from "react";
import {
  applyTheme,
  rememberTheme,
  storedTheme,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "./theme";

export function ThemeControl() {
  const [mode, setMode] = useState<ThemeMode>(storedTheme);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme(mode, preference.matches);
    update();
    if (mode === "system") preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, [mode]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) setMode(storedTheme());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function change(value: ThemeMode) {
    const darkPreferred = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    applyTheme(value, darkPreferred);
    rememberTheme(value);
    setMode(value);
  }

  return (
    <label className="theme-control">
      <span>Appearance</span>
      <select
        aria-label="Appearance"
        value={mode}
        onChange={(event) => change(event.target.value as ThemeMode)}
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  );
}
