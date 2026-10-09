import { describe, expect, it } from "vitest";
import { assertLocalDemo } from "./demo-context";

describe("synthetic demo startup boundary", () => {
  const env = {
    VITE_FORECAST_DEMO: "synthetic_local",
    VITE_API_ORIGIN: "https://127.0.0.1:9443",
  };
  it("requires both the isolated page and API origin", () => {
    expect(() => assertLocalDemo(env, env.VITE_API_ORIGIN)).not.toThrow();
    for (const remote of [
      "https://api.railway.app",
      "https://127.0.0.1:8443",
      "http://127.0.0.1:9443",
    ]) {
      expect(() => assertLocalDemo(env, remote)).toThrow();
      expect(() =>
        assertLocalDemo(
          { ...env, VITE_API_ORIGIN: remote },
          env.VITE_API_ORIGIN,
        ),
      ).toThrow();
    }
    expect(() =>
      assertLocalDemo(
        { ...env, VITE_FORECAST_DEMO: "production" },
        env.VITE_API_ORIGIN,
      ),
    ).toThrow();
  });
  it("leaves ordinary application builds unchanged", () => {
    expect(() =>
      assertLocalDemo(
        { VITE_API_ORIGIN: "https://api.example.com" },
        "https://app.example.com",
      ),
    ).not.toThrow();
    expect(() =>
      assertLocalDemo({ VITE_FORECAST_DEMO: "" }, "https://app.example.com"),
    ).not.toThrow();
  });
});
