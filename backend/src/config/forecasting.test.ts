import { describe, expect, it } from "vitest";
import { parseFoundationConfig } from "./foundation.js";
const env = {
  DATABASE_URL: "postgresql://localhost/test",
  JWT_SECRET: "a".repeat(64),
  CONTACT_KEY: "b".repeat(64),
  OTP_KEY: "c".repeat(64),
};
describe("Forecast service configuration", () => {
  it("keeps the service optional", () =>
    expect(parseFoundationConfig(env).forecastServiceUrl).toBeUndefined());
  it.each([
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://[::1]:8000",
    "https://internal.example",
  ])("allows a protected endpoint %s", (url) =>
    expect(
      parseFoundationConfig({
        ...env,
        FORECAST_SERVICE_URL: url,
        FORECAST_SERVICE_KEY: "d".repeat(64),
      }).forecastServiceUrl,
    ).toBe(url),
  );
  it.each([
    "http://internal.example",
    "ftp://127.0.0.1",
    "https://user:secret@internal.example",
    "https://internal.example/path",
    "https://internal.example?secret=x",
    "https://internal.example#secret",
  ])("rejects unsafe endpoint %s without disclosing values", (url) => {
    expect(() =>
      parseFoundationConfig({
        ...env,
        FORECAST_SERVICE_URL: url,
        FORECAST_SERVICE_KEY: "d".repeat(64),
      }),
    ).toThrow();
  });
  it.each([
    env.JWT_SECRET,
    env.CONTACT_KEY,
    env.OTP_KEY,
    env.JWT_SECRET.toUpperCase(),
    "invalid",
  ])("rejects reused or invalid keys %#", (key) =>
    expect(() =>
      parseFoundationConfig({
        ...env,
        FORECAST_SERVICE_URL: "http://127.0.0.1:8000",
        FORECAST_SERVICE_KEY: key,
      }),
    ).toThrow(),
  );
  it("requires both URL and service key", () => {
    expect(() =>
      parseFoundationConfig({
        ...env,
        FORECAST_SERVICE_URL: "http://127.0.0.1:8000",
      }),
    ).toThrow();
    expect(() =>
      parseFoundationConfig({ ...env, FORECAST_SERVICE_KEY: "d".repeat(64) }),
    ).toThrow();
  });
});
