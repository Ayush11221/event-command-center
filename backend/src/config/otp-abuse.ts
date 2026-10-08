import { BlockList, isIP } from "node:net";

export interface OtpBudget {
  limit: number;
  windowSeconds: number;
}

export interface OtpAbuseConfig {
  contact: OtpBudget;
  source: OtpBudget;
  provider: OtpBudget;
  sourceMode: "direct" | "forwarded" | "railway" | "signed_gateway";
  trustedProxyCidrs: string[];
  sourceSigningKey?: Buffer;
}

export const defaultOtpAbuseConfig: OtpAbuseConfig = {
  contact: { limit: 10, windowSeconds: 3600 },
  source: { limit: 120, windowSeconds: 600 },
  provider: { limit: 500, windowSeconds: 3600 },
  sourceMode: "direct",
  trustedProxyCidrs: [],
};

export function trustedOtpProxies(cidrs: string[]): BlockList {
  const peers = new BlockList();
  for (const cidr of cidrs) {
    const [address, prefix, extra] = cidr.split("/");
    const version = isIP(address ?? "");
    const bits = Number(prefix);
    if (
      !version ||
      extra !== undefined ||
      !/^\d+$/.test(prefix ?? "") ||
      bits < 1 ||
      bits > (version === 4 ? 32 : 128)
    ) {
      throw new Error("OTP_TRUSTED_PROXY_CIDRS must contain explicit IP CIDRs");
    }
    peers.addSubnet(address!, bits, version === 4 ? "ipv4" : "ipv6");
  }
  return peers;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  max: number,
) {
  const value = env[name];
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > max)
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  return Number(value);
}

export function parseOtpAbuseConfig(env: NodeJS.ProcessEnv): OtpAbuseConfig {
  const sourceMode =
    env.OTP_SOURCE_MODE ??
    (env.NODE_ENV === "production" ? undefined : "direct");
  if (
    !["direct", "forwarded", "railway", "signed_gateway"].includes(
      sourceMode ?? "",
    )
  )
    throw new Error(
      "OTP_SOURCE_MODE must explicitly select direct, forwarded, railway or signed_gateway in production",
    );
  const trustedProxyCidrs =
    env.OTP_TRUSTED_PROXY_CIDRS?.split(",").map((value) => value.trim()) ?? [];
  trustedOtpProxies(trustedProxyCidrs);
  let sourceSigningKey: Buffer | undefined;
  if (sourceMode === "signed_gateway") {
    if (env.OTP_TRUSTED_PROXY_CIDRS !== undefined)
      throw new Error(
        "OTP_TRUSTED_PROXY_CIDRS is forbidden for signed_gateway",
      );
    if (
      env.OTP_SOURCE_SIGNING_KEY?.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(env.OTP_SOURCE_SIGNING_KEY)
    )
      throw new Error(
        "OTP_SOURCE_SIGNING_KEY must be 32 bytes encoded as 64 lowercase hex characters",
      );
    sourceSigningKey = Buffer.from(env.OTP_SOURCE_SIGNING_KEY!, "hex");
  }
  if (
    (sourceMode === "forwarded" || sourceMode === "railway") &&
    !trustedProxyCidrs.length
  )
    throw new Error(
      "OTP_TRUSTED_PROXY_CIDRS is required for proxy source modes",
    );
  if (sourceMode === "direct" && trustedProxyCidrs.length)
    throw new Error("OTP_TRUSTED_PROXY_CIDRS requires a proxy source mode");
  const budget = (category: "CONTACT" | "SOURCE" | "PROVIDER"): OtpBudget => {
    const defaults =
      defaultOtpAbuseConfig[
        category.toLowerCase() as "contact" | "source" | "provider"
      ];
    return {
      limit: integer(env, `OTP_${category}_LIMIT`, defaults.limit, 1_000_000),
      windowSeconds: integer(
        env,
        `OTP_${category}_WINDOW_SECONDS`,
        defaults.windowSeconds,
        86_400,
      ),
    };
  };
  return {
    contact: budget("CONTACT"),
    source: budget("SOURCE"),
    provider: budget("PROVIDER"),
    sourceMode: sourceMode as OtpAbuseConfig["sourceMode"],
    trustedProxyCidrs,
    ...(sourceSigningKey ? { sourceSigningKey } : {}),
  };
}
