import { afterEach, describe, expect, it, vi } from "vitest";
import {
  playScanFeedback,
  rememberSoundPreference,
  storedSoundPreference,
} from "./scan-feedback";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("scan feedback", () => {
  it("uses a distinct vibration pattern per outcome", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    playScanFeedback("accepted", false);
    playScanFeedback("rejected", false);
    expect(vibrate.mock.calls[0][0]).not.toEqual(vibrate.mock.calls[1][0]);
  });

  it("creates no audio while sound is off and tolerates missing APIs", () => {
    const Audio = vi.fn();
    vi.stubGlobal("AudioContext", Audio);
    vi.stubGlobal("navigator", { ...navigator, vibrate: undefined });
    expect(() => playScanFeedback("duplicate", false)).not.toThrow();
    expect(Audio).not.toHaveBeenCalled();
  });

  it("defaults sound off and remembers the device preference", () => {
    expect(storedSoundPreference()).toBe(false);
    rememberSoundPreference(true);
    expect(storedSoundPreference()).toBe(true);
  });
});
