import { Writable } from "node:stream";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createLogger } from "../config/logger.js";

const config = { port: 3000, frontendOrigin: "http://127.0.0.1:5173" };

function testApp() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { app: createApp(config, createLogger(destination)), lines };
}

describe("GET /health/live", () => {
  it("returns only process liveness and a matching correlation ID", async () => {
    const { app } = testApp();
    const response = await request(app)
      .get("/health/live?ignored=1")
      .set("X-Correlation-Id", "safe_trace-123");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "alive",
      correlation_id: "safe_trace-123",
    });
    expect(response.headers["x-correlation-id"]).toBe("safe_trace-123");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("replaces oversized or unsafe correlation IDs", async () => {
    const { app } = testApp();
    const response = await request(app)
      .get("/health/live")
      .set("X-Correlation-Id", "x".repeat(128));

    expect(response.body.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.correlation_id).not.toContain("x".repeat(128));
  });

  it("does not disclose request secrets in the response or logs", async () => {
    const { app, lines } = testApp();
    const secret = "private-value-987";
    const response = await request(app)
      .get(`/health/live?token=${secret}`)
      .set("Authorization", `Bearer ${secret}`);

    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(lines.join("")).not.toContain(secret);
    expect(JSON.stringify(response.body)).not.toMatch(
      /database|ready|environment|hostname/i,
    );
  });

  it("allows only the configured browser origin", async () => {
    const { app } = testApp();
    const allowed = await request(app)
      .get("/health/live")
      .set("Origin", config.frontendOrigin);
    const denied = await request(app)
      .get("/health/live")
      .set("Origin", "http://127.0.0.1:5999");

    expect(allowed.headers["access-control-allow-origin"]).toBe(
      config.frontendOrigin,
    );
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not expose a business route", async () => {
    const { app } = testApp();
    const response = await request(app).get("/api/v1/events");
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toMatch(/event data|secret/i);
  });
});
