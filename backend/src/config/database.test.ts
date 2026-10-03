import { afterEach, expect, it, vi } from "vitest";
import { createDatabase } from "./database.js";
afterEach(() => vi.unstubAllEnvs());
it.each(["0", "51", "abc", "1.5"])(
  "rejects unsafe pool size %s without exposing the connection string",
  (max) => {
    vi.stubEnv("DB_POOL_MAX", max);
    expect(() =>
      createDatabase("postgresql://private:password@localhost/demo"),
    ).toThrow("DB_POOL_MAX must be an integer between 1 and 50");
  },
);
