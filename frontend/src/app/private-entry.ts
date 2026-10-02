export interface PrivateEntry {
  read: () => string | null;
  subscribe?: (listener: () => void) => () => void;
}

// Call once, before rendering. No fragment proof in history, storage or telemetry.
export function capturePrivateEntry(): PrivateEntry {
  let proof: string | null = null;
  const listeners = new Set<() => void>();
  const capture = () => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    proof =
      parameters.size === 1 && parameters.getAll("access").length === 1
        ? parameters.get("access")
        : null;
    if (!proof || !/^[A-Za-z0-9_-]{43}$/.test(proof)) proof = null;
    window.history.replaceState(null, "", window.location.pathname);
    for (const listener of listeners) listener();
  };
  capture();
  window.addEventListener("hashchange", capture);
  window.addEventListener(
    "pagehide",
    () => {
      proof = null;
      window.removeEventListener("hashchange", capture);
      listeners.clear();
    },
    { once: true },
  );
  return {
    read: () => proof,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
