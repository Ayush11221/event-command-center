import { isIP } from "node:net";
import type { Request } from "express";
import {
  defaultOtpAbuseConfig,
  trustedOtpProxies,
  type OtpAbuseConfig,
} from "../../config/otp-abuse.js";
import { unavailable } from "./errors.js";

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
