import { describe, expect, it, vi, afterEach } from "vitest";
import request from "supertest";
import { Writable } from "node:stream";
import { createApp } from "../app.js";
import { createLogger } from "../config/logger.js";
import { category, metrics, operation } from "./telemetry.js";
import { operationalRouter } from "./http.js";
import express from "express";
import type { AuthDependencies } from "../modules/auth/http.js";

afterEach(() => vi.unstubAllEnvs());
describe("release telemetry boundary", () => {
  it("never logs arbitrary URLs/contacts/credentials or uses them as labels", async () => {
    const lines: string[] = [];
    const logger = createLogger(
      new Writable({
        write(chunk, _encoding, done) {
          lines.push(String(chunk));
          done();
        },
      }),
    );
    const app = createApp(
      { port: 3000, frontendOrigin: "http://127.0.0.1:5173" },
      logger,
    );
    await request(app)
      .get("/secret-qr-user@example.invalid?token=secret-value")
      .set("Authorization", "secret-token");
    expect(lines.join("")).not.toMatch(
      /secret-qr|example.invalid|secret-value|secret-token/,
    );
    expect(metrics()).not.toContain("example.invalid");
    expect(category("/api/v1/events/opaque-id/forecasts/current")).toBe(
      "forecasts",
    );
  });
  it("observability preserves thrown errors and counts failure without recording details", async () => {
    const error = new Error("private-data");
    await expect(
      operation("test_operation", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(metrics()).toContain('operation="test_operation",outcome="failure"');
    expect(metrics()).not.toContain("private-data");
  });
  it("conceals operational metrics without the independent key", async () => {
    vi.stubEnv("METRICS_TOKEN", "a".repeat(64));
    const db = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const app = express().use(
      "/internal",
      operationalRouter({ db } as unknown as AuthDependencies),
    );
    expect((await request(app).get("/internal/metrics")).status).toBe(404);
    expect(
      (
        await request(app)
          .get("/internal/metrics")
          .set("Authorization", "Bearer wrong")
      ).status,
    ).toBe(404);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    const response = await request(app)
      .get("/internal/metrics")
      .set("Authorization", `Bearer ${"a".repeat(64)}`);
    expect(response.status).toBe(200);
    expect(response.text).toContain("eoc_database_available 1");
    db.$queryRaw.mockRejectedValue(new Error("private-connection"));
    const degraded = await request(app)
      .get("/internal/metrics")
      .set("Authorization", `Bearer ${"a".repeat(64)}`);
    expect(degraded.status).toBe(200);
    expect(degraded.text).toContain("eoc_database_available 0");
    expect(degraded.text).not.toContain("private-connection");
  });
});
