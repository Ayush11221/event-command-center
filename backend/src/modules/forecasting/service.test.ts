import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { ApiError } from "../auth/errors.js";
import { lockManagementEvent } from "../events/management-command.js";
import { readOperations } from "../occupancy/service.js";
import { extractForecast } from "./source.js";
import { currentForecast, forecastHistory } from "./service.js";
import { callForecast } from "./client.js";
import { fallback, type ForecastRequest } from "./contract.js";
vi.mock("../events/management-command.js", () => ({
  lockManagementEvent: vi.fn(),
}));
vi.mock("../occupancy/service.js", () => ({ readOperations: vi.fn() }));
vi.mock("./client.js", () => ({ callForecast: vi.fn() }));
const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actor: AuthContext = { userId: randomUUID(), sessionId: randomUUID() };
const asOf = "2026-10-03T12:00:12.000Z";
const snapshot = {
  event_id: eventId,
  event_name: "internal",
  event_state: "LIVE" as const,
  occupied: 2,
  registered: 3,
  capacity: 1,
  remaining: -1,
  utilization_percentage: 200,
  attendance_state: "INSIDE" as const,
  last_attendance_at: asOf,
  calculated_at: asOf,
  revision: 2,
  as_of: asOf,
  correlation_id: "read",
};
function database(rows: unknown[]) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(rows),
    forecastRun: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  };
  const deps = {
    db: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) },
    config: {},
  } as unknown as AuthDependencies;
  vi.mocked(lockManagementEvent).mockResolvedValue({
    event: { timeZone: null, startAt: null, endAt: null } as never,
    owner: true,
  });
  vi.mocked(readOperations).mockResolvedValue(snapshot);
  return { tx, deps };
}
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
describe("Slice 8 generation, extraction and retention boundaries", () => {
  it("reconstructs exact minute counts without pre-first-transition padding", async () => {
    const { deps } = database([
      {
        first_at: new Date("2026-10-03T11:58:25.000Z"),
        prior: 0n,
        at: new Date("2026-10-03T11:59:00.000Z"),
        arrivals: 1n,
      },
      {
        first_at: new Date("2026-10-03T11:58:25.000Z"),
        prior: 0n,
        at: new Date("2026-10-03T12:01:00.000Z"),
        arrivals: 1n,
      },
    ]);
    const input = await extractForecast(deps, actor, eventId, "read");
    expect(input.observations).toEqual([
      { at: "2026-10-03T11:59:00.000Z", value: 1, quality: "COMMITTED" },
      { at: "2026-10-03T12:00:00.000Z", value: 1, quality: "COMMITTED" },
      { at: asOf, value: 2, quality: "COMMITTED" },
    ]);
    expect(Object.keys(input)).not.toContain("registered");
    expect(input.capacity).toBe(1);
    expect(input.revision).toBe(2);
  });
  it("bounds quiet reconstructed history to six hours plus the fresh endpoint", async () => {
    const { deps } = database([
      {
        first_at: new Date("2026-10-02T00:00:00.000Z"),
        prior: 2n,
        at: null,
        arrivals: null,
      },
    ]);
    const input = await extractForecast(deps, actor, eventId, "read");
    expect(input.observations).toHaveLength(361);
    expect(input.observations[0].at).toBe("2026-10-03T06:01:00.000Z");
    expect(input.observations.every((value) => value.value === 2)).toBe(true);
    expect(input.observations.at(-1)?.at).toBe(asOf);
  });
  it("never calls the service when extraction authorization fails", async () => {
    const { deps, tx } = database([]);
    vi.mocked(lockManagementEvent).mockRejectedValue(
      new ApiError(404, "EVENT_NOT_FOUND", "Event not found"),
    );
    await expect(
      currentForecast(deps, actor, eventId, "read"),
    ).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
    expect(callForecast).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it.each([401, 404])(
    "revalidates authority after service work and never stores a revoked result (%s)",
    async (status) => {
      const { deps, tx } = database([
        {
          first_at: new Date(asOf),
          prior: 0n,
          at: new Date("2026-10-03T12:01:00.000Z"),
          arrivals: 2n,
        },
      ]);
      vi.mocked(callForecast).mockImplementation(async (_config, request) =>
        fallback(request, "MODEL_UNAVAILABLE"),
      );
      vi.mocked(lockManagementEvent)
        .mockResolvedValueOnce({
          event: { timeZone: null, startAt: null, endAt: null } as never,
          owner: true,
        })
        .mockRejectedValueOnce(
          new ApiError(
            status,
            status === 401 ? "UNAUTHENTICATED" : "EVENT_NOT_FOUND",
            "Unavailable",
          ),
        );
      await expect(
        currentForecast(deps, actor, eventId, "read"),
      ).rejects.toMatchObject({ status });
      expect(callForecast).toHaveBeenCalledTimes(1);
      expect(tx.forecastRun.create).not.toHaveBeenCalled();
    },
  );
  it("stores every service failure as a new immutable attempt and rereads observed state after insertion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(asOf));
    const { deps, tx } = database([
      { first_at: null, prior: 0n, at: null, arrivals: null },
    ]);
    vi.mocked(readOperations).mockResolvedValue({
      ...snapshot,
      occupied: 0,
      revision: 0,
    });
    vi.mocked(callForecast).mockImplementation(async (_config, request) =>
      fallback(request, "MODEL_UNAVAILABLE"),
    );
    tx.forecastRun.create.mockImplementation(async ({ data }) => ({
      id: randomUUID(),
      eventId,
      persistedAt: new Date(asOf),
      result: data.result,
    }));
    const first = await currentForecast(deps, actor, eventId, "read"),
      second = await currentForecast(deps, actor, eventId, "read");
    expect(first.forecast.run_id).not.toBe(second.forecast.run_id);
    expect(first.forecast.status).toBe("MODEL_UNAVAILABLE");
    expect(first.forecast.points).toEqual([]);
    expect(tx.forecastRun.findMany).not.toHaveBeenCalled();
    expect(tx.forecastRun.create.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(readOperations).mock.invocationCallOrder[1],
    );
  });
  it("history never generates and reads observations after selecting retained rows", async () => {
    const { deps, tx } = database([]);
    const response = await forecastHistory(deps, actor, eventId, {}, "read");
    expect(response.items).toEqual([]);
    expect(response.next_cursor).toBeNull();
    expect(callForecast).not.toHaveBeenCalled();
    expect(tx.forecastRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 21,
        orderBy: [{ persistedAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(tx.forecastRun.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(readOperations).mock.invocationCallOrder[0],
    );
  });
  it("uses an exclusive persistence-time/UUID keyset and recomputes stale wrappers", async () => {
    const { deps, tx } = database([]);
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "../../../../tests/fixtures/slice8-forecast.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const {
      run_id,
      persisted_at,
      freshness: _freshness,
      ...result
    } = fixture.forecast;
    void _freshness;
    const rows = [
      { id: run_id, eventId, persistedAt: new Date(persisted_at), result },
      {
        id: randomUUID(),
        eventId,
        persistedAt: new Date(persisted_at),
        result,
      },
    ];
    tx.forecastRun.findMany.mockResolvedValue(rows);
    const response = await forecastHistory(
      deps,
      actor,
      eventId,
      { limit: "1" },
      "read",
    );
    expect(response.items[0].freshness.reason).toBe("OBSERVATIONS_CHANGED");
    expect(response.next_cursor).not.toBeNull();
    await forecastHistory(
      deps,
      actor,
      eventId,
      { limit: "1", cursor: response.next_cursor },
      "read",
    );
    expect(tx.forecastRun.findMany.mock.calls[1][0].where.OR).toEqual([
      { persistedAt: { lt: new Date(persisted_at) } },
      { persistedAt: new Date(persisted_at), id: { lt: run_id } },
    ]);
  });
  it("rejects a stored timestamp beyond the response snapshot", async () => {
    const { deps, tx } = database([]);
    const request: ForecastRequest = {
      contract_version: 1,
      event_id: eventId,
      as_of: asOf,
      time_zone: null,
      schedule: { start_at: null, end_at: null },
      occupied: 0,
      capacity: null,
      revision: 0,
      observations: [],
      horizons: [30, 60],
      method: { name: "persistence", version: "1" },
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date(asOf));
    tx.forecastRun.findMany.mockResolvedValue([
      {
        id: randomUUID(),
        eventId,
        persistedAt: new Date(Date.parse(asOf) + 1),
        result: fallback(request, "MODEL_UNAVAILABLE"),
      },
    ]);
    await expect(
      forecastHistory(deps, actor, eventId, {}, "read"),
    ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  });
});
