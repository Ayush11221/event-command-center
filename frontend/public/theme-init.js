// Applies the saved Light/Dark/System choice before React renders, avoiding a
// wrong-theme flash. Served same-origin so strict `script-src 'self'` CSPs
// (Railway Caddy, Vercel) allow it; keep logic in sync with src/app/theme.ts.
(() => {
  let mode = "system";
  try {
    const stored = localStorage.getItem("eoc.theme.v1");
    if (stored === "light" || stored === "dark" || stored === "system")
      mode = stored;
  } catch {
    /* Storage can be unavailable. */
  }
  // Visual look preview: ?look=studio | ?look=classic (remembered locally).
  let look = "studio";
  try {
    const requested = new URLSearchParams(location.search).get("look");
    if (requested === "studio" || requested === "classic")
      localStorage.setItem("eoc.look.v1", requested);
    const storedLook = localStorage.getItem("eoc.look.v1");
    if (storedLook === "studio" || storedLook === "classic") look = storedLook;
  } catch {
    /* Storage can be unavailable. */
  }
  document.documentElement.dataset.look = look;
  const darkPreferred = matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme =
    mode === "system" ? (darkPreferred ? "dark" : "light") : mode;
})();
