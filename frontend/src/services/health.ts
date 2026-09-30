export interface HealthResponse {
  status: "alive";
  correlation_id: string;
}

export async function checkHealth(
  signal: AbortSignal,
): Promise<HealthResponse> {
  const configuredOrigin = import.meta.env.VITE_API_ORIGIN;
  if (!configuredOrigin) {
    throw new Error("API origin is not configured");
  }

  let url: URL;
  try {
    url = new URL("/health/live", configuredOrigin);
  } catch {
    throw new Error("API origin is invalid");
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("API liveness request failed");

    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("status" in body) ||
      body.status !== "alive" ||
      !("correlation_id" in body) ||
      typeof body.correlation_id !== "string"
    ) {
      throw new Error("API liveness response is invalid");
    }
    return body as HealthResponse;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}
