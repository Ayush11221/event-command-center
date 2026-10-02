import type { Prisma } from "@prisma/client";
import type { AuthDependencies } from "../auth/http.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { decodePublicCursor, encodePublicCursor } from "../events/cursor.js";
import { parsePaginationQuery } from "../events/validation.js";
import { publicCatalogItem, publicEventDetail } from "./serializers.js";
import {
  privateLinkKeys,
  privateLinkVerifier,
  privateLinkVerifierMatches,
} from "../events/private-links.js";

export const privateUnavailable = () =>
  new ApiError(404, "PRIVATE_UNAVAILABLE", "Private event unavailable");

export function parsePrivateAuthorization(header: string | undefined): string {
  const match = header?.match(/^PrivateLink ([A-Za-z0-9_-]{43})$/);
  if (!match) throw privateUnavailable();
  return match[1]!;
}

export function parsePublicCatalogQuery(query: Record<string, unknown>) {
  if (
    Object.keys(query).some((field) => field !== "cursor" && field !== "limit")
  )
    throw new ApiError(400, "VALIDATION", "Invalid public event list query");
  return parsePaginationQuery(query);
}

const publicScope = { state: "PUBLISHED", visibility: "PUBLIC" } as const;
const publicSelection = {
  id: true,
  name: true,
  startAt: true,
  endAt: true,
  timeZone: true,
  publicLocation: true,
  imageUrl: true,
  category: true,
  tags: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
  registrationManuallyClosed: true,
} satisfies Prisma.EventSelect;

export async function getPrivateEvent(
  deps: AuthDependencies,
  proof: string,
  correlationId: string,
) {
  try {
    const { verifier } = privateLinkKeys(deps.config.contactKey);
    const hash = privateLinkVerifier(proof, verifier);
    const link = await deps.db.privateAccessLink.findFirst({
      where: {
        verifierHash: hash,
        verifierKeyVersion: verifier.version,
        revokedAt: null,
        event: { state: "PUBLISHED", visibility: "PRIVATE" },
      },
      select: {
        verifierHash: true,
        event: { select: { ...publicSelection, description: true } },
      },
    });
    if (
      !link ||
      !privateLinkVerifierMatches(proof, link.verifierHash, verifier)
    )
      throw privateUnavailable();
    return publicEventDetail(link.event, new Date(), correlationId);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}

export async function listPublicEvents(
  deps: AuthDependencies,
  query: ReturnType<typeof parsePublicCatalogQuery>,
  correlationId: string,
) {
  const boundary = query.cursor
    ? decodePublicCursor(query.cursor, deps.config.jwtSecret)
    : undefined;
  try {
    // PostgreSQL DESC places nulls first. Handle legacy synthetic Published rows
    // without changing the contract's PUBLIC + PUBLISHED eligibility predicate.
    const rows = await deps.db.event.findMany({
      where: {
        ...publicScope,
        ...(boundary
          ? {
              OR:
                boundary.published_at === null
                  ? [
                      { publishedAt: null, id: { lt: boundary.event_id } },
                      { publishedAt: { not: null } },
                    ]
                  : [
                      { publishedAt: { lt: new Date(boundary.published_at) } },
                      {
                        publishedAt: new Date(boundary.published_at),
                        id: { lt: boundary.event_id },
                      },
                    ],
            }
          : {}),
      },
      select: { ...publicSelection, publishedAt: true },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit),
      last = page.at(-1),
      now = new Date();
    return {
      items: page.map((event) => publicCatalogItem(event, now)),
      next_cursor:
        rows.length > query.limit && last
          ? encodePublicCursor(
              {
                v: 1,
                view: "PUBLIC",
                published_at: last.publishedAt?.toISOString() ?? null,
                event_id: last.id,
              },
              deps.config.jwtSecret,
            )
          : null,
      as_of: now.toISOString(),
      correlation_id: correlationId,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}

export async function getPublicEvent(
  deps: AuthDependencies,
  eventId: string,
  correlationId: string,
) {
  const notFound = () =>
    new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      eventId,
    )
  )
    throw notFound();
  try {
    const event = await deps.db.event.findFirst({
      where: { id: eventId, ...publicScope },
      select: { ...publicSelection, description: true },
    });
    if (!event) throw notFound();
    return publicEventDetail(event, new Date(), correlationId);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
