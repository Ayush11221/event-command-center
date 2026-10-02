export type EventRelationship = "owned" | "assigned";

export interface ManagementEvent {
  event_id: string;
  name: string;
  state: "DRAFT" | "PUBLISHED" | "LIVE" | "COMPLETED" | "CANCELLED";
  start_at: string | null;
  end_at: string | null;
  time_zone: string | null;
  relationship: EventRelationship;
}

export interface EventListResponse {
  items: ManagementEvent[];
  next_cursor: string | null;
  as_of: string;
  correlation_id: string;
}

export interface DraftResponse {
  event_id: string;
  name: string;
  state: "DRAFT";
  revision: number;
  as_of: string;
  correlation_id: string;
}

export interface ManagementDetail extends Omit<
  ManagementEvent,
  "relationship"
> {
  description: string | null;
  visibility: "PUBLIC" | "PRIVATE" | null;
  public_location: string | null;
  image_url: string | null;
  category: string | null;
  tags: string[];
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  registration_cancellation_cutoff_at: string | null;
  registration_manually_closed: boolean;
  checkout_enabled: boolean;
  gates: { gate_id: string; event_id: string }[];
  readiness: {
    configured_gate_present: boolean;
    publish_blockers: string[];
    live_blockers: string[];
  };
  availability: {
    policy_status: "OPEN" | "CLOSED";
    reasons: ("NOT_OPEN_YET" | "SCHEDULED_CLOSE_REACHED" | "MANUALLY_CLOSED")[];
    opens_at: string | null;
    closes_at: string | null;
    as_of: string;
  };
  permitted_actions: string[];
  revision: number;
  as_of: string;
  correlation_id: string;
}

export function getEventDetail(
  eventId: string,
  signal?: AbortSignal,
): Promise<ManagementDetail> {
  return eventRequest<ManagementDetail>(`/${encodeURIComponent(eventId)}`, {
    signal,
  });
}

export class EventApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly correlationId?: string,
    public readonly details?: Record<string, unknown>,
    public readonly retryable?: boolean,
  ) {
    super(code);
  }
}

async function eventRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: object;
    csrf?: string;
    key?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new EventApiError("NETWORK", 0);
  let response: Response;
  try {
    response = await fetch(new URL(`/api/v1/events${path}`, origin), {
      method: options.method ?? "GET",
      credentials: "include",
      cache: "no-store",
      signal: options.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
        ...(options.key ? { "Idempotency-Key": options.key } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new EventApiError("NETWORK", 0);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new EventApiError("NETWORK", 0);
  }
  if (!response.ok) {
    const error = data as {
      code?: string;
      correlation_id?: string;
      details?: Record<string, unknown>;
      retryable?: boolean;
    };
    throw new EventApiError(
      error.code ?? "UNKNOWN",
      response.status,
      error.correlation_id,
      error.details,
      error.retryable,
    );
  }
  return data as T;
}

export function listEvents(
  view: EventRelationship,
  cursor?: string,
  signal?: AbortSignal,
): Promise<EventListResponse> {
  const query = new URLSearchParams({ view, limit: "100" });
  if (cursor) query.set("cursor", cursor);
  return eventRequest<EventListResponse>(`?${query.toString()}`, { signal });
}

export async function listAllEvents(
  view: EventRelationship,
  signal?: AbortSignal,
): Promise<ManagementEvent[]> {
  const items: ManagementEvent[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await listEvents(view, cursor, signal);
    items.push(...page.items);
    if (!page.next_cursor) return items;
    if (cursors.has(page.next_cursor))
      throw new EventApiError("INVALID_RESPONSE", 0);
    cursors.add(page.next_cursor);
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}

export function createDraft(
  name: string,
  csrf: string,
  key: string,
): Promise<DraftResponse> {
  return eventRequest<DraftResponse>("", {
    method: "POST",
    body: { name },
    csrf,
    key,
  });
}
