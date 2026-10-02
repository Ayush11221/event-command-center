import { AuditActorKind, type Prisma } from "@prisma/client";

export interface AuditInput {
  actorKind: AuditActorKind;
  actorUserId?: string;
  eventId?: string;
  targetUserId?: string;
  action: string;
  outcome: string;
  correlationId: string;
  metadata?: Prisma.InputJsonValue;
}

export async function recordAudit(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorKind: input.actorKind,
      actorUserId: input.actorUserId,
      eventId: input.eventId,
      targetUserId: input.targetUserId,
      action: input.action,
      outcome: input.outcome,
      correlationId: input.correlationId,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
}

export const systemActor = AuditActorKind.SYSTEM;
export const accountActor = AuditActorKind.ACCOUNT;
export const guestActor = AuditActorKind.GUEST;
