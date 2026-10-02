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
    method?: "GET" | "POST" | "PATCH";
    body?: object;
    csrf?: string;
    key?: string;
    revision?: number;
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
        ...(options.revision !== undefined
          ? { "If-Match": `"${options.revision}"` }
          : {}),
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

export type EventEdit = Partial<
  Pick<
    ManagementDetail,
    | "name"
    | "description"
    | "public_location"
    | "image_url"
    | "category"
    | "tags"
    | "start_at"
    | "end_at"
    | "time_zone"
    | "visibility"
    | "registration_capacity"
    | "registration_opens_at"
    | "registration_closes_at"
    | "registration_cancellation_cutoff_at"
    | "registration_manually_closed"
    | "checkout_enabled"
  >
>;

export async function editEvent(
  eventId: string,
  revision: number,
  body: EventEdit,
  csrf: string,
  signal?: AbortSignal,
): Promise<ManagementDetail> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    return await eventRequest<ManagementDetail>(
      `/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        body,
        revision,
        csrf,
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
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

export interface GateResponse {
  gate_id: string;
  event_id: string;
  readiness: ManagementDetail["readiness"];
  revision: number;
  as_of: string;
  correlation_id: string;
}

export async function createGate(
  eventId: string,
  revision: number,
  csrf: string,
  key: string,
  signal?: AbortSignal,
): Promise<GateResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    return await eventRequest<GateResponse>(
      `/${encodeURIComponent(eventId)}/gates`,
      {
        method: "POST",
        body: {},
        csrf,
        key,
        revision,
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
