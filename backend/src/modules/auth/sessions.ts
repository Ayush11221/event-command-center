import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Prisma, Session } from "@prisma/client";
import type { FoundationConfig } from "../../config/foundation.js";
import { accountActor, recordAudit } from "./audit.js";
import { ApiError } from "./errors.js";

export const ACCESS_MS = 15 * 60_000;
export const IDLE_MS = 8 * 60 * 60_000;
export const ABSOLUTE_MS = 7 * 24 * 60 * 60_000;
const RACE_MS = 5_000;

const denied = () =>
  new ApiError(401, "UNAUTHENTICATED", "Authentication required");
const conflict = () =>
  new ApiError(409, "RENEWAL_CONFLICT", "Retry session check", {
    retryable: true,
  });

function digest(domain: string, value: string, key: Uint8Array) {
  return createHmac("sha256", key).update(`${domain}:${value}`).digest("hex");
}

function equal(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The MAC authenticates the session/version before any replay revocation. A forged
// selector must never let an attacker revoke somebody else's session. Only the
// hash of the complete random credential is persisted; MAC/hash domains differ.
export function renewalCredential(
  sessionId: string,
  version: number,
  key: Uint8Array,
) {
  const value = `${sessionId}.${version}.${randomBytes(32).toString("base64url")}`;
  return `${value}.${digest("account-renewal-proof-v1", value, key)}`;
}

export function renewalHash(credential: string, key: Uint8Array) {
  return digest("account-renewal-storage-v1", credential, key);
}

export function parseRenewal(credential: string | undefined, key: Uint8Array) {
  const match = credential?.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(0|[1-9][0-9]{0,9})\.([A-Za-z0-9_-]{43})\.([0-9a-f]{64})$/,
  );
  if (
    !match ||
    !equal(
      match[4],
      digest(
        "account-renewal-proof-v1",
        `${match[1]}.${match[2]}.${match[3]}`,
        key,
      ),
    )
  )
    throw denied();
  return {
    sessionId: match[1],
    version: Number(match[2]),
    credential: credential!,
  };
}

export function liveSession(
  session: Session | null,
  now: Date,
): session is Session {
  return Boolean(
    session &&
    !session.revokedAt &&
    session.expiresAt > now &&
    (!session.absoluteExpiresAt || session.absoluteExpiresAt > now),
  );
}

export function idleExpiry(now: Date, absolute: Date) {
  return new Date(Math.min(now.getTime() + IDLE_MS, absolute.getTime()));
}

export async function createAccountSession(
  tx: Prisma.TransactionClient,
  userId: string,
  config: FoundationConfig,
  correlationId: string,
  now: Date,
) {
  const sessionId = randomUUID();
  const renewal = renewalCredential(sessionId, 0, config.jwtSecret);
  const absolute = new Date(now.getTime() + ABSOLUTE_MS);
  await tx.session.create({
    data: {
      id: sessionId,
      userId,
      createdAt: now,
      expiresAt: idleExpiry(now, absolute),
      absoluteExpiresAt: absolute,
      renewalHash: renewalHash(renewal, config.jwtSecret),
      renewalVersion: 0,
      renewedAt: now,
    },
  });
  await recordAudit(tx, {
    actorKind: accountActor,
    actorUserId: userId,
    action: "SESSION_CREATED",
    outcome: "ACCEPTED",
    correlationId,
  });
  return {
    kind: "account" as const,
    userId,
    sessionId,
    renewal,
    absoluteExpiresAt: absolute,
  };
}

export function requireCurrentRenewal(
  session: Session | null,
  proof: ReturnType<typeof parseRenewal>,
  key: Uint8Array,
  now: Date,
) {
  if (
    !liveSession(session, now) ||
    !session.renewalHash ||
    !session.absoluteExpiresAt
  )
    throw new ApiError(401, "SESSION_EXPIRED", "Authentication required");
  if (
    proof.version !== session.renewalVersion ||
    !equal(renewalHash(proof.credential, key), session.renewalHash)
  ) {
    if (
      proof.version === session.renewalVersion - 1 &&
      session.renewedAt &&
      now.getTime() - session.renewedAt.getTime() < RACE_MS
    )
      throw conflict();
    throw denied();
  }
  return session;
}

// Caller locks Session FOR UPDATE and validates Origin/CSRF before entering here.
// Return denial after committing the revocation/audit, never throw it in the tx.
export async function rotateSession(
  tx: Prisma.TransactionClient,
  session: Session | null,
  proof: ReturnType<typeof parseRenewal>,
  config: FoundationConfig,
  correlationId: string,
) {
  const now = new Date();
  try {
    requireCurrentRenewal(session, proof, config.jwtSecret, now);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      liveSession(session, now) &&
      session.renewalHash &&
      proof.version < session.renewalVersion
    ) {
      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: now, renewalHash: null },
      });
      await recordAudit(tx, {
        actorKind: accountActor,
        actorUserId: session.userId,
        action: "SESSION_RENEWAL_REPLAY",
        outcome: "DENIED",
        correlationId,
      });
    }
    return { error: error as ApiError };
  }
  const current = session!;
  const renewal = renewalCredential(
    current.id,
    current.renewalVersion + 1,
    config.jwtSecret,
  );
  await tx.session.update({
    where: { id: current.id },
    data: {
      renewalHash: renewalHash(renewal, config.jwtSecret),
      renewalVersion: { increment: 1 },
      renewedAt: now,
      expiresAt: idleExpiry(now, current.absoluteExpiresAt!),
    },
  });
  await recordAudit(tx, {
    actorKind: accountActor,
    actorUserId: current.userId,
    action: "SESSION_RENEWED",
    outcome: "ACCEPTED",
    correlationId,
  });
  return {
    userId: current.userId,
    sessionId: current.id,
    renewal,
    absoluteExpiresAt: current.absoluteExpiresAt!,
  };
}
