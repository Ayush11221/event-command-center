import type { Prisma } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { ApiError } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import { executeIdempotentCommand } from "../events/command-safety.js";
import { lockCommandActor } from "../events/management-command.js";
import { lockEventForCommand } from "../events/private-links.js";
import { credentialVerifier } from "../registrations/credential.js";
import { scanFingerprint, type ScanInput } from "./input.js";

export type ScanReason =
  | "ACCEPTED"
  | "INVALID_CREDENTIAL"
  | "EXPIRED_CREDENTIAL"
  | "CANCELLED_CREDENTIAL"
  | "ALREADY_CHECKED_IN"
  | "CHECKOUT_DISABLED"
  | "NOT_CHECKED_IN"
  | "ALREADY_CHECKED_OUT"
  | "REGISTRATION_UNAVAILABLE";

async function lockScanner(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  input: ScanInput,
) {
  // Event -> session -> user -> assignment, matching the existing command lock order.
  await lockEventForCommand(tx, input.event_id);
  await lockCommandActor(tx, actor);
  const assignments = await tx.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "EventRoleAssignment" a
    JOIN "Gate" g ON g.id = a."gateId" AND g."eventId" = a."eventId"
    WHERE a."userId" = ${actor.userId}::uuid AND a."eventId" = ${input.event_id}::uuid
      AND a."gateId" = ${input.gate_id}::uuid AND a.role = 'GATE_SECURITY' AND a."revokedAt" IS NULL
    FOR SHARE OF a, g
  `;
  if (!assignments.length)
    throw new ApiError(
      403,
      "UNAUTHORIZED_GATE",
      "Scanner access is not permitted for this gate",
    );
}

export async function checkIn(
  deps: AuthDependencies,
  actor: AuthContext,
  input: ScanInput,
  correlationId: string,
) {
  const direction = input.direction ?? "CHECK_IN";
  return executeIdempotentCommand(
    deps.db,
    {
      actorUserId: actor.userId,
      // Keep the legacy logical-scan namespace: changing direction with the
      // same scan_id must conflict, including keys issued before this migration.
      action: "SCAN_CHECK_IN",
      resourceKey: `gate:${input.gate_id}`,
      idempotencyKey: input.scan_id,
      request: scanFingerprint(input, deps.config.contactKey),
    },
    async (tx) => {
      if (
        await tx.scanDecision.findUnique({
          where: {
            operatorUserId_gateId_scanId: {
              operatorUserId: actor.userId,
              gateId: input.gate_id,
              scanId: input.scan_id,
            },
          },
        })
      )
        throw new ApiError(
          410,
          "SCAN_REPLAY_EXPIRED",
          "Scan replay is no longer available; hold entry and use a new scan ID",
        );
      const event = await tx.event.findUniqueOrThrow({
        where: { id: input.event_id },
        select: { state: true, checkoutEnabled: true },
      });
      let hash: string | undefined;
      try {
        hash = credentialVerifier(input.credential, deps.config.contactKey);
      } catch {
        /* Invalid opaque proofs are rejected. */
      }
      // Unknown and wrong-event proofs have identical results. No cross-event lookup.
      const credential = hash
        ? await tx.qRCredential.findFirst({
            where: {
              verifierHash: hash,
              keyVersion: 1,
              registration: { eventId: input.event_id },
            },
            include: { registration: true },
          })
        : null;
      const now = new Date();
      const registration = credential?.registration;
      const previous = registration
        ? await tx.attendanceTransition.findFirst({
            where: { registrationId: registration.id },
            orderBy: { sequence: "desc" },
            select: { kind: true },
          })
        : null;
      const attendance =
        previous?.kind === "CHECK_OUT"
          ? "LEFT"
          : registration?.firstAcceptedCheckInAt
            ? "INSIDE"
            : "NOT_ARRIVED";
      const reason: ScanReason = !credential
        ? "INVALID_CREDENTIAL"
        : credential.revokedAt || registration?.state === "CANCELLED"
          ? "CANCELLED_CREDENTIAL"
          : credential.expiresAt && credential.expiresAt <= now
            ? "EXPIRED_CREDENTIAL"
            : event.state !== "LIVE" || registration?.state !== "REGISTERED"
              ? "REGISTRATION_UNAVAILABLE"
              : direction === "CHECK_OUT"
                ? !event.checkoutEnabled
                  ? "CHECKOUT_DISABLED"
                  : attendance === "NOT_ARRIVED"
                    ? "NOT_CHECKED_IN"
                    : attendance === "LEFT"
                      ? "ALREADY_CHECKED_OUT"
                      : "ACCEPTED"
                : attendance === "INSIDE"
                  ? "ALREADY_CHECKED_IN"
                  : attendance === "LEFT" && !event.checkoutEnabled
                    ? "CHECKOUT_DISABLED"
                    : "ACCEPTED";
      const decision = reason === "ACCEPTED" ? "ACCEPTED" : "REJECTED";
      const scan = await tx.scanDecision.create({
        data: {
          scanId: input.scan_id,
          eventId: input.event_id,
          gateId: input.gate_id,
          operatorUserId: actor.userId,
          registrationId: registration?.id,
          credentialId: credential?.id,
          decision,
          direction,
          reason,
          decidedAt: now,
          correlationId,
        },
      });
      if (decision === "ACCEPTED")
        await tx.attendanceTransition.create({
          data: {
            eventId: input.event_id,
            gateId: input.gate_id,
            operatorUserId: actor.userId,
            registrationId: registration!.id,
            scanDecisionId: scan.id,
            kind: direction,
            acceptedAt: now,
          },
        });
      await recordAudit(tx, {
        actorKind: "ACCOUNT",
        actorUserId: actor.userId,
        eventId: input.event_id,
        action: direction === "CHECK_OUT" ? "SCAN_CHECK_OUT" : "SCAN_CHECK_IN",
        outcome: decision,
        correlationId,
        metadata: {
          scan_id: input.scan_id,
          gate_id: input.gate_id,
          scan_decision_id: scan.id,
          reason,
        },
      });
      return {
        status: 200,
        body: {
          scan_id: input.scan_id,
          event_id: input.event_id,
          gate_id: input.gate_id,
          decision,
          reason,
          decided_at: now.toISOString(),
          registration_status: registration?.state ?? null,
          attendance_status: registration
            ? decision === "ACCEPTED"
              ? direction === "CHECK_OUT"
                ? "LEFT"
                : "INSIDE"
              : attendance
            : null,
        },
      };
    },
    (tx) => lockScanner(tx, actor, input),
  );
}
