import { describe, expect, it } from "vitest";
import { parseConfig } from "./env.js";

describe("parseConfig", () => {
  it("requires exact HTTPS origin in production and preserves development isolation", () => {
    expect(
      parseConfig({
        NODE_ENV: "production",
        PORT: "3000",
        FRONTEND_ORIGIN: "https://demo.example.invalid",
        BIND_HOST: "0.0.0.0",
      }),
    ).toEqual({
      port: 3000,
      frontendOrigin: "https://demo.example.invalid",
      bindHost: "0.0.0.0",
    });
    for (const origin of [
      "http://localhost:5173",
      "http://demo.example.invalid",
      "https://user:secret@demo.example.invalid",
      "https://demo.example.invalid/path",
      "https://demo.example.invalid/",
    ]) {
      expect(() =>
        parseConfig({
          NODE_ENV: "production",
          PORT: "3000",
          FRONTEND_ORIGIN: origin,
        }),
      ).toThrow();
    }
    expect(() =>
      parseConfig({
        PORT: "3000",
        FRONTEND_ORIGIN: "https://demo.example.invalid",
      }),
    ).toThrow();
  });
  it("accepts the local origin and a valid port", () => {
    expect(
      parseConfig({ PORT: "3000", FRONTEND_ORIGIN: "http://127.0.0.1:5173" }),
    ).toEqual({ port: 3000, frontendOrigin: "http://127.0.0.1:5173" });
  });

  it.each(["", "0", "65536", "3.5", "abc"])(
    "rejects invalid PORT %s",
    (port) => {
      expect(() =>
        parseConfig({ PORT: port, FRONTEND_ORIGIN: "http://127.0.0.1:5173" }),
      ).toThrow("PORT must be an integer between 1 and 65535");
    },
  );

  it("rejects a missing or non-local frontend origin without printing its value", () => {
    const secret = "https://user:secret@example.com/path";
    expect(() => parseConfig({ PORT: "3000" })).toThrow("FRONTEND_ORIGIN");
    try {
      parseConfig({ PORT: "3000", FRONTEND_ORIGIN: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("secret");
    }
  });
});
