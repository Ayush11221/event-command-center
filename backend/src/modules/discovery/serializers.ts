import type { Event } from "@prisma/client";
import { managementAvailability } from "../events/availability.js";

export type PublicCatalogEvent = Pick<
  Event,
  | "id"
  | "name"
  | "state"
  | "startAt"
  | "endAt"
  | "timeZone"
  | "publicLocation"
  | "imageUrl"
  | "category"
  | "tags"
  | "registrationOpensAt"
  | "registrationClosesAt"
  | "registrationManuallyClosed"
>;

// Explicit public allowlist; never spread an Event or reuse management detail.
export function publicCatalogItem(event: PublicCatalogEvent, asOf: Date) {
  return {
    event_id: event.id,
    name: event.name,
    event_state: event.state,
    start_at: event.startAt?.toISOString() ?? null,
    end_at: event.endAt?.toISOString() ?? null,
    time_zone: event.timeZone,
    public_location: event.publicLocation,
    image_url: event.imageUrl,
    category: event.category,
    tags: event.tags,
    availability: managementAvailability(event, asOf),
  };
}

export function publicEventDetail(
  event: PublicCatalogEvent & Pick<Event, "description">,
  asOf: Date,
  correlationId: string,
) {
  return {
    ...publicCatalogItem(event, asOf),
    description: event.description,
    as_of: asOf.toISOString(),
    correlation_id: correlationId,
  };
}
