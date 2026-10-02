import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const css = readFileSync("src/styles.css", "utf8");
function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((c) => parseInt(c, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe("Slice 3 semantic theme contrast (DESIGN_SYSTEM WCAG AA targets)", () => {
  it.each(["light", "dark"])(
    "keeps text, control boundaries and focus legible in %s",
    (theme) => {
      const block =
        theme === "light"
          ? css.match(/:root\s*\{([^}]+)\}/)![1]
          : css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)![1];
      const tokens = Object.fromEntries(
        [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [
          m[1],
          m[2],
        ]),
      );
      for (const surface of [
        "canvas",
        "surface",
        "surface-raised",
        "surface-inset",
      ]) {
        for (const text of ["text", "text-muted"])
          expect(
            contrast(tokens[text], tokens[surface]),
            `${theme} ${text} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        for (const boundary of ["border", "focus"])
          expect(
            contrast(tokens[boundary], tokens[surface]),
            `${theme} ${boundary} on ${surface}`,
          ).toBeGreaterThanOrEqual(3);
      }
      for (const action of ["action", "action-hover"])
        expect(
          contrast(tokens["action-text"], tokens[action]),
          `${theme} action text on ${action}`,
        ).toBeGreaterThanOrEqual(4.5);
      for (const status of ["success", "info", "critical", "text-muted"])
        expect(
          contrast(tokens[status], tokens["pill-surface"]),
          `${theme} ${status} pill`,
        ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokens.critical, tokens["critical-surface"]),
        `${theme} critical message`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
