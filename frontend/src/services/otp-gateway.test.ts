import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Request as ExpressRequest } from "express";
import { convertCompilerOptionsFromJson, transpileModule } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gateway from "../../api/v1/auth/[purpose]/challenge.js";
import accountChallenge from "../../api/v1/auth/account/challenge.js";
import guestChallenge from "../../api/v1/auth/guest/challenge.js";
import {
  captureOtpBody,
  canonicalOtpIp,
  otpRequestSource,
} from "../../../backend/src/modules/auth/otp-source";
import { defaultOtpAbuseConfig } from "../../../backend/src/config/otp-abuse";

const key = randomBytes(32).toString("hex");
const api = "https://synthetic.up.railway.app";
const origin = "https://app.example.test";
const raw = '{ "contact": "synthetic@example.test", "type": "EMAIL" }';
const staticRoutes = [
  ["account", accountChallenge],
  ["guest", guestChallenge],
] as const;
function incoming(
  purpose = "account",
  headers: Record<string, string> = {},
  search = "",
) {
  return new Request(`${origin}/api/v1/auth/${purpose}/challenge${search}`, {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "x-vercel-forwarded-for": "192.0.2.1",
      ...headers,
    },
  });
}
const accepted = () =>
  Response.json(
    {
      status: "pending",
      correlation_id: "11111111-1111-4111-8111-111111111111",
    },
    { status: 202 },
  );
