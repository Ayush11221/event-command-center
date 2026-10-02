import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { EventState, EventVisibility, Prisma } from "@prisma/client";

export interface PrivateVerifierKey {
  version: number;
  key: Uint8Array;
}

// Purpose-separated, versioned keys from the existing server-only storage key.
// Keep CONTACT_KEY stable: replacing it invalidates verifiers and protected replay.
export function privateLinkKeys(root: Uint8Array) {
  if (root.length !== 32)
    throw new TypeError("Private-link root key is invalid");
  const derive = (purpose: string) => ({
    version: 1,
    key: createHmac("sha256", root).update(purpose).digest(),
  });
  return {
    verifier: derive("eoc.private-link.verifier.v1"),
    replay: derive("eoc.private-link.replay.v1"),
  };
}

export function privateAccessUrl(origin: string, proof: string): string {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      ))
  )
    throw new TypeError("Private-link public origin is invalid");
  url.pathname = "/private";
  url.hash = `access=${proof}`;
  return url.toString();
}

export interface LockedEvent {
  id: string;
  revision: number;
  state: EventState;
  visibility: EventVisibility | null;
}

export interface ActivePrivateLink {
  id: string;
  eventId: string;
  verifierHash: string;
  verifierKeyVersion: number;
  issuedAt: Date;
  revokedAt: Date | null;
  replacesLinkId: string | null;
}

function validateVerifierKey(key: PrivateVerifierKey): void {
  if (
    !Number.isSafeInteger(key.version) ||
    key.version < 1 ||
    key.key.length < 32
  )
    throw new TypeError("Private-link verifier key is invalid");
}

export function generatePrivateLinkProof(): string {
  return randomBytes(32).toString("base64url");
}

export function privateLinkVerifier(
  proof: string,
  key: PrivateVerifierKey,
): string {
  validateVerifierKey(key);
  if (!/^[A-Za-z0-9_-]{43}$/.test(proof))
    throw new TypeError("Private-link proof is invalid");
  return createHmac("sha256", key.key).update(proof, "utf8").digest("hex");
}

export function privateLinkVerifierMatches(
  proof: string,
  storedVerifier: string,
  key: PrivateVerifierKey,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(storedVerifier)) return false;
  let candidate: string;
  try {
    candidate = privateLinkVerifier(proof, key);
  } catch {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(candidate, "hex"),
    Buffer.from(storedVerifier, "hex"),
  );
}

export async function lockEventForCommand(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<LockedEvent | null> {
  const rows = await tx.$queryRaw<LockedEvent[]>`
    SELECT "id", "revision", "state", "visibility"
    FROM "Event"
    WHERE "id" = ${eventId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function issuePrivateAccessLink(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    verifierHash: string;
    verifierKeyVersion: number;
    issuedAt: Date;
  },
): Promise<ActivePrivateLink> {
  return tx.privateAccessLink.create({
    data: { id: randomUUID(), ...input },
  });
}

export async function replacePrivateAccessLink(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    verifierHash: string;
    verifierKeyVersion: number;
    replacedAt: Date;
  },
): Promise<
  { previous: ActivePrivateLink; replacement: ActivePrivateLink } | undefined
> {
  const rows = await tx.$queryRaw<ActivePrivateLink[]>`
    SELECT "id", "eventId", "verifierHash", "verifierKeyVersion",
           "issuedAt", "revokedAt", "replacesLinkId"
    FROM "PrivateAccessLink"
    WHERE "eventId" = ${input.eventId}::uuid AND "revokedAt" IS NULL
    FOR UPDATE
  `;
  const active = rows[0];
  if (!active) return undefined;
  const previous = await tx.privateAccessLink.update({
    where: { id: active.id },
    data: { revokedAt: input.replacedAt },
  });
  const replacement = await tx.privateAccessLink.create({
    data: {
      id: randomUUID(),
      eventId: input.eventId,
      verifierHash: input.verifierHash,
      verifierKeyVersion: input.verifierKeyVersion,
      issuedAt: input.replacedAt,
      replacesLinkId: active.id,
    },
  });
  return { previous, replacement };
}

export async function revokePrivateAccessLink(
  tx: Prisma.TransactionClient,
  eventId: string,
  revokedAt: Date,
): Promise<ActivePrivateLink | undefined> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "PrivateAccessLink"
    WHERE "eventId" = ${eventId}::uuid AND "revokedAt" IS NULL
    FOR UPDATE
  `;
  const active = rows[0];
  if (!active) return undefined;
  return tx.privateAccessLink.update({
    where: { id: active.id },
    data: { revokedAt },
  });
}
