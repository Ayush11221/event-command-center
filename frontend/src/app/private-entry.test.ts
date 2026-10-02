import { afterEach, describe, expect, it, vi } from "vitest";
import { capturePrivateEntry } from "./private-entry";
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
describe("V8 fragment entry", () => {
  it("captures and strips a new link on the same document without exposing it in change notifications", () => {
    window.history.replaceState(null, "", `/private#access=${"a".repeat(43)}`);
    const entry = capturePrivateEntry(),
      listener = vi.fn(),
      unsubscribe = entry.subscribe!(listener);
    window.history.replaceState(null, "", `/private#access=${"b".repeat(43)}`);
    window.dispatchEvent(new Event("hashchange"));
    expect(window.location.hash).toBe("");
    expect(entry.read()).toBe("b".repeat(43));
    expect(listener).toHaveBeenCalledWith();
    unsubscribe();
    window.history.replaceState(null, "", "/private#access=invalid");
    window.dispatchEvent(new Event("hashchange"));
    expect(entry.read()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("");
  });
  it("captures once, strips URL/history synchronously, never stores proof, and discards on pagehide", () => {
    const proof = "a".repeat(43),
      local = vi.spyOn(Storage.prototype, "setItem");
    window.history.replaceState(
      { secret: proof },
      "",
      `/private#access=${proof}`,
    );
    const entry = capturePrivateEntry();
    expect(window.location.href).not.toContain(proof);
    expect(window.location.hash).toBe("");
    expect(window.history.state).toBeNull();
    expect(entry.read()).toBe(proof);
    expect(entry.read()).toBe(proof);
    expect(local).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    expect(entry.read()).toBeNull();
  });
  it.each([
    "",
    "#access=short",
    `#access=${"a".repeat(43)}&access=${"b".repeat(43)}`,
    `#access=${"a".repeat(43)}&other=secret`,
    "#event_id=guess",
  ])("strips and rejects unsupported fragment %s", (hash) => {
    window.history.replaceState(null, "", `/private${hash}`);
    expect(capturePrivateEntry().read()).toBeNull();
    expect(window.location.hash).toBe("");
  });
});
