type Channel = "EMAIL" | "PHONE";
type Mode = "account" | "guest";

export interface ActorState {
  user_id: string;
  organizer_capable: boolean;
  assignments: {
    id: string;
    event_id: string;
    role: string;
    gate_id: string | null;
  }[];
  csrf_token: string;
}

export class ProofError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

async function api(
  path: string,
  method: "GET" | "POST",
  body?: object,
  csrf?: string,
) {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new ProofError("NETWORK", 0);
  let response: Response;
  try {
    response = await fetch(new URL(`/api/v1/auth${path}`, origin), {
      method,
      credentials: "include",
      cache: "no-store",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ProofError("NETWORK", 0);
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      code?: string;
    };
    throw new ProofError(error.code ?? "UNKNOWN", response.status);
  }
  return response.json() as Promise<unknown>;
}

export async function challenge(mode: Mode, type: Channel, contact: string) {
  await api(`/${mode}/challenge`, "POST", { type, contact });
}

export async function verify(
  mode: Mode,
  type: Channel,
  contact: string,
  code: string,
) {
  await api(`/${mode}/verify`, "POST", { type, contact, code });
}

export async function currentActor(): Promise<ActorState> {
  return api("/me", "GET") as Promise<ActorState>;
}

export async function currentGuest(): Promise<{ status: string }> {
  return api("/guest/self", "GET") as Promise<{ status: string }>;
}

export async function logout(csrf: string) {
  await api("/logout", "POST", undefined, csrf);
}
