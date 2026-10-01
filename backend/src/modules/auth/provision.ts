import { randomUUID } from "node:crypto";
import { ContactType, PrismaClient } from "@prisma/client";
import type { FoundationConfig } from "../../config/foundation.js";
import { recordAudit, systemActor } from "./audit.js";
import { encryptContact, normalizeContact } from "./contact.js";

export async function provisionAccount(
  db: PrismaClient,
  config: FoundationConfig,
  type: ContactType,
  rawContact: string,
  organizerCapable: boolean,
  correlationId: string,
): Promise<string> {
  const contact = normalizeContact(type, rawContact, config.contactKey);
  const userId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.user.create({
      data: { id: userId, organizerCapable },
    });
    await tx.verifiedContact.create({
      data: {
        userId,
        type,
        lookupHash: contact.lookupHash,
        encrypted: encryptContact(contact.value, config.contactKey),
        verifiedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorKind: systemActor,
      targetUserId: userId,
      action: "ACCOUNT_PROVISIONED",
      outcome: "ACCEPTED",
      correlationId,
    });
  });
  return userId;
}

export async function setOrganizerCapability(
  db: PrismaClient,
  userId: string,
  enabled: boolean,
  correlationId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { organizerCapable: enabled },
    });
    await recordAudit(tx, {
      actorKind: systemActor,
      targetUserId: userId,
      action: enabled
        ? "ORGANIZER_CAPABILITY_GRANTED"
        : "ORGANIZER_CAPABILITY_REMOVED",
      outcome: "ACCEPTED",
      correlationId,
    });
  });
}
