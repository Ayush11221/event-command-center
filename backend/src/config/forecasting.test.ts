import { describe, expect, it } from "vitest";
import { parseFoundationConfig } from "./foundation.js";
const env = {
  DATABASE_URL: "postgresql://localhost/test",
  JWT_SECRET: "a".repeat(64),
  CONTACT_KEY: "b".repeat(64),
  OTP_KEY: "c".repeat(64),
};
const privateEnv = {
  ...env,
  FORECAST_SERVICE_TRANSPORT: "railway_private_http",
  FORECAST_SERVICE_URL: "http://forecast.railway.internal:8000",
  FORECAST_SERVICE_KEY: "d".repeat(64),
  RAILWAY_PROJECT_ID: "synthetic-project",
  RAILWAY_ENVIRONMENT_ID: "synthetic-environment",
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
    "http://forecast.railway.internal:8000",
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
  it.each([
    privateEnv.FORECAST_SERVICE_URL,
    privateEnv.FORECAST_SERVICE_URL + "/",
  ])("accepts only the explicit Railway private root endpoint %s", (url) => {
    const parsed = parseFoundationConfig({
      ...privateEnv,
      FORECAST_SERVICE_URL: url,
    });
    expect(parsed.forecastServiceUrl).toBe(url);
    expect(parsed.forecastServiceTransport).toBe("railway_private_http");
  });
  it.each([
    "",
    "https",
    "http",
    "railway_private_https",
    "RAILWAY_PRIVATE_HTTP",
    " railway_private_http",
    "railway_private_http ",
    "secret-unknown",
  ])(
    "fails closed for an unknown transport %# even without service configuration",
    (transport) => {
      for (const base of [env, privateEnv]) {
        expect(() =>
          parseFoundationConfig({
            ...base,
            FORECAST_SERVICE_TRANSPORT: transport,
          }),
        ).toThrow("Invalid forecast service transport");
      }
    },
  );
  it.each([
    "http://forecast.railway.internal",
    "http://forecast.railway.internal:80",
    "http://forecast.railway.internal:8001",
    "https://forecast.railway.internal:8000",
    "http://other.railway.internal:8000",
    "http://forecast.railway.internal.attacker.invalid:8000",
    "http://forecast.railway.internal.:8000",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://[::1]:8000",
    "http://10.0.0.1:8000",
    "http://forecast.up.railway.app:8000",
    "http://secret@forecast.railway.internal:8000",
    "http://user:secret@forecast.railway.internal:8000",
    "http://@forecast.railway.internal:8000",
    "http://forecast.railway.internal:8000/path",
    "http://forecast.railway.internal:8000/../",
    "http://forecast.railway.internal:8000/%2e/",
    "http://forecast.railway.internal:8000//",
    "http://forecast.railway.internal:8000?secret=x",
    "http://forecast.railway.internal:8000?",
    "http://forecast.railway.internal:8000#secret",
    "http://forecast.railway.internal:8000#",
    " http://forecast.railway.internal:8000",
    "http://forecast.railway.internal:8000\n",
    "HTTP://FORECAST.RAILWAY.INTERNAL:8000",
    "http://forecast.railway.internal:08000",
  ])("rejects a private-mode URL outside the exact allowlist %#", (url) => {
    expect(() =>
      parseFoundationConfig({ ...privateEnv, FORECAST_SERVICE_URL: url }),
    ).toThrow(
      "Private forecast HTTP requires http://forecast.railway.internal:8000",
    );
  });
  it.each(["RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID"])(
    "requires the documented Railway runtime context %s",
    (name) => {
      for (const value of [undefined, "", "   "]) {
        expect(() =>
          parseFoundationConfig({ ...privateEnv, [name]: value }),
        ).toThrow(
          "Private forecast HTTP requires Railway project and environment context",
        );
      }
    },
  );
  it("requires the URL and an independent key when the mode is enabled", () => {
    expect(() =>
      parseFoundationConfig({ ...privateEnv, FORECAST_SERVICE_URL: undefined }),
    ).toThrow();
    for (const key of [
      undefined,
      "",
      "secret-invalid",
      env.JWT_SECRET,
      env.CONTACT_KEY,
      env.OTP_KEY,
      env.JWT_SECRET.toUpperCase(),
    ]) {
      expect(() =>
        parseFoundationConfig({ ...privateEnv, FORECAST_SERVICE_KEY: key }),
      ).toThrow();
    }
  });
  it("keeps private configuration errors free of supplied secrets", () => {
    expect(() =>
      parseFoundationConfig({
        ...privateEnv,
        FORECAST_SERVICE_URL:
          "http://user:secret-value@forecast.railway.internal:8000",
      }),
    ).toThrow(
      new Error(
        "Private forecast HTTP requires http://forecast.railway.internal:8000",
      ),
    );
  });
});
