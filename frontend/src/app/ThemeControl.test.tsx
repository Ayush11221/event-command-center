import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeControl } from "./ThemeControl";

function preference(initial: boolean) {
  let dark = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      get matches() {
        return dark;
      },
      addEventListener(
        _type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) {
        listeners.add(listener);
      },
      removeEventListener(
        _type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) {
        listeners.delete(listener);
      },
    })),
  );
  return {
    change(next: boolean) {
      dark = next;
      for (const listener of listeners)
        listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
});

describe("Light, Dark and System theme", () => {
  it("applies saved mode before the React entry script and respects the OS preference", () => {
    const media = preference(true);
    localStorage.setItem("eoc.theme.v1", "system");
    const html = readFileSync("index.html", "utf8");
    // Same-origin classic script (CSP script-src 'self'), before the React entry.
    const initAt = html.indexOf('<script src="/theme-init.js"></script>');
    expect(initAt).toBeGreaterThan(-1);
    expect(initAt).toBeLessThan(html.indexOf("/src/main.tsx"));
    expect(html).not.toMatch(/<script>[\s\S]*?<\/script>/);
    const bootstrap = readFileSync("public/theme-init.js", "utf8");
    new Function("document", "localStorage", "matchMedia", bootstrap!)(
      document,
      localStorage,
      window.matchMedia,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("system");
    media.change(false);
    render(<ThemeControl />);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("persists explicit modes and follows OS changes only in System", () => {
    const media = preference(false);
    render(<ThemeControl />);
    expect(
      screen.getByRole("radiogroup", { name: "Appearance" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(localStorage.getItem("eoc.theme.v1")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    media.change(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    media.change(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    media.change(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
