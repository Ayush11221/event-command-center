import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { accountActor, recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { executeIdempotentCommand } from "./command-safety.js";
import {
  lockManagementEvent,
  validateManagementEventId,
} from "./management-command.js";
import {
  generatePrivateLinkProof,
  issuePrivateAccessLink,
  privateAccessUrl,
  privateLinkKeys,
  privateLinkVerifier,
} from "./private-links.js";

export function parsePrivateIssueBody(body: unknown): Record<string, never> {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length
  )
    throw new ApiError(
      400,
      "VALIDATION",
      "Private-link issuance requires an empty object",
    );
  return {};
}

export async function issueEventPrivateLink(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  revision: number,
  key: string,
  body: unknown,
  correlationId: string,
) {
  validateManagementEventId(eventId);
  eventId = eventId.toLowerCase();
  try {
    const keys = privateLinkKeys(deps.config.contactKey);
    return await executeIdempotentCommand(
      deps.db,
      {
        actorUserId: actor.userId,
        action: "PRIVATE_LINK_ISSUE",
        resourceKey: eventId,
        idempotencyKey: key,
        request: body ?? null,
        protectedResponseKey: keys.replay,
      },
      async (tx) => {
        parsePrivateIssueBody(body);
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
        });
        if (event.revision !== revision)
          throw new ApiError(409, "VERSION_CONFLICT", "Event data changed", {
            details: { current_revision: event.revision },
          });
        if (event.state !== "PUBLISHED" || event.visibility !== "PRIVATE")
          throw new ApiError(
            422,
            "WRONG_LIFECYCLE_STATE",
            "Private-link issuance requires a PRIVATE Published event",
          );
        if (
          await tx.privateAccessLink.findFirst({
            where: { eventId, revokedAt: null },
            select: { id: true },
          })
        )
          throw new ApiError(
            409,
            "LINK_ALREADY_ACTIVE",
            "A private link is already active",
          );
        const proof = generatePrivateLinkProof(),
          now = new Date();
        const accessUrl = privateAccessUrl(deps.frontendOrigin, proof);
        const link = await issuePrivateAccessLink(tx, {
          eventId,
          verifierHash: privateLinkVerifier(proof, keys.verifier),
          verifierKeyVersion: keys.verifier.version,
          issuedAt: now,
        });
        const updated = await tx.event.update({
          where: { id: eventId, revision },
          data: { revision: { increment: 1 } },
        });
        await recordAudit(tx, {
          actorKind: accountActor,
          actorUserId: actor.userId,
          eventId,
          action: "PRIVATE_LINK_ISSUED",
          outcome: "ACCEPTED",
          correlationId,
          metadata: {
            link_id: link.id,
            previous_revision: revision,
            revision: updated.revision,
          },
        });
        return {
          status: 201,
          body: {
            event_id: eventId,
            link_state: "ACTIVE",
            access_url: accessUrl,
            issued_at: now.toISOString(),
            revision: updated.revision,
            as_of: now.toISOString(),
            correlation_id: correlationId,
          },
        };
      },
      async (tx) => {
        const { owner } = await lockManagementEvent(tx, actor, eventId);
        if (!owner)
          throw new ApiError(
            403,
            "FORBIDDEN",
            "Only the owning Organizer may issue a private link",
          );
      },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
