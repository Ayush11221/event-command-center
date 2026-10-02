import type { Event } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { accountActor, recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import {
  executeIdempotentCommand,
  type CommandResponse,
} from "./command-safety.js";
import { parsePrivateIssueBody } from "./issue-private-link.js";
import {
  lockManagementEvent,
  validateManagementEventId,
} from "./management-command.js";
import {
  generatePrivateLinkProof,
  privateAccessUrl,
  privateLinkKeys,
  privateLinkVerifier,
  replacePrivateAccessLink,
  revokePrivateAccessLink,
} from "./private-links.js";

export type PrivateLinkOperation = "REISSUE" | "REVOKE";

export function requirePrivateLinkOwner(owner: boolean) {
  if (!owner)
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only the owning Organizer may change a private link",
    );
}
export function requirePrivateLinkMutation(
  event: Pick<Event, "revision" | "state" | "visibility">,
  revision: number,
) {
  if (event.revision !== revision)
    throw new ApiError(409, "VERSION_CONFLICT", "Event data changed", {
      details: { current_revision: event.revision },
    });
  if (event.state !== "PUBLISHED" || event.visibility !== "PRIVATE")
    throw new ApiError(
      422,
      "WRONG_LIFECYCLE_STATE",
      "Private-link changes require a PRIVATE Published event",
    );
}

export async function manageEventPrivateLink(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  revision: number,
  key: string,
  body: unknown,
  operation: PrivateLinkOperation,
  correlationId: string,
) {
  validateManagementEventId(eventId);
  eventId = eventId.toLowerCase();
  try {
    const keys = privateLinkKeys(deps.config.contactKey);
    return await executeIdempotentCommand<Record<string, unknown>>(
      deps.db,
      {
        actorUserId: actor.userId,
        action: `PRIVATE_LINK_${operation}`,
        resourceKey: eventId,
        idempotencyKey: key,
        request: body ?? null,
        ...(operation === "REISSUE"
          ? { protectedResponseKey: keys.replay }
          : {}),
      },
      async (tx) => {
        parsePrivateIssueBody(body);
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
        });
        requirePrivateLinkMutation(event, revision);
        const now = new Date();
        let response: CommandResponse<Record<string, unknown>>;
        let metadata: { link_id: string; previous_link_id?: string };
        const base = {
          event_id: eventId,
          revision: revision + 1,
          as_of: now.toISOString(),
          correlation_id: correlationId,
        };
        if (operation === "REISSUE") {
          const proof = generatePrivateLinkProof();
          const accessUrl = privateAccessUrl(deps.frontendOrigin, proof);
          const links = await replacePrivateAccessLink(tx, {
            eventId,
            verifierHash: privateLinkVerifier(proof, keys.verifier),
            verifierKeyVersion: keys.verifier.version,
            replacedAt: now,
          });
          if (!links)
            throw new ApiError(
              409,
              "LINK_NOT_ACTIVE",
              "No private link is active",
            );
          metadata = {
            link_id: links.replacement.id,
            previous_link_id: links.previous.id,
          };
          response = {
            status: 200,
            body: {
              ...base,
              link_state: "ACTIVE",
              access_url: accessUrl,
              issued_at: links.replacement.issuedAt.toISOString(),
              previous_revoked_at: links.previous.revokedAt!.toISOString(),
            },
          };
        } else {
          const link = await revokePrivateAccessLink(tx, eventId, now);
          if (!link)
            throw new ApiError(
              409,
              "LINK_NOT_ACTIVE",
              "No private link is active",
            );
          metadata = { link_id: link.id };
          response = {
            status: 200,
            body: {
              ...base,
              link_state: "REVOKED",
              revoked_at: link.revokedAt!.toISOString(),
            },
          };
        }
        await tx.event.update({
          where: { id: eventId, revision },
          data: { revision: { increment: 1 } },
        });
        await recordAudit(tx, {
          actorKind: accountActor,
          actorUserId: actor.userId,
          eventId,
          action:
            operation === "REISSUE"
              ? "PRIVATE_LINK_REISSUED"
              : "PRIVATE_LINK_REVOKED",
          outcome: "ACCEPTED",
          correlationId,
          metadata: {
            ...metadata,
            previous_revision: revision,
            revision: revision + 1,
          },
        });
        return response;
      },
      async (tx) => {
        const { owner } = await lockManagementEvent(tx, actor, eventId);
        requirePrivateLinkOwner(owner);
      },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
