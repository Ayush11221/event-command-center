import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEventDetail } from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { useEventInformation } from "./useEventInformation";
const session = vi.hoisted(() => ({
  listener: null as null | ((event: "expired" | "signed-out") => void),
}));
vi.mock("../services/events", async (original) => ({
  ...(await original<typeof import("../services/events")>()),
  getEventDetail: vi.fn(),
}));
vi.mock("../services/account-session", async (original) => ({
  ...(await original<typeof import("../services/account-session")>()),
  subscribeAccountSession: (listener: typeof session.listener) => {
    session.listener = listener;
    return () => {
      session.listener = null;
    };
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("scoped event metadata", () => {
  it.each(["expired", "signed-out"] as const)(
    "clears private event metadata on %s",
    async (event) => {
      vi.mocked(getEventDetail).mockResolvedValue(
        eventDetailFixture({ visibility: "PRIVATE", name: "Private event" }),
      );
      const { result } = renderHook(() => useEventInformation("one"));
      await vi.waitFor(() =>
        expect(result.current.detail?.name).toBe("Private event"),
      );
      act(() => session.listener?.(event));
      expect(result.current.detail).toBeNull();
      expect(result.current.error).toMatch(/current access/);
    },
  );
  it("ignores a pending response after explicit scope loss", async () => {
    let finish!: (detail: ReturnType<typeof eventDetailFixture>) => void;
    vi.mocked(getEventDetail).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(() => useEventInformation("one"));
    act(() => result.current.clear());
    await act(async () =>
      finish(eventDetailFixture({ name: "Revoked event" })),
    );
    expect(result.current.detail).toBeNull();
  });
});
