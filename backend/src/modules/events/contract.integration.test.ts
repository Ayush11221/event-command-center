import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { csrfToken, signAccountToken } from "../auth/tokens.js";

type Schema = {
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
};
type Operation = {
  operationId: string;
  security: Record<string, never[]>[];
  parameters?: { $ref: string }[];
  responses: Record<
    string,
    { content: { "application/json": { schema: Schema } } }
  >;
};
const specification = JSON.parse(
  readFileSync(
    new URL("../../../../docs/api/SLICE_3_OPENAPI.json", import.meta.url),
    "utf8",
  ),
) as {
  openapi: string;
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};
const operations = Object.entries(specification.paths).flatMap(
  ([path, value]) =>
    Object.entries(value).map(([method]) => `${method.toUpperCase()} ${path}`),
);

// Verify response shapes, types and fixed states against the delivered artifact.
// This is intentionally not a general OpenAPI/JSON Schema validator.
function assertResponseShape(schema: Schema, value: unknown): void {
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1)!;
    expect(specification.components.schemas[name]).toBeDefined();
    return assertResponseShape(specification.components.schemas[name], value);
  }
  const actualType =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type) {
    const types = [schema.type].flat();
    expect(
      types.includes(actualType) ||
        (types.includes("integer") && Number.isInteger(value)),
    ).toBe(true);
  }
  if (Object.hasOwn(schema, "const")) expect(value).toEqual(schema.const);
  if (schema.enum) expect(schema.enum).toContain(value);
  if (actualType === "object" && schema.properties) {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) expect(object).toHaveProperty(key);
    if (schema.additionalProperties === false)
      expect(
        Object.keys(object).every((key) => key in schema.properties!),
      ).toBe(true);
    for (const [key, item] of Object.entries(object))
      if (schema.properties[key])
        assertResponseShape(schema.properties[key], item);
  }
  if (Array.isArray(value) && schema.items)
    for (const item of value) assertResponseShape(schema.items, item);
}

