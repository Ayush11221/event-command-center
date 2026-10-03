import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOperations, type OperationsSnapshot } from "../services/occupancy";
import { OccupancyPage } from "./OccupancyPage";

const sockets = vi.hoisted(
  () =>
    [] as Array<{
      connected: boolean;
      handlers: Record<string, (...args: unknown[]) => void>;
      on: ReturnType<
        typeof vi.fn<
          (name: string, handler: (...args: unknown[]) => void) => void
        >
      >;
      emit: ReturnType<
        typeof vi.fn<
          (
            name: string,
            input: { event_id: string },
            ack?: (error: null, body: object) => void,
          ) => void
        >
      >;
      timeout: ReturnType<typeof vi.fn<() => void>>;
      connect: ReturnType<typeof vi.fn<() => void>>;
      disconnect: ReturnType<typeof vi.fn<() => void>>;
      removeAllListeners: ReturnType<typeof vi.fn<() => void>>;
    }>,
);
vi.mock("../services/occupancy", () => ({ getOperations: vi.fn() }));
vi.mock("../services/operations-realtime", async (original) => {
  const actual =
    await original<typeof import("../services/operations-realtime")>();
  return {
    ...actual,
    connectOperations: () => {
      const handlers: Record<string, (...args: unknown[]) => void> = {};
      const socket = {
        connected: false,
        handlers,
        on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
          handlers[name] = handler;
        }),
        emit: vi.fn(
          (
            name: string,
            input: { event_id: string },
            ack?: (error: null, body: object) => void,
          ) => {
            if (name === "operations.subscribe")
              ack?.(null, {
                ok: true,
                event_id: input.event_id,
                revision: 2,
                as_of: "2026-10-03T00:01:00Z",
              });
          },
        ),
        timeout: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      socket.timeout.mockReturnValue(socket);
      socket.connect.mockImplementation(() => {
        socket.connected = true;
        handlers.connect?.();
      });
      socket.disconnect.mockImplementation(() => {
        socket.connected = false;
        handlers.disconnect?.("io client disconnect");
      });
      sockets.push(socket);
      return socket;
    },
  };
});
const snapshot: OperationsSnapshot = {
  event_id: "event",
  event_name: "Realtime event",
  event_state: "LIVE",
  occupied: 2,
  registered: 10,
  capacity: 10,
  remaining: 8,
  utilization_percentage: 20,
  attendance_state: "INSIDE",
  last_attendance_at: "2026-10-03T00:00:00Z",
  calculated_at: "2026-10-03T00:01:00Z",
  as_of: "2026-10-03T00:01:00Z",
  correlation_id: "read",
  revision: 2,
};
const update = (revision: number, event_id = "event") => ({
  schema_version: 1,
  event_id,
  revision,
  message_id: `operations:${event_id}:${revision}`,
  as_of: snapshot.as_of,
  occurred_at: snapshot.last_attendance_at,
  correlation_id: "notify",
});
async function open() {
  const view = render(<OccupancyPage eventId="event" />);
  await screen.findByText("Live — confirmed by operations snapshot");
  vi.mocked(getOperations).mockClear();
  return view;
}
beforeEach(() => {
  sockets.length = 0;
  vi.mocked(getOperations).mockResolvedValue(snapshot);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("versioned operations reconciliation", () => {
  it("stores initial REST revision and confirms after subscription", async () => {
    await open();
    expect(screen.getByText(/Revision: 2/)).toBeVisible();
    expect(sockets[0].emit).toHaveBeenCalledWith(
      "operations.subscribe",
      { event_id: "event" },
      expect.any(Function),
    );
  });
  it("reconciles sequential revisions rather than trusting socket occupancy", async () => {
    await open();
    vi.mocked(getOperations).mockResolvedValue({
      ...snapshot,
      occupied: 3,
      revision: 3,
    });
    act(() =>
      sockets[0].handlers["occupancy.updated"]({ ...update(3), occupied: 999 }),
    );
    await screen.findByText(/Revision: 3/);
    expect(getOperations).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("999")).not.toBeInTheDocument();
  });
  it("marks a gap stale until authoritative REST restores its revision", async () => {
    await open();
    let resolve!: (snapshot: OperationsSnapshot) => void;
    vi.mocked(getOperations).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() => sockets[0].handlers["occupancy.updated"](update(5)));
    expect(screen.getByText(/revision gap detected/)).toBeVisible();
    expect(screen.queryByText(/^Live —/)).not.toBeInTheDocument();
    await act(async () => resolve({ ...snapshot, revision: 5, occupied: 5 }));
    await screen.findByText(/Revision: 5/);
  });
  it("ignores duplicate, stale, out-of-order and wrong-event messages", async () => {
    await open();
    act(() => {
      for (const revision of [2, 1, 2])
        sockets[0].handlers["occupancy.updated"](update(revision));
      sockets[0].handlers["occupancy.updated"](update(5, "other"));
    });
    expect(getOperations).not.toHaveBeenCalled();
    expect(screen.getByText(/Revision: 2/)).toBeVisible();
  });
  it("never regresses after a late REST response and retries the required revision", async () => {
    await open();
    vi.mocked(getOperations)
      .mockResolvedValueOnce({ ...snapshot, revision: 1 })
      .mockResolvedValue({ ...snapshot, revision: 5 });
    act(() => sockets[0].handlers["occupancy.updated"](update(5)));
    await screen.findByText(/awaiting authoritative revision/);
    expect(screen.getByText(/Revision: 2/)).toBeVisible();
    await waitFor(() => expect(screen.getByText(/Revision: 5/)).toBeVisible(), {
      timeout: 2500,
    });
  });
  it("shows disconnect and reconciles after reconnect", async () => {
    await open();
    act(() => {
      sockets[0].connected = false;
      sockets[0].handlers.disconnect("transport close");
    });
    expect(screen.getByText(/Disconnected — last confirmed/)).toBeVisible();
    vi.mocked(getOperations).mockResolvedValue({ ...snapshot, revision: 4 });
    act(() => sockets[0].connect());
    await screen.findByText(/Revision: 4/);
    expect(getOperations).toHaveBeenCalledTimes(1);
  });
  it("removes old subscription and aborts old-event reads on context change", async () => {
    const view = await open();
    vi.mocked(getOperations).mockResolvedValue({
      ...snapshot,
      event_id: "other",
      event_name: "Other event",
    });
    view.rerender(<OccupancyPage eventId="other" />);
    await screen.findByText("Other event");
    expect(sockets[0].emit).toHaveBeenCalledWith("operations.unsubscribe");
    expect(sockets[0].removeAllListeners).toHaveBeenCalled();
    expect(sockets[0].disconnect).toHaveBeenCalled();
    act(() => sockets[0].handlers["occupancy.updated"](update(8)));
    expect(screen.queryByText("Realtime event")).not.toBeInTheDocument();
    expect(screen.queryByText(/Revision: 8/)).not.toBeInTheDocument();
  });
  it("reconciles unsupported schemas and clears protected state on access loss", async () => {
    await open();
    const { EventApiError } = await import("../services/events");
    vi.mocked(getOperations).mockRejectedValue(
      new EventApiError("EVENT_NOT_FOUND", 404),
    );
    act(() =>
      sockets[0].handlers["occupancy.updated"]({
        ...update(3),
        schema_version: 2,
      }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("Realtime event")).not.toBeInTheDocument();
    expect(sockets[0].connected).toBe(false);
  });
  it("ignores an acknowledgement from a superseded connection", async () => {
    await open();
    const acknowledgements: Array<(error: null, body: object) => void> = [];
    sockets[0].emit.mockImplementation((name, _input, ack) => {
      if (name === "operations.subscribe" && ack) acknowledgements.push(ack);
    });
    act(() => {
      sockets[0].handlers.disconnect("transport close");
      sockets[0].connect();
      sockets[0].handlers.disconnect("transport close");
      sockets[0].connect();
      acknowledgements[0](null, {
        ok: true,
        event_id: "event",
        revision: 99,
        as_of: snapshot.as_of,
      });
    });
    expect(getOperations).not.toHaveBeenCalled();
    act(() =>
      acknowledgements[1](null, {
        ok: true,
        event_id: "event",
        revision: 2,
        as_of: snapshot.as_of,
      }),
    );
    await screen.findByText("Live — confirmed by operations snapshot");
    expect(getOperations).toHaveBeenCalledTimes(1);
  });
  it("reconciles foreground return instead of silently preserving stale live state", async () => {
    await open();
    let resolve!: (s: OperationsSnapshot) => void;
    vi.mocked(getOperations).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByText(/checking freshness/)).toBeVisible();
    await act(async () => resolve({ ...snapshot, revision: 4 }));
    await screen.findByText(/Revision: 4/);
    expect(getOperations).toHaveBeenCalledTimes(1);
  });
});
