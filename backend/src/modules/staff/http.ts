import { Prisma, PrismaClient, StaffRole } from "@prisma/client";
import type { Request } from "express";
import { Router } from "express";
import type { AuthDependencies } from "../auth/http.js";
import { authenticate, requireCsrf } from "../auth/http.js";
import { accountActor, recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { decryptContact, normalizeContact } from "../auth/contact.js";
import { requireGateScope, requireStaffAuthority } from "./policy.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value))
    throw new ApiError(400, "VALIDATION", "Invalid identifier");
  return value.toLowerCase();
}

function body(request: Request) {
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  ) {
    throw new ApiError(400, "VALIDATION", "Invalid request body");
  }
  return request.body as Record<string, unknown>;
}

async function auditDenied(
  db: PrismaClient,
  actorUserId: string,
  eventId: string,
  correlationId: string,
) {
  try {
    await db.auditEvent.create({
      data: {
        actorKind: accountActor,
        actorUserId,
        eventId,
        action: "STAFF_ACTION_DENIED",
        outcome: "DENIED",
        correlationId,
      },
    });
  } catch {
    throw unavailable();
  }
}

function translate(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new ApiError(409, "CONFLICT", "Assignment already active");
  }
  throw unavailable();
}

export function staffRouter(deps: AuthDependencies) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "private, no-store");
    response.set("Referrer-Policy", "no-referrer");
    next();
  });

  // Exact verified-email match, never a directory or prefix search. The contact
  // stays in the POST body and is never copied into logs or audit metadata.
  router.post(
    "/:eventId/assignments/account-lookup",
    async (request, response) => {
      const actor = await authenticate(request, deps);
      requireCsrf(request, actor, deps);
      const eventId = id(request.params.eventId);
      try {
        const account = await deps.db.$transaction(async (tx) => {
          await requireStaffAuthority(tx, actor.userId, eventId, "READ");
          const data = body(request);
          if (
            Object.keys(request.query).length ||
            Object.keys(data).length !== 1 ||
            typeof data.email !== "string"
          )
            throw new ApiError(400, "VALIDATION", "Enter a verified email");
          let contact;
          try {
            contact = normalizeContact(
              "EMAIL",
              data.email,
              deps.config.contactKey,
            );
          } catch {
            throw new ApiError(400, "VALIDATION", "Enter a valid email");
          }
          const found = await tx.verifiedContact.findUnique({
            where: {
              type_lookupHash: {
                type: "EMAIL",
                lookupHash: contact.lookupHash,
              },
            },
            select: { userId: true },
          });
          if (found?.userId === actor.userId)
            throw new ApiError(
              403,
              "SELF_ASSIGNMENT",
              "Self-assignment not permitted",
            );
          await recordAudit(tx, {
            actorKind: accountActor,
            actorUserId: actor.userId,
            eventId,
            action: "STAFF_ACCOUNT_LOOKUP",
            outcome: "ACCEPTED",
            correlationId: response.locals.correlationId as string,
          });
          return found ? { user_id: found.userId, email: contact.value } : null;
        });
        response.json({
          account,
          correlation_id: response.locals.correlationId,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 403)
          await auditDenied(
            deps.db,
            actor.userId,
            eventId,
            response.locals.correlationId as string,
          );
        translate(error);
      }
    },
  );

  router.get("/:eventId/gates/:gateId/scope", async (request, response) => {
    const actor = await authenticate(request, deps);
    const eventId = id(request.params.eventId);
    const gateId = id(request.params.gateId);
    try {
      const labels = await deps.db.$transaction(async (tx) => {
        await requireGateScope(tx, actor.userId, eventId, gateId);
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
          select: { name: true },
        });
        const gates = await tx.gate.findMany({
          where: { eventId },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        return {
          event_name: event.name,
          gate_label: `Gate ${gates.findIndex((gate) => gate.id === gateId) + 1}`,
        };
      });
      response.json({
        event_id: eventId,
        gate_id: gateId,
        authorized: true,
        ...labels,
        correlation_id: response.locals.correlationId,
      });
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status)) {
        await auditDenied(
          deps.db,
          actor.userId,
          eventId,
          response.locals.correlationId as string,
        );
      }
      translate(error);
    }
  });

  router.get("/:eventId/assignments", async (request, response) => {
    const actor = await authenticate(request, deps);
    const eventId = id(request.params.eventId);
    try {
      const rows = await deps.db.$transaction(async (tx) => {
        const authority = await requireStaffAuthority(
          tx,
          actor.userId,
          eventId,
          "READ",
        );
        const assignments = await tx.eventRoleAssignment.findMany({
          where: {
            eventId,
            revokedAt: null,
            ...(authority === "ADMIN"
              ? { role: { not: StaffRole.EVENT_ADMIN } }
              : {}),
          },
          select: {
            id: true,
            userId: true,
            role: true,
            gateId: true,
            grantedAt: true,
            user: {
              select: {
                contacts: {
                  where: { type: "EMAIL" },
                  select: { encrypted: true },
                  take: 1,
                },
              },
            },
          },
          orderBy: [{ grantedAt: "asc" }, { id: "asc" }],
        });
        return {
          assignments: assignments.map(({ user, ...assignment }) => ({
            ...assignment,
            email: user.contacts[0]
              ? decryptContact(
                  user.contacts[0].encrypted,
                  deps.config.contactKey,
                )
              : null,
          })),
          allowed_roles:
            authority === "OWNER"
              ? [
                  StaffRole.EVENT_ADMIN,
                  StaffRole.GATE_SECURITY,
                  StaffRole.VOLUNTEER,
                ]
              : [StaffRole.GATE_SECURITY, StaffRole.VOLUNTEER],
        };
      });
      response.json({
        ...rows,
        correlation_id: response.locals.correlationId,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        await auditDenied(
          deps.db,
          actor.userId,
          eventId,
          response.locals.correlationId as string,
        );
      }
      translate(error);
    }
  });

  router.post("/:eventId/assignments", async (request, response) => {
    const actor = await authenticate(request, deps);
    requireCsrf(request, actor, deps);
    const eventId = id(request.params.eventId);
    const data = body(request);
    const targetUserId = id(data.user_id);
    if (!Object.values(StaffRole).includes(data.role as StaffRole))
      throw new ApiError(400, "VALIDATION", "Invalid role");
    const role = data.role as StaffRole;
    const gateId = role === StaffRole.GATE_SECURITY ? id(data.gate_id) : null;
    if (role !== StaffRole.GATE_SECURITY && data.gate_id != null)
      throw new ApiError(400, "VALIDATION", "Gate scope not applicable");
    try {
      const assignment = await deps.db.$transaction(
        async (tx) => {
          await requireStaffAuthority(tx, actor.userId, eventId, "GRANT", role);
          if (targetUserId === actor.userId)
            throw new ApiError(
              403,
              "FORBIDDEN",
              "Self-assignment not permitted",
            );
          const target = await tx.user.findUnique({
            where: { id: targetUserId },
            select: { id: true },
          });
          if (!target)
            throw new ApiError(404, "NOT_FOUND", "Target user not found");
          const verifiedContact = await tx.verifiedContact.findFirst({
            where: { userId: targetUserId },
            select: { id: true },
          });
          if (!verifiedContact)
            throw new ApiError(404, "NOT_FOUND", "Target user not found");
          if (gateId) {
            const gate = await tx.gate.findUnique({
              where: { eventId_id: { eventId, id: gateId } },
              select: { id: true },
            });
            if (!gate)
              throw new ApiError(
                400,
                "VALIDATION",
                "Gate does not belong to event",
              );
          }
          const created = await tx.eventRoleAssignment.create({
            data: {
              eventId,
              userId: targetUserId,
              role,
              gateId,
              scopeKey: gateId ?? "EVENT",
              grantedByUserId: actor.userId,
            },
          });
          await recordAudit(tx, {
            actorKind: accountActor,
            actorUserId: actor.userId,
            eventId,
            targetUserId,
            action: "STAFF_GRANTED",
            outcome: "ACCEPTED",
            correlationId: response.locals.correlationId as string,
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      response.status(201).json({
        id: assignment.id,
        correlation_id: response.locals.correlationId,
      });
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status)) {
        await auditDenied(
          deps.db,
          actor.userId,
          eventId,
          response.locals.correlationId as string,
        );
      }
      translate(error);
    }
  });

  router.delete(
    "/:eventId/assignments/:assignmentId",
    async (request, response) => {
      const actor = await authenticate(request, deps);
      requireCsrf(request, actor, deps);
      const eventId = id(request.params.eventId);
      const assignmentId = id(request.params.assignmentId);
      try {
        await deps.db.$transaction(
          async (tx) => {
            await requireStaffAuthority(tx, actor.userId, eventId, "READ");
            const assignment = await tx.eventRoleAssignment.findUnique({
              where: { id: assignmentId },
            });
            if (
              !assignment ||
              assignment.eventId !== eventId ||
              assignment.revokedAt
            ) {
              throw new ApiError(404, "NOT_FOUND", "Assignment not found");
            }
            await requireStaffAuthority(
              tx,
              actor.userId,
              eventId,
              "REVOKE",
              assignment.role,
            );
            const result = await tx.eventRoleAssignment.updateMany({
              where: { id: assignmentId, revokedAt: null },
              data: { revokedAt: new Date(), revokedByUserId: actor.userId },
            });
            if (result.count !== 1)
              throw new ApiError(
                409,
                "CONFLICT",
                "Assignment no longer active",
              );
            await recordAudit(tx, {
              actorKind: accountActor,
              actorUserId: actor.userId,
              eventId,
              targetUserId: assignment.userId,
              action: "STAFF_REVOKED",
              outcome: "ACCEPTED",
              correlationId: response.locals.correlationId as string,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
        response.json({
          status: "revoked",
          correlation_id: response.locals.correlationId,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          await auditDenied(
            deps.db,
            actor.userId,
            eventId,
            response.locals.correlationId as string,
          );
        }
        translate(error);
      }
    },
  );
  return router;
}
