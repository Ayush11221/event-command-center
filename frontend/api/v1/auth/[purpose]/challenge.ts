import { createHash, createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";

const paths = [
  "/api/v1/auth/account/challenge",
  "/api/v1/auth/guest/challenge",
];
const timeoutMs = 10_000;
const bodyLimit = 16 * 1024;

function failure(
  status = 503,
  code = "DEPENDENCY_UNAVAILABLE",
  message = "Service unavailable",
) {
  return Response.json(
    {
      code,
      message,
      ...(status === 503 ? { retryable: true } : {}),
      correlation_id: randomUUID(),
    },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

// Same canonicalization as the API; interoperability tests cover both copies.
function canonicalSource(value: string): string {
  const version = isIP(value);
  if (!version || value.includes("%"))
    throw new Error("Invalid source metadata");
  if (version === 4) return value;
  const address = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(address);
  if (!mapped) return address;
  const bytes =
    Number.parseInt(mapped[1]!, 16) * 65536 + Number.parseInt(mapped[2]!, 16);
  return [
    bytes >>> 24,
    (bytes >>> 16) & 255,
    (bytes >>> 8) & 255,
    bytes & 255,
  ].join(".");
}

function apiOrigin(): string {
  const value = process.env.RAILWAY_API_ORIGIN;
  const origin = new URL(value ?? "");
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (value !== origin.origin && value !== `${origin.origin}/`)
  )
    throw new Error("Invalid API origin");
  return origin.origin;
}

async function boundedBody(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) return Buffer.concat(chunks);
      size += value.byteLength;
      if (size > bodyLimit) throw new Error("Body exceeds limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!paths.includes(url.pathname) || url.search)
      return failure(404, "NOT_FOUND", "Not found");
    if (request.method !== "POST")
      return failure(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    // The API retains its exact Origin policy. Never substitute a client Host.
    const origin = request.headers.get("origin");
    if (origin !== url.origin)
      return failure(403, "FORBIDDEN", "Request origin not allowed");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const key = process.env.OTP_SOURCE_SIGNING_KEY;
      if (key?.length !== 64 || !/^[a-f0-9]{64}$/.test(key))
        throw new Error("Invalid signing configuration");
      const target = apiOrigin();
      // Vercel-owned metadata only. Comma-merged duplicate headers/arrays fail isIP.
      const source = canonicalSource(
        request.headers.get("x-vercel-forwarded-for") ?? "",
      );
      if (
        request.headers.has("content-encoding") &&
        request.headers.get("content-encoding") !== "identity"
      )
        return failure(400, "VALIDATION", "Invalid request body");
      const contentType = request.headers.get("content-type") ?? "";
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType))
        return failure(400, "VALIDATION", "Invalid request body");
      const body = await boundedBody(request.body);
      const payload = Buffer.from(
        JSON.stringify({
          version: 1,
          audience: "eoc-otp-source:production",
          source_ip: source,
          issued_at: Math.floor(Date.now() / 1000),
          method: "POST",
          path: url.pathname,
          body_sha256: createHash("sha256").update(body).digest("hex"),
        }),
      ).toString("base64url");
      const mac = createHmac("sha256", Buffer.from(key!, "hex"))
        .update(`eoc-otp-source:v1:${payload}`)
        .digest("base64url");
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const upstream = await fetch(`${target}${url.pathname}`, {
        method: "POST",
        body: new Uint8Array(body),
        headers: {
          "Content-Type": contentType,
          Origin: origin,
          "X-Correlation-Id": randomUUID(),
          "X-EOC-OTP-Source": `${payload}.${mac}`,
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        return failure();
      }
      const responseBody = await boundedBody(upstream.body, controller.signal);
      // Only the existing challenge envelope can leave the gateway. No upstream
      // headers, cookies, assertion, provider response or arbitrary body is relayed.
      const result = JSON.parse(responseBody.toString("utf8")) as Record<
        string,
        unknown
      >;
      const correlation =
        typeof result.correlation_id === "string" &&
        /^[a-f0-9-]{36}$/.test(result.correlation_id)
          ? result.correlation_id
          : randomUUID();
      if (upstream.status === 202 && result.status === "pending")
        return Response.json(
          { status: "pending", correlation_id: correlation },
          {
            status: 202,
            headers: { "Cache-Control": "no-store" },
          },
        );
      const errors: Record<string, string> = {
        VALIDATION: "Invalid verification input",
        FORBIDDEN: "Request origin not allowed",
        RATE_LIMITED: "Too many verification requests. Please try again later.",
        DEPENDENCY_UNAVAILABLE: "Service unavailable",
        INTERNAL_ERROR: "Request failed",
      };
      if (
        upstream.status < 400 ||
        typeof result.code !== "string" ||
        !Object.hasOwn(errors, result.code)
      )
        return failure();
      return Response.json(
        {
          code: result.code,
          message: errors[result.code],
          ...(result.retryable === true ? { retryable: true } : {}),
          correlation_id: correlation,
        },
        {
          status: upstream.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch {
      return failure();
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
};
