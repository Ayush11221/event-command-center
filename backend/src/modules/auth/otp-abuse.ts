import { createHmac } from "node:crypto";
import { domainToASCII } from "node:url";
import type { Prisma } from "@prisma/client";
import type { OtpAbuseConfig } from "../../config/otp-abuse.js";
import type { Contact } from "./contact.js";
import { ApiError } from "./errors.js";

export type OtpLimitCategory = "CONTACT" | "SOURCE" | "PROVIDER";
const RETENTION_MS = 24 * 60 * 60_000;
const CLEANUP_BATCH = 200;

export function otpContactBudgetHash(contact: Contact, key: Buffer): string {
  if (contact.type !== "EMAIL") return contact.lookupHash;
  // SMTP accepts display names, comments, lists and quoted address syntax.
  // Admission accepts one bare mailbox so aliases cannot create fresh budgets.
  if (/[\p{Cc}<>(),;:"\\[\]]/u.test(contact.value))
    throw new ApiError(400, "VALIDATION", "Invalid verification input");
  const separator = contact.value.lastIndexOf("@");
  const domain = domainToASCII(contact.value.slice(separator + 1));
  if (!domain)
    throw new ApiError(400, "VALIDATION", "Invalid verification input");
  // Canonicalize only the abuse key: existing account identity hashes and
  // encrypted contacts remain compatible with previously verified addresses.
  return createHmac("sha256", key)
    .update(`EMAIL:${contact.value.slice(0, separator)}@${domain}`)
    .digest("hex");
}

export class OtpBudgetExceeded extends ApiError {
  constructor(public readonly category: OtpLimitCategory) {
    super(
      429,
      "RATE_LIMITED",
      "Too many verification requests. Please try again later.",
    );
  }
}

// Called inside the challenge transaction. A denial rolls back every reservation;
// no challenge or delivery can escape without all three reservations committing.
export async function reserveOtpBudgets(
  tx: Prisma.TransactionClient,
  config: OtpAbuseConfig,
  contactHash: string,
  source: string,
  key: Buffer,
): Promise<void> {
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  const now = clock!.now;
  // Expiry is indexed; bounded deletion avoids a worker or long cleanup locks.
  await tx.$executeRaw`
    DELETE FROM "OtpRateLimitBucket" WHERE (category, key, "windowStart") IN (
      SELECT category, key, "windowStart" FROM "OtpRateLimitBucket"
      WHERE "expiresAt" <= ${now} ORDER BY "expiresAt" LIMIT ${CLEANUP_BATCH}
      FOR UPDATE SKIP LOCKED
    )`;
  // Consistent order makes all instances lock the shared provider bucket first.
  const layers = [
    { category: "PROVIDER", identity: "application", budget: config.provider },
    { category: "SOURCE", identity: source, budget: config.source },
    { category: "CONTACT", identity: contactHash, budget: config.contact },
  ] as const;
  for (const { category, identity, budget } of layers) {
    const duration = budget.windowSeconds * 1000;
    const windowStart = new Date(
      Math.floor(now.getTime() / duration) * duration,
    );
    const expiresAt = new Date(windowStart.getTime() + duration + RETENTION_MS);
    const bucketKey = createHmac("sha256", key)
      .update(`otp-budget:${category}:${budget.windowSeconds}:${identity}`)
      .digest("hex");
    const reserved = await tx.$queryRaw<{ count: number }[]>`
      INSERT INTO "OtpRateLimitBucket" (category, key, "windowStart", "expiresAt", count)
      VALUES (${category}, ${bucketKey}, ${windowStart}, ${expiresAt}, 1)
      ON CONFLICT (category, key, "windowStart") DO UPDATE
      SET count = "OtpRateLimitBucket".count + 1
      WHERE "OtpRateLimitBucket".count < ${budget.limit}
      RETURNING count`;
    if (!reserved.length) throw new OtpBudgetExceeded(category);
  }
}
