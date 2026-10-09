import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
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

  const options = [
    ["light", "Light", Sun],
    ["dark", "Dark", Moon],
    ["system", "System", Monitor],
  ] as const;
  return (
    <div className="theme-control" role="radiogroup" aria-label="Appearance">
      {options.map(([value, label, Icon]) => (
        <label key={value} className="theme-option" title={label}>
          <input
            type="radio"
            name="appearance"
            value={value}
            checked={mode === value}
            onChange={() => change(value)}
          />
          <Icon aria-hidden="true" />
          <span className="visually-hidden">{label}</span>
        </label>
      ))}
    </div>
  );
}
