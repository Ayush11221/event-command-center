import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const ACCOUNT_ISSUER = "event-command-center";
const ACCOUNT_AUDIENCE = "event-command-center-account";
const GUEST_AUDIENCE = "event-command-center-guest";

export interface AccountClaims {
  userId: string;
  sessionId: string;
}

export async function signAccountToken(
  userId: string,
  sessionId: string,
  key: Uint8Array,
): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(ACCOUNT_ISSUER)
    .setAudience(ACCOUNT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key);
}

export async function verifyAccountToken(
  token: string,
  key: Uint8Array,
): Promise<AccountClaims> {
  const { payload } = await jwtVerify(token, key, {
    issuer: ACCOUNT_ISSUER,
    audience: ACCOUNT_AUDIENCE,
    algorithms: ["HS256"],
    requiredClaims: ["sub", "sid", "iat", "exp"],
  });
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
    throw new Error("Invalid account claims");
  }
  return { userId: payload.sub, sessionId: payload.sid };
}

export async function signGuestProof(
  contactLookupHash: string,
  purpose: string,
  contextEventId: string | null,
  key: Uint8Array,
): Promise<string> {
  return new SignJWT({ purpose, context_event_id: contextEventId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(contactLookupHash)
    .setIssuer(ACCOUNT_ISSUER)
    .setAudience(GUEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key);
}

export async function verifyGuestProof(token: string, key: Uint8Array) {
  const { payload } = await jwtVerify(token, key, {
    issuer: ACCOUNT_ISSUER,
    audience: GUEST_AUDIENCE,
    algorithms: ["HS256"],
    requiredClaims: ["sub", "purpose", "iat", "exp"],
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.purpose !== "string" ||
    (payload.context_event_id !== null &&
      typeof payload.context_event_id !== "string")
  ) {
    throw new Error("Invalid guest claims");
  }
  return {
    contactLookupHash: payload.sub,
    purpose: payload.purpose,
    contextEventId: payload.context_event_id as string | null,
    issuedAt: payload.iat!,
    expiresAt: payload.exp!,
  };
}

export function csrfToken(sessionId: string, key: Uint8Array): string {
  return createHmac("sha256", key)
    .update(`csrf:${sessionId}`)
    .digest("base64url");
}

export function validCsrfToken(
  provided: string | undefined,
  sessionId: string,
  key: Uint8Array,
): boolean {
  if (!provided) return false;
  const expected = Buffer.from(csrfToken(sessionId, key));
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
