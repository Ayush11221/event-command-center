import { describe, expect, it } from "vitest";
import { occupancyValues } from "./service.js";
describe("occupancy arithmetic", () => {
  it.each([
    [0, 2, 1, 1, 0],
    [1, 2, 1, 0, 100],
    [2, 2, 1, -1, 200],
    [1, 4, 3, 2, 33.33],
  ])(
    "calculates occupied %s and registered %s against capacity %s",
    (occupied, registered, capacity, remaining, utilization_percentage) => {
      expect(occupancyValues(occupied, registered, capacity)).toEqual({
        occupied,
        registered,
        capacity,
        remaining,
        utilization_percentage,
      });
    },
  );
  it("does not invent capacity for a legacy draft", () => {
    expect(occupancyValues(0, 0, null)).toEqual({
      occupied: 0,
      registered: 0,
      capacity: null,
      remaining: null,
      utilization_percentage: null,
    });
  });
  it.each([
    [-1, 0, 2],
    [2, 1, 2],
    [0, -1, 2],
    [0, 0, 0],
    [1.2, 2, 2],
    [0, Number.MAX_SAFE_INTEGER + 1, 2],
  ])(
    "fails closed on impossible source values %#",
    (occupied, registered, capacity) => {
      expect(() => occupancyValues(occupied, registered, capacity)).toThrow();
    },
  );
});
