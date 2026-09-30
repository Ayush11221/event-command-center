import { describe, expect, it } from "vitest";
import { parseConfig } from "./env.js";

describe("parseConfig", () => {
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
