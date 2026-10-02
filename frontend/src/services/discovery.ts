import type { ManagementDetail } from "./events";

export interface PublicEventItem {
  event_id: string;
  name: string;
  start_at: string | null;
  end_at: string | null;
  time_zone: string | null;
  public_location: string | null;
  image_url: string | null;
  category: string | null;
  tags: string[];
  availability: ManagementDetail["availability"];
}
export interface PublicCatalogResponse {
  items: PublicEventItem[];
  next_cursor: string | null;
  as_of: string;
  correlation_id: string;
}
export interface PublicDetail extends PublicEventItem {
  description: string | null;
  as_of: string;
  correlation_id: string;
}
export class DiscoveryApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly correlationId?: string,
  ) {
    super(code);
  }
}

async function publicRequest<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new DiscoveryApiError("NETWORK", 0);
  const controller = new AbortController(),
    abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(new URL(`/api/v1/discovery${path}`, origin), {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = body as { code?: string; correlation_id?: string };
      throw new DiscoveryApiError(
        error.code ?? "UNKNOWN",
        response.status,
        error.correlation_id,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof DiscoveryApiError) throw error;
    throw new DiscoveryApiError("NETWORK", 0);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function getPublicCatalog(
  cursor?: string,
  signal?: AbortSignal,
): Promise<PublicCatalogResponse> {
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  return publicRequest(`/events${query.size ? `?${query}` : ""}`, signal);
}
export function getPublicDetail(
  eventId: string,
  signal?: AbortSignal,
): Promise<PublicDetail> {
  return publicRequest(`/events/${encodeURIComponent(eventId)}`, signal);
}