beforeEach(() => {
  vi.stubEnv("OTP_SOURCE_SIGNING_KEY", key);
  vi.stubEnv("RAILWAY_API_ORIGIN", api);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("Vercel Node OTP gateway", () => {
  it("loads the emitted shared gateway and both static entrypoints in native Node ESM", () => {
    const temporaryRoot = resolve(tmpdir());
    const outputDirectory = mkdtempSync(join(temporaryRoot, "eoc-otp-esm-"));
    try {
      const configuration = JSON.parse(readFileSync("tsconfig.json", "utf8"));
      const { options, errors } = convertCompilerOptionsFromJson(
        configuration.compilerOptions,
        process.cwd(),
      );
      expect(errors).toEqual([]);
      writeFileSync(
        join(outputDirectory, "package.json"),
        readFileSync("package.json"),
      );
      for (const purpose of ["[purpose]", "account", "guest"]) {
        const sourcePath = `api/v1/auth/${purpose}/challenge.ts`;
        const outputPath = join(
          outputDirectory,
          sourcePath.replace(/\.ts$/, ".js"),
        );
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(
          outputPath,
          transpileModule(readFileSync(sourcePath, "utf8"), {
            fileName: sourcePath,
            compilerOptions: { ...options, noEmit: false },
          }).outputText,
        );
      }
      // Vitest resolves extensionless TS imports; the deployed Node ESM loader does not.
      const result = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
            import assert from "node:assert/strict";
            globalThis.fetch = () => { throw new Error("Unexpected upstream request"); };
            for (const name of ["[purpose]", "account", "guest"]) {
              const { default: gateway } = await import("./api/v1/auth/" + name + "/challenge.js");
              const purpose = name === "[purpose]" ? "account" : name;
              const url = "https://app.example.test/api/v1/auth/" + purpose + "/challenge";
              for (const [search, status, code] of [
                ["", 405, "METHOD_NOT_ALLOWED"],
                ["?purpose=" + purpose, 404, "NOT_FOUND"],
              ]) {
                const response = await gateway.fetch(new Request(url + search));
                assert.equal(response.status, status);
                assert.equal((await response.json()).code, code);
                assert.equal(response.headers.get("Cache-Control"), "no-store");
              }
            }
            console.log("loaded");
          `,
        ],
        { cwd: outputDirectory, encoding: "utf8", timeout: 10_000 },
      );
      expect(result.trim()).toBe("loaded");
    } finally {
      if (dirname(outputDirectory) !== temporaryRoot)
        throw new Error("Unsafe temporary output directory");
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
  it.each(staticRoutes)(
    "forwards static %s raw bytes with an API-verifiable assertion without a purpose query",
    async (purpose, entrypoint) => {
      const fetcher = vi.fn(async () => accepted());
      vi.stubGlobal("fetch", fetcher);
      const incomingRequest = incoming(purpose);
      expect(new URL(incomingRequest.url).search).toBe("");
      const response = await entrypoint.fetch(incomingRequest);
      expect(response.status).toBe(202);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const [url, options] = fetcher.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(`${api}/api/v1/auth/${purpose}/challenge`);
      expect(Buffer.from(options.body as Uint8Array).toString()).toBe(raw);
      expect(options.redirect).toBe("manual");
      expect(fetcher).toHaveBeenCalledTimes(1);
      const headers = new Headers(options.headers);
      const assertion = headers.get("X-EOC-OTP-Source")!;
      const request = {
        method: "POST",
        originalUrl: `/api/v1/auth/${purpose}/challenge`,
        rawHeaders: ["x-eoc-otp-source", assertion],
        headers: { "x-eoc-otp-source": assertion },
      } as unknown as ExpressRequest;
      captureOtpBody(request, Buffer.from(raw));
      expect(
        otpRequestSource(request, {
          ...defaultOtpAbuseConfig,
          sourceMode: "signed_gateway",
          sourceSigningKey: Buffer.from(key, "hex"),
        }),
      ).toBe("192.0.2.1");
      const result = await response.text();
      expect(result).not.toContain(key);
      expect(result).not.toContain(assertion);
      expect(result).not.toContain("192.0.2.1");
      expect(result).not.toContain("synthetic@example.test");
    },
  );
  it.each(staticRoutes)(
    "keeps query-string rejection on the static %s route",
    async (purpose, entrypoint) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      for (const search of [
        `?purpose=${purpose}`,
        `?purpose=${purpose}&purpose=${purpose}`,
        "?upstream=https://evil.test",
      ]) {
        const response = await entrypoint.fetch(incoming(purpose, {}, search));
        expect(response.status, search).toBe(404);
        expect((await response.json()).code).toBe("NOT_FOUND");
      }
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    "2001:0db8:0:0:0:0:0:1",
    "::ffff:192.0.2.4",
    "::ffff:c000:204",
    "192.0.2.4",
  ])("uses exactly the API canonicalization for %s", async (ip) => {
    const fetcher = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await gateway.fetch(incoming("guest", { "x-vercel-forwarded-for": ip })))
        .status,
    ).toBe(202);
    const options = (
      fetcher.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    const assertion = new Headers(options.headers).get("x-eoc-otp-source")!;
    const [encoded, mac] = assertion.split(".");
    const payload = JSON.parse(Buffer.from(encoded!, "base64url").toString());
    expect(payload.source_ip).toBe(canonicalOtpIp(ip));
    expect(payload.body_sha256).toBe(
      createHash("sha256").update(raw).digest("hex"),
    );
    expect(mac).toBe(
      createHmac("sha256", Buffer.from(key, "hex"))
        .update(`eoc-otp-source:v1:${encoded}`)
        .digest("base64url"),
    );
  });
  it("constructs only four outbound headers and strips every client credential/source header", async () => {
    const fetcher = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", fetcher);
    await gateway.fetch(
      incoming("account", {
        "X-Real-IP": "198.51.100.1",
        "X-Forwarded-For": "198.51.100.2",
        "X-EOC-OTP-Source": "spoofed",
        Cookie: "secret",
        Authorization: "secret",
        "X-Source-IP": "198.51.100.3",
        "X-Correlation-Id": "contact@example.test",
      }),
    );
    const options = (
      fetcher.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    const headers = new Headers(options.headers);
    expect([...headers.keys()].sort()).toEqual([
      "content-type",
      "origin",
      "x-correlation-id",
      "x-eoc-otp-source",
    ]);
    expect(headers.get("x-eoc-otp-source")).not.toBe("spoofed");
    expect(headers.get("x-correlation-id")).not.toContain("contact");
  });
  it.each([
    "admin",
    "guest/verify",
    "account/verify",
    "account/challenge?upstream=https://evil.test",
  ])("rejects an arbitrary route/purpose %s", async (purpose) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await gateway.fetch(incoming(purpose))).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects an arbitrary upstream query, methods and cross-origin requests", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await gateway.fetch(
          new Request(
            `${origin}/api/v1/auth/account/challenge?upstream=https://evil.test`,
          ),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await gateway.fetch(
          new Request(`${origin}/api/v1/auth/account/challenge`),
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await gateway.fetch(
          incoming("account", { Origin: "https://evil.test" }),
        )
      ).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "192.0.2.1, 198.51.100.1",
    "192.0.2.1:80",
    "[::1]",
    "fe80::1%zone",
    "192.0.2.01",
  ])(
    "rejects missing/ambiguous platform metadata %s without fallback",
    async (ip) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const r = incoming("account", {
        "x-vercel-forwarded-for": ip,
        "x-real-ip": "192.0.2.2",
        "x-forwarded-for": "192.0.2.2",
      });
      expect((await gateway.fetch(r)).status).toBe(503);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate platform metadata", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const r = incoming();
    r.headers.append("x-vercel-forwarded-for", "192.0.2.2");
    expect((await gateway.fetch(r)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "http://synthetic.up.railway.app",
    "https://user:password@synthetic.up.railway.app",
    `${api}/path`,
    `${api}?target=evil`,
    `${api}#fragment`,
  ])("rejects unsafe configured origins", async (value) => {
    vi.stubEnv("RAILWAY_API_ORIGIN", value);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await gateway.fetch(incoming())).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["", "A".repeat(64), "a".repeat(63), "a".repeat(64) + "\n"])(
    "fails closed on malformed gateway key",
    async (value) => {
      vi.stubEnv("OTP_SOURCE_SIGNING_KEY", value);
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      expect((await gateway.fetch(incoming())).status).toBe(503);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("never follows redirects, retries errors or returns upstream secret fields", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { Location: "https://evil.test" },
        }),
      )
      .mockRejectedValueOnce(new Error(key))
      .mockResolvedValueOnce(
        Response.json({ status: "pending", assertion: key }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect((await gateway.fetch(incoming())).status).toBe(503);
    const failed = await gateway.fetch(incoming());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain(key);
    expect(await (await gateway.fetch(incoming())).text()).not.toContain(key);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("aborts the upstream after ten seconds with no retry", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => reject(new Error("Aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = gateway.fetch(incoming());
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await result).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1].signal!.aborted).toBe(true);
  });
  it("preserves generic API rejection codes and sends no caching or credential headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { code: "RATE_LIMITED", message: key },
          {
            status: 429,
            headers: { "X-EOC-OTP-Source": key, "Set-Cookie": key },
          },
        ),
      ),
    );
    const response = await gateway.fetch(incoming());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      code: "RATE_LIMITED",
      message: "Too many verification requests. Please try again later.",
    });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("X-EOC-OTP-Source")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("also bounds a stalled or oversized upstream response", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 202,
        }),
      )
      .mockResolvedValueOnce(
        new Response("a".repeat(16 * 1024 + 1), { status: 202 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const pending = gateway.fetch(incoming());
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await pending).status).toBe(503);
    expect((await gateway.fetch(incoming())).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds bodies and rejects unsupported body encodings before forwarding", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const r = incoming();
    const large = new Request(r.url, {
      method: "POST",
      headers: r.headers,
      body: "a".repeat(16 * 1024 + 1),
    });
    expect((await gateway.fetch(large)).status).toBe(503);
    expect(
      (
        await gateway.fetch(
          incoming("account", { "Content-Type": "text/plain" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await gateway.fetch(incoming("account", { "Content-Encoding": "gzip" })))
        .status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps both challenge routes ahead of a SPA fallback that excludes API paths", () => {
    const configuration = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(configuration.rewrites).toEqual([
      {
        source: "/api/v1/auth/account/challenge",
        destination: "/api/v1/auth/account/challenge",
      },
      {
        source: "/api/v1/auth/guest/challenge",
        destination: "/api/v1/auth/guest/challenge",
      },
      { source: "/((?!api(?:/|$)).*)", destination: "/index.html" },
    ]);
    const fallback = new RegExp(`^${configuration.rewrites.at(-1).source}$`);
    for (const path of [
      "/api",
      "/api/",
      "/api/v1/auth/account/challenge",
      "/api/v1/auth/guest/challenge",
      "/api/v1/unknown",
    ]) {
      expect(fallback.test(path), path).toBe(false);
    }
    for (const path of [
      "/",
      "/events",
      "/events/synthetic/operations",
      "/apiary",
      "/api-example",
    ]) {
      expect(fallback.test(path), path).toBe(true);
    }
  });
});
