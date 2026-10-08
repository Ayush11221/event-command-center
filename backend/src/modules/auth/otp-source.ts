import { isIP } from "node:net";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Request } from "express";
import {
  defaultOtpAbuseConfig,
  trustedOtpProxies,
  type OtpAbuseConfig,
} from "../../config/otp-abuse.js";
import { unavailable } from "./errors.js";

const bodyDigests = new WeakMap<IncomingMessage, string>();
export function captureOtpBody(request: IncomingMessage, body: Buffer): void {
  bodyDigests.set(request, createHash("sha256").update(body).digest("hex"));
}

function decodeAssertionPart(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw unavailable();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw unavailable();
  return bytes;
}

function signedGatewaySource(request: Request, config: OtpAbuseConfig): string {
  const assertions = request.rawHeaders.filter(
    (_value, index) =>
      index % 2 === 0 &&
      request.rawHeaders[index]!.toLowerCase() === "x-eoc-otp-source",
  );
  const assertion = request.headers["x-eoc-otp-source"];
  if (
    assertions.length !== 1 ||
    typeof assertion !== "string" ||
    Buffer.byteLength(assertion) > 2048 ||
    config.sourceSigningKey?.length !== 32
  )
    throw unavailable();
  const parts = assertion.split(".");
  if (parts.length !== 2) throw unavailable();
  const bytes = decodeAssertionPart(parts[0]!);
  const mac = decodeAssertionPart(parts[1]!);
  const expected = createHmac("sha256", config.sourceSigningKey)
    .update(`eoc-otp-source:v1:${parts[0]}`)
    .digest();
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected))
    throw unavailable();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw unavailable();
  }
  const fields = [
    "version",
    "audience",
    "source_ip",
    "issued_at",
    "method",
    "path",
    "body_sha256",
  ];
  if (
    !payload ||
    Array.isArray(payload) ||
    typeof payload !== "object" ||
    Object.keys(payload).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(payload, field)) ||
    // Compact UTF-8 JSON rejects duplicate keys and ambiguous encodings.
    !bytes.equals(Buffer.from(JSON.stringify(payload))) ||
    payload.version !== 1 ||
    payload.audience !== "eoc-otp-source:production" ||
    payload.method !== "POST" ||
    payload.method !== request.method ||
    typeof payload.path !== "string" ||
    ![
      "/api/v1/auth/account/challenge",
      "/api/v1/auth/guest/challenge",
    ].includes(payload.path) ||
    payload.path !== request.originalUrl ||
    typeof payload.source_ip !== "string" ||
    typeof payload.body_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.body_sha256) ||
    payload.body_sha256 !== bodyDigests.get(request) ||
    typeof payload.issued_at !== "number" ||
    !Number.isSafeInteger(payload.issued_at)
  )
    throw unavailable();
  const age = Date.now() / 1000 - payload.issued_at;
  if (age > 60 || age < -5) throw unavailable();
  const source = canonicalOtpIp(payload.source_ip);
  if (source !== payload.source_ip) throw unavailable();
  return source;
}

// URL serialization canonicalizes equivalent IPv6 spellings. IPv4-mapped
// IPv6 peers must share the same budget as their IPv4 representation.
export function canonicalOtpIp(value: string): string {
  const version = isIP(value);
  if (!version || value.includes("%")) throw unavailable();
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

export function otpRequestSource(
  request: Request,
  config: OtpAbuseConfig = defaultOtpAbuseConfig,
): string {
  if (config.sourceMode === "signed_gateway")
    return signedGatewaySource(request, config);
  const peer = canonicalOtpIp(request.socket.remoteAddress ?? "");
  if (config.sourceMode === "direct") return peer;
  const trusted = trustedOtpProxies(config.trustedProxyCidrs);
  const isTrusted = (address: string) =>
    trusted.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
  // Misconfigured or directly accessed proxy deployments cannot send OTPs.
  if (!isTrusted(peer)) throw unavailable();
  if (config.sourceMode === "railway")
    return canonicalOtpIp(request.header("x-real-ip") ?? "");
  const parts = (request.header("x-forwarded-for") ?? "").split(",");
  if (parts.length > 16) throw unavailable();
  const addresses = parts.map((part) => canonicalOtpIp(part.trim()));
  for (let index = addresses.length - 1; index >= 0; index--)
    if (!isTrusted(addresses[index]!)) return addresses[index]!;
  return addresses[0]!;
}