describe("V10 implemented OpenAPI contract", () => {
  it("resolves every local reference and declares every required schema field", () => {
    function visit(value: unknown): void {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) return value.forEach(visit);
      const object = value as Record<string, unknown>;
      if (typeof object.$ref === "string") {
        expect(object.$ref.startsWith("#/components/")).toBe(true);
        let target: unknown = specification;
        for (const key of object.$ref.slice(2).split("/")) {
          expect(target).toBeTypeOf("object");
          target = (target as Record<string, unknown>)[key];
          expect(target).toBeDefined();
        }
      }
      Object.values(object).forEach(visit);
    }
    visit(specification);
    for (const schema of Object.values(specification.components.schemas))
      for (const field of schema.required ?? [])
        expect(schema.properties).toHaveProperty(field);
  });

  it("represents exactly the twelve authoritative Markdown operations", () => {
    const contract = readFileSync(
      new URL("../../../../docs/api/API_CONTRACT.md", import.meta.url),
      "utf8",
    )
      .split("### Exact endpoints")[1]
      .split("### Field, payload")[0];
    const approved = Array.from(
      contract.matchAll(/`(GET|POST|PATCH) \/api\/v1([^`?]+)(?:\?[^`]*)?`/g),
      ([, method, path]) => `${method} ${path}`,
    );
    expect(specification.openapi).toBe("3.1.0");
    expect(approved).toHaveLength(12);
    expect(operations.sort()).toEqual(approved.sort());
  });

  it("keeps bearer viewing separate from management and write preconditions", () => {
    for (const [path, methods] of Object.entries(specification.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(operation.security).toEqual(
          path === "/discovery/private"
            ? [{ PrivateLink: [] }]
            : path.startsWith("/discovery/")
              ? []
              : [{ AccountSession: [] }],
        );
        const parameters = operation.parameters?.map((item) => item.$ref) ?? [];
        const has = (name: string) =>
          parameters.includes(`#/components/parameters/${name}`);
        const mutation = method !== "get";
        expect(has("Csrf")).toBe(mutation);
        expect(has("Revision")).toBe(mutation && path !== "/events");
        expect(has("IdempotencyKey")).toBe(mutation && method !== "patch");
      }
    }
  });

  it("uses the same closed detail allowlist for anonymous PUBLIC and PRIVATE", () => {
    const reference = { $ref: "#/components/schemas/PublishedDetail" };
    for (const path of ["/discovery/events/{eventId}", "/discovery/private"])
      expect(
        specification.paths[path].get.responses["200"].content[
          "application/json"
        ].schema,
      ).toEqual(reference);
    const schema = specification.components.schemas.PublishedDetail;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties!).sort()).toEqual(
      [
        "event_id",
        "name",
        "description",
        "event_state",
        "start_at",
        "end_at",
        "time_zone",
        "public_location",
        "image_url",
        "category",
        "tags",
        "availability",
        "as_of",
        "correlation_id",
      ].sort(),
    );
    expect(schema.properties!.event_state.enum).toEqual(["PUBLISHED", "LIVE"]);
    expect(
      Object.keys(
        specification.components.schemas.Availability.properties!,
      ).sort(),
    ).toEqual(
      ["policy_status", "reasons", "opens_at", "closes_at", "as_of"].sort(),
    );
    expect(
      specification.components.schemas.PrivateRevokeResult.properties,
    ).not.toHaveProperty("access_url");
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "V10 all twelve live API response contracts (PostgreSQL)",
  () => {
    const db = createDatabase(databaseUrl ?? "");
    const origin = "http://127.0.0.1:5173";
    const config = {
      databaseUrl: databaseUrl ?? "",
      jwtSecret: new Uint8Array(Buffer.alloc(32, 9)),
      contactKey: Buffer.alloc(32, 10),
      otpKey: Buffer.alloc(32, 11),
      cookieSecure: false,
    };
    const app = createApp(
      { port: 3000, frontendOrigin: origin },
      createLogger(
        new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        }),
      ),
      {
        db,
        config,
        frontendOrigin: origin,
        otp: new OtpService(db, config, {
          available: () => false,
          async send() {},
        }),
      },
    );
    afterAll(async () => {
      await db.$disconnect();
    });

    it("matches every successful operation and preserves the anonymous allowlist after rotation", async () => {
      const user = await db.user.create({ data: { organizerCapable: true } });
      const session = await db.session.create({
        data: {
          userId: user.id,
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      const cookie = `eoc_session=${await signAccountToken(user.id, session.id, config.jwtSecret)}`;
      const csrf = csrfToken(session.id, config.jwtSecret);
      const visited = new Set<string>();
      const check = (
        method: string,
        path: string,
        status: number,
        response: { status: number; body: unknown },
      ) => {
        expect(response.status).toBe(status);
        assertResponseShape(
          specification.paths[path][method].responses[String(status)].content[
            "application/json"
          ].schema,
          response.body,
        );
        visited.add(`${method.toUpperCase()} ${path}`);
      };
      const write = (
        method: "post" | "patch",
        path: string,
        revision?: number,
      ) => {
        const req = request(app)
          [method](`/api/v1${path}`)
          .set("Cookie", cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", csrf);
        if (method === "post") req.set("Idempotency-Key", randomUUID());
        if (revision !== undefined) req.set("If-Match", `"${revision}"`);
        return req;
      };
      const created = await write("post", "/events").send({
        name: "V10 contract event",
      });
      check("post", "/events", 201, created);
      const id = created.body.event_id as string;
      check(
        "get",
        "/events",
        200,
        await request(app)
          .get("/api/v1/events?view=owned")
          .set("Cookie", cookie),
      );
      check(
        "get",
        "/events/{eventId}",
        200,
        await request(app).get(`/api/v1/events/${id}`).set("Cookie", cookie),
      );
      const edited = await write("patch", `/events/${id}`, 1).send({
        visibility: "PUBLIC",
        start_at: "2030-01-01T10:00:00Z",
        end_at: "2030-01-01T12:00:00Z",
        time_zone: "Asia/Kolkata",
        registration_capacity: 50,
      });
      check("patch", "/events/{eventId}", 200, edited);
      check(
        "post",
        "/events/{eventId}/gates",
        201,
        await write("post", `/events/${id}/gates`, 2).send({}),
      );
      check(
        "post",
        "/events/{eventId}/transitions",
        200,
        await write("post", `/events/${id}/transitions`, 3).send({
          target_state: "PUBLISHED",
        }),
      );
      check(
        "get",
        "/discovery/events",
        200,
        await request(app).get("/api/v1/discovery/events"),
      );
      check(
        "get",
        "/discovery/events/{eventId}",
        200,
        await request(app).get(`/api/v1/discovery/events/${id}`),
      );
      await write("patch", `/events/${id}`, 4)
        .send({ visibility: "PRIVATE" })
        .expect(200);
      const issued = await write("post", `/events/${id}/private-link`, 5).send(
        {},
      );
      check("post", "/events/{eventId}/private-link", 201, issued);
      const proof = (url: string) => new URL(url).hash.slice("#access=".length);
      const detail = (url: string) =>
        request(app)
          .get("/api/v1/discovery/private")
          .set("Authorization", `PrivateLink ${proof(url)}`);
      check(
        "get",
        "/discovery/private",
        200,
        await detail(issued.body.access_url),
      );
      const rotated = await write(
        "post",
        `/events/${id}/private-link/reissue`,
        6,
      ).send({});
      check("post", "/events/{eventId}/private-link/reissue", 200, rotated);
      await detail(issued.body.access_url).expect(404);
      check(
        "get",
        "/discovery/private",
        200,
        await detail(rotated.body.access_url),
      );
      check(
        "post",
        "/events/{eventId}/private-link/revoke",
        200,
        await write("post", `/events/${id}/private-link/revoke`, 7).send({}),
      );
      await detail(rotated.body.access_url).expect(404);
      expect([...visited].sort()).toEqual(operations);
    });
  },
);
