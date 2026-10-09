import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDraft,
  createGate,
  editEvent,
  getEventDetail,
  EventApiError,
} from "./events";
import { prepareEvent, type EventCreationAttempt } from "./prepare-event";
import { eventDetailFixture } from "../test/event-fixture";
vi.mock("./events", async (original) => ({
  ...(await original<typeof import("./events")>()),
  createDraft: vi.fn(),
  createGate: vi.fn(),
  editEvent: vi.fn(),
  getEventDetail: vi.fn(),
}));
const settings = {
  time_zone: "Asia/Kolkata",
  start_at: "2030-01-20T03:30:00.000Z",
  end_at: "2030-01-20T11:30:00.000Z",
  registration_capacity: 100,
  visibility: "PUBLIC" as const,
  public_location: null,
};
let attempt: EventCreationAttempt;
beforeEach(() => {
  vi.resetAllMocks();
  attempt = {
    name: "Synthetic demo",
    key: "draft-key",
    gateKey: "gate-key",
    settings,
  };
  vi.mocked(createDraft).mockResolvedValue({
    event_id: "one",
    name: attempt.name,
    state: "DRAFT",
    revision: 1,
    as_of: "now",
    correlation_id: "c",
  });
  vi.mocked(getEventDetail).mockResolvedValue(
    eventDetailFixture({ revision: 1 }),
  );
  vi.mocked(editEvent).mockResolvedValue(
    eventDetailFixture({ ...settings, revision: 2 }),
  );
});
describe("one-form event creation recovery", () => {
  it("confirms a lost settings response from current state without making another draft or rewriting it", async () => {
    vi.mocked(editEvent).mockRejectedValueOnce(new EventApiError("NETWORK", 0));
    await expect(prepareEvent(attempt, "csrf")).rejects.toThrow();
    vi.mocked(getEventDetail).mockResolvedValue(
      eventDetailFixture({ ...settings, revision: 2 }),
    );
    await expect(prepareEvent(attempt, "csrf")).resolves.toBe("one");
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(editEvent).toHaveBeenCalledTimes(1);
    expect(createGate).toHaveBeenCalledWith("one", 2, "csrf", "gate-key");
  });
  it("replays a lost gate response with its original revision and idempotency key", async () => {
    vi.mocked(createGate).mockRejectedValueOnce(
      new EventApiError("NETWORK", 0),
    );
    await expect(prepareEvent(attempt, "csrf")).rejects.toThrow();
    vi.mocked(getEventDetail).mockResolvedValue(
      eventDetailFixture({
        ...settings,
        revision: 3,
        gates: [{ gate_id: "gate", event_id: "one" }],
      }),
    );
    await prepareEvent(attempt, "csrf");
    expect(createGate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createGate).mock.calls[1]).toEqual(
      vi.mocked(createGate).mock.calls[0],
    );
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(editEvent).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite settings changed by another manager", async () => {
    vi.mocked(getEventDetail).mockResolvedValue(
      eventDetailFixture({ revision: 2, name: "Changed elsewhere" }),
    );
    await expect(prepareEvent(attempt, "csrf")).rejects.toMatchObject({
      status: 412,
    });
    expect(editEvent).not.toHaveBeenCalled();
    expect(createGate).not.toHaveBeenCalled();
    expect(attempt.eventId).toBe("one");
  });
  it("retains the original draft command when its outcome is unknown", async () => {
    vi.mocked(createDraft).mockRejectedValueOnce(
      new EventApiError("NETWORK", 0),
    );
    await expect(prepareEvent(attempt, "csrf")).rejects.toThrow();
    await prepareEvent(attempt, "csrf");
    expect(vi.mocked(createDraft).mock.calls[1]).toEqual(
      vi.mocked(createDraft).mock.calls[0],
    );
  });
  it("stops on authorization failure before configuration or gate creation", async () => {
    vi.mocked(createDraft).mockRejectedValue(
      new EventApiError("FORBIDDEN", 403),
    );
    await expect(prepareEvent(attempt, "csrf")).rejects.toMatchObject({
      status: 403,
    });
    expect(editEvent).not.toHaveBeenCalled();
    expect(createGate).not.toHaveBeenCalled();
  });
});
