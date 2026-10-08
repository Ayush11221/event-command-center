import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  ContactType,
  Prisma,
  PrismaClient,
  ProofPurpose,
} from "@prisma/client";
import type { FoundationConfig } from "../../config/foundation.js";
import { recordAudit, accountActor, guestActor, systemActor } from "./audit.js";
import { encryptContact, normalizeContact, type Contact } from "./contact.js";
import { createAccountSession } from "./sessions.js";
import { ApiError, unavailable } from "./errors.js";
import type { OtpSender } from "./sender.js";
import { defaultOtpAbuseConfig } from "../../config/otp-abuse.js";
import {
  OtpBudgetExceeded,
  otpContactBudgetHash,
  reserveOtpBudgets,
  type OtpLimitCategory,
} from "./otp-abuse.js";
import { canonicalOtpIp } from "./otp-source.js";

const OTP_LIFETIME_MS = 5 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;

function hashCode(id: string, code: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(`${id}:${code}`).digest();
}

function matchesCode(id: string, code: string, expected: string, key: Buffer) {
  const actual = hashCode(id, code, key);
  const stored = Buffer.from(expected, "hex");
  return stored.length === actual.length && timingSafeEqual(actual, stored);
}

async function lockContact(tx: Prisma.TransactionClient, lookupHash: string) {
  const lock = BigInt.asIntN(64, BigInt(`0x${lookupHash.slice(0, 16)}`));
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock})::text AS locked`;
}

export interface VerifiedAccountResult {
  kind: "account";
  userId: string;
  sessionId: string;
  renewal: string;
  absoluteExpiresAt: Date;
}

export interface VerifiedGuestResult {
  kind: "guest";
  lookupHash: string;
  contextEventId: string | null;
}

export type OtpDelivery = () => Promise<void>;

export class OtpService {
  constructor(
    private readonly db: PrismaClient,
    private readonly config: FoundationConfig,
    private readonly sender: OtpSender,
    private readonly reportDeliveryFailure: (
      message: string,
    ) => void = () => {},
    private readonly reportRateLimit: (
      category: OtpLimitCategory,
    ) => void = () => {},
  ) {}

  async request(
    purpose: ProofPurpose,
    type: ContactType,
    raw: string,
    correlationId: string,
    contextEventId: string | null = null,
    source = "internal",
  ): Promise<OtpDelivery | null> {
    let contact: Contact;
    try {
      contact = normalizeContact(type, raw, this.config.contactKey);
    } catch {
      throw new ApiError(400, "VALIDATION", "Invalid verification input");
    }
    // Configuration is channel-wide, never dependent on account existence.
    if (!this.sender.available(type)) throw unavailable();
    const contactBudgetHash = otpContactBudgetHash(
      contact,
      this.config.contactKey,
    );
    const sourceIdentity =
      source === "internal" ? source : canonicalOtpIp(source);
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    let shouldDeliver = false;
    let coolingDown = false;
    try {
      await this.db.$transaction(async (tx) => {
        await reserveOtpBudgets(
          tx,
          this.config.otpAbuse ?? defaultOtpAbuseConfig,
          contactBudgetHash,
          sourceIdentity,
          this.config.otpKey,
        );
        await lockContact(tx, contact.lookupHash);
        const now = new Date();
        shouldDeliver =
          purpose === ProofPurpose.GUEST_OWNERSHIP ||
          type === ContactType.EMAIL ||
          Boolean(
            await tx.verifiedContact.findUnique({
              where: {
                type_lookupHash: { type, lookupHash: contact.lookupHash },
              },
              select: { id: true },
            }),
          );
        const previous = await tx.otpChallenge.findFirst({
          where: {
            contactType: type,
            contactLookupHash: contact.lookupHash,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (
          previous &&
          now.getTime() - previous.lastSentAt.getTime() < RESEND_COOLDOWN_MS
        ) {
          coolingDown = true;
          return;
        }
        const issuedAt =
          previous && previous.createdAt >= now
            ? new Date(previous.createdAt.getTime() + 1)
            : now;
        await tx.otpChallenge.updateMany({
          where: {
            contactType: type,
            contactLookupHash: contact.lookupHash,
            consumedAt: null,
          },
          data: { consumedAt: now },
        });
        await tx.otpChallenge.create({
          data: {
            id,
            contactType: type,
            contactLookupHash: contact.lookupHash,
            purpose,
            contextEventId,
            codeHash: hashCode(id, code, this.config.otpKey).toString("hex"),
            createdAt: issuedAt,
            lastSentAt: issuedAt,
            expiresAt: new Date(issuedAt.getTime() + OTP_LIFETIME_MS),
          },
        });
        await recordAudit(tx, {
          actorKind: systemActor,
          action: "OTP_CHALLENGE_ISSUED",
          outcome: "ACCEPTED",
          correlationId,
        });
      });
    } catch (error) {
      if (error instanceof OtpBudgetExceeded)
        this.reportRateLimit(error.category);
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
    if (coolingDown) {
      if (purpose === ProofPurpose.GUEST_OWNERSHIP) {
        throw new ApiError(429, "RATE_LIMITED", "Please wait before retrying");
      }
      return null;
    }
    if (!shouldDeliver) return null;
    // The HTTP response is deliberately independent of sender latency and outcome.
    // A 202 means the challenge was accepted, not that delivery succeeded.
    let deliveryStarted = false;
    return async () => {
      if (deliveryStarted) return;
      deliveryStarted = true;
      try {
        await this.sender.send(type, contact.value, code);
        await this.db.$transaction(async (tx) => {
          await tx.otpChallenge.update({
            where: { id },
            data: { deliveredAt: new Date() },
          });
          await recordAudit(tx, {
            actorKind: systemActor,
            action: "OTP_DELIVERED",
            outcome: "ACCEPTED",
            correlationId,
          });
        });
      } catch {
        try {
          await this.db.$transaction(async (tx) => {
            await tx.otpChallenge.update({
              where: { id },
              data: { consumedAt: new Date() },
            });
            await recordAudit(tx, {
              actorKind: systemActor,
              action: "OTP_DELIVERY_FAILED",
              outcome: "FAILED",
              correlationId,
            });
          });
        } catch {
          this.reportDeliveryFailure(
            "OTP delivery failure state could not be persisted",
          );
          return;
        }
        this.reportDeliveryFailure("OTP delivery failed");
      }
    };
  }

  async verify(
    purpose: ProofPurpose,
    type: ContactType,
    raw: string,
    code: string,
    correlationId: string,
    contextEventId: string | null = null,
  ): Promise<VerifiedAccountResult | VerifiedGuestResult> {
    if (!/^\d{6}$/.test(code)) {
      throw new ApiError(400, "VALIDATION", "Invalid verification input");
    }
    let contact: Contact;
    try {
      contact = normalizeContact(type, raw, this.config.contactKey);
    } catch {
      throw new ApiError(400, "VALIDATION", "Invalid verification input");
    }
    let result:
      | VerifiedAccountResult
      | VerifiedGuestResult
      | { kind: "invalid"; throttled: boolean };
    try {
      result = await this.db.$transaction(
        async (tx) => {
          await lockContact(tx, contact.lookupHash);
          const now = new Date();
          const challenge = await tx.otpChallenge.findFirst({
            where: {
              contactType: type,
              contactLookupHash: contact.lookupHash,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          if (!challenge) {
            const deniedId = randomUUID();
            await tx.otpChallenge.create({
              data: {
                id: deniedId,
                contactType: type,
                contactLookupHash: contact.lookupHash,
                purpose,
                contextEventId,
                codeHash: hashCode(
                  deniedId,
                  randomInt(0, 1_000_000).toString().padStart(6, "0"),
                  this.config.otpKey,
                ).toString("hex"),
                attempts: 1,
                createdAt: now,
                lastSentAt: new Date(0),
                expiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
                consumedAt: now,
              },
            });
            await recordAudit(tx, {
              actorKind:
                purpose === ProofPurpose.ACCOUNT ? accountActor : guestActor,
              action: "OTP_VERIFY_DENIED",
              outcome: "DENIED",
              correlationId,
            });
            return { kind: "invalid", throttled: false } as const;
          }
          if (challenge.lockedAt || challenge.attempts >= 5) {
            await recordAudit(tx, {
              actorKind:
                purpose === ProofPurpose.ACCOUNT ? accountActor : guestActor,
              action: "OTP_VERIFY_DENIED",
              outcome: "DENIED",
              correlationId,
            });
            return { kind: "invalid", throttled: true } as const;
          }
          if (
            challenge.purpose !== purpose ||
            challenge.contextEventId !== contextEventId ||
            challenge.expiresAt <= now ||
            challenge.consumedAt ||
            !challenge.deliveredAt ||
            !matchesCode(
              challenge.id,
              code,
              challenge.codeHash,
              this.config.otpKey,
            )
          ) {
            const attempts = challenge.attempts + 1;
            await tx.otpChallenge.update({
              where: { id: challenge.id },
              data: {
                attempts,
                lockedAt: attempts >= 5 ? now : null,
              },
            });
            await recordAudit(tx, {
              actorKind:
                purpose === ProofPurpose.ACCOUNT ? accountActor : guestActor,
              action: "OTP_VERIFY_DENIED",
              outcome: "DENIED",
              correlationId,
            });
            return { kind: "invalid", throttled: attempts >= 5 } as const;
          }
          await tx.otpChallenge.update({
            where: { id: challenge.id },
            data: { consumedAt: now },
          });
          if (purpose === ProofPurpose.GUEST_OWNERSHIP) {
            await recordAudit(tx, {
              actorKind: guestActor,
              action: "GUEST_PROOF_VERIFIED",
              outcome: "ACCEPTED",
              correlationId,
            });
            return {
              kind: "guest",
              lookupHash: contact.lookupHash,
              contextEventId,
            } as const;
          }
          let linked = await tx.verifiedContact.findUnique({
            where: {
              type_lookupHash: { type, lookupHash: contact.lookupHash },
            },
          });
          if (!linked) {
            // Only verified email creates a public account. Phone remains an
            // existing-account login channel; guest proof never reaches here.
            if (type !== ContactType.EMAIL) throw unavailable();
            const user = await tx.user.create({
              data: { organizerCapable: false },
            });
            linked = await tx.verifiedContact.create({
              data: {
                userId: user.id,
                type,
                lookupHash: contact.lookupHash,
                encrypted: encryptContact(
                  contact.value,
                  this.config.contactKey,
                ),
                verifiedAt: now,
              },
            });
            await recordAudit(tx, {
              actorKind: accountActor,
              actorUserId: user.id,
              action: "ACCOUNT_CREATED",
              outcome: "ACCEPTED",
              correlationId,
            });
          }
          return createAccountSession(
            tx,
            linked.userId,
            this.config,
            correlationId,
            now,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch {
      throw unavailable();
    }
    if (result.kind === "invalid") {
      if (result.throttled)
        throw new ApiError(
          429,
          "RATE_LIMITED",
          "Verification attempts exceeded",
        );
      throw new ApiError(
        401,
        "INVALID_PROOF",
        "Invalid or expired verification code",
      );
    }
    return result;
  }
}
