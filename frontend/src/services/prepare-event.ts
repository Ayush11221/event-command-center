import {
  createDraft,
  createGate,
  editEvent,
  getEventDetail,
  EventApiError,
  type EventEdit,
} from "./events";

export interface EventCreationAttempt {
  name: string;
  key: string;
  settings: EventEdit;
  gateKey: string;
  eventId?: string;
  revision?: number;
  configured?: boolean;
  gateRevision?: number;
}

// Keep one draft identity and immutable command keys across partial failures.
// Existing APIs still enforce organizer authority, CSRF and revision checks.
export async function prepareEvent(
  attempt: EventCreationAttempt,
  csrf: string,
): Promise<string> {
  if (!attempt.eventId) {
    const draft = await createDraft(attempt.name, csrf, attempt.key);
    attempt.eventId = draft.event_id;
    attempt.revision = draft.revision;
  }
  let detail = await getEventDetail(attempt.eventId);
  if (!attempt.configured) {
    const matches = Object.entries(attempt.settings).every(
      ([key, value]) => detail[key as keyof typeof detail] === value,
    );
    if (!matches) {
      if (detail.revision !== attempt.revision)
        throw new EventApiError("PRECONDITION_FAILED", 412);
      detail = await editEvent(
        attempt.eventId,
        detail.revision,
        attempt.settings,
        csrf,
      );
    }
    attempt.configured = true;
  }
  if (attempt.gateRevision !== undefined || detail.gates.length === 0) {
    attempt.gateRevision ??= detail.revision;
    // Replay the same key AND revision if the gate response was lost.
    await createGate(
      attempt.eventId,
      attempt.gateRevision,
      csrf,
      attempt.gateKey,
    );
  }
  return attempt.eventId;
}
