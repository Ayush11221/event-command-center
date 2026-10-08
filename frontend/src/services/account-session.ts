export type AccountSessionEvent =
  "renewed" | "expired" | "unavailable" | "signed-out";
const listeners = new Set<(event: AccountSessionEvent) => void>();
let renewal: Promise<Response> | null = null;
let channel: BroadcastChannel | null = null;
let knownAccount = false;

function announce(event: AccountSessionEvent, broadcast = true) {
  if (event === "renewed") knownAccount = true;
  if (event === "expired" || event === "signed-out") knownAccount = false;
  listeners.forEach((listener) => listener(event));
  if (broadcast) channel?.postMessage(event);
}

function connectChannel() {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("eoc.account-session.v1");
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (["renewed", "expired", "signed-out"].includes(String(data)))
        announce(data as AccountSessionEvent, false);
    };
  }
}

export function subscribeAccountSession(
  listener: (event: AccountSessionEvent) => void,
) {
  connectChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function accountSignedOut() {
  announce("signed-out");
}
export function accountAuthenticated() {
  knownAccount = true;
  connectChannel();
}

async function code(response: Response): Promise<string | undefined> {
  // Production fetch responses always support clone. Some existing transport
  // fixtures only implement json; leave those fixtures to their domain parser.
  if (typeof response.clone !== "function") return undefined;
  return (
    (await response
      .clone()
      .json()
      .catch(() => ({}))) as { code?: string }
  ).code;
}

function authUrl(path: string) {
  return new URL(`/api/v1/auth${path}`, import.meta.env.VITE_API_ORIGIN);
}

async function renew(): Promise<Response> {
  const signal = AbortSignal.timeout(12_000);
  const options: RequestInit = {
    credentials: "include",
    cache: "no-store",
    signal,
  };
  // Recheck inside the cross-tab lock: a preceding tab may have renewed the
  // shared HttpOnly cookies while this tab was waiting. No credential is shared
  // through JS, browser storage, or BroadcastChannel.
  const current = await fetch(authUrl("/me"), options);
  if (current.ok || current.status !== 401) return current;
  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await fetch(authUrl("/account/session"), options);
    if (
      session.status === 409 &&
      (await code(session)) === "RENEWAL_CONFLICT"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    if (!session.ok) return session;
    const body = (await session.json()) as { csrf_token?: string };
    if (typeof body.csrf_token !== "string")
      throw new Error("Session unavailable");
    const refreshed = await fetch(authUrl("/account/refresh"), {
      ...options,
      method: "POST",
      headers: { "X-CSRF-Token": body.csrf_token },
    });
    if (
      refreshed.status !== 409 ||
      (await code(refreshed)) !== "RENEWAL_CONFLICT"
    )
      return refreshed;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return Response.json({ code: "DEPENDENCY_UNAVAILABLE" }, { status: 503 });
}

async function coordinatedRenewal() {
  if (!renewal) {
    connectChannel();
    const locks =
      typeof navigator !== "undefined" ? navigator.locks : undefined;
    renewal = (
      locks
        ? locks.request(
            "eoc.account-renewal.v1",
            { signal: AbortSignal.timeout(15_000) },
            renew,
          )
        : renew()
    )
      .then(async (result) => {
        const response = await result;
        if (response.ok) announce("renewed");
        else if (response.status === 401) {
          if (knownAccount || (await code(response)) === "SESSION_EXPIRED")
            announce("expired");
        } else announce("unavailable", false);
        return response;
      })
      .catch(() => {
        announce("unavailable", false);
        return Response.json(
          { code: "DEPENDENCY_UNAVAILABLE" },
          { status: 503 },
        );
      })
      .finally(() => {
        renewal = null;
      });
  }
  return renewal;
}

export async function accountFetch(
  url: URL,
  options: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, options);
  if (response.ok && url.pathname === "/api/v1/auth/me") accountAuthenticated();
  if (response.status !== 401 || (await code(response)) !== "UNAUTHENTICATED")
    return response;
  const refreshed = await coordinatedRenewal();
  if (!refreshed.ok) return refreshed.clone();
  options.signal?.throwIfAborted();
  const method = (options.method ?? "GET").toUpperCase();
  const key = new Headers(options.headers).get("Idempotency-Key");
  // Only a definitive authentication rejection is recoverable, never a timeout
  // or unknown outcome. Mutation replay keeps the exact original body/key/CSRF.
  if (method === "GET" || method === "HEAD" || key) return fetch(url, options);
  return Response.json(
    {
      code: "AUTH_RENEWED_RETRY_REQUIRED",
      message: "Your session was renewed. Review and retry your action.",
    },
    { status: 409 },
  );
}
