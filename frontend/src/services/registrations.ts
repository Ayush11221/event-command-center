import { accountFetch } from "./account-session";
import { ProofError, currentActor, currentGuest } from "./proof";

export interface Registration {
  registration_id: string;
  event_id: string;
  state: "REGISTERED" | "CANCELLED";
  relationship: "own" | "managed";
  created_at: string;
  cancelled_at: string | null;
  event_state: string;
  cancellation_cutoff_at: string | null;
}
export interface Credential {
  credential_id: string;
  registration_id: string;
  status: "ACTIVE";
  expires_at: string | null;
  qr_svg: string;
  // Optional while an older API deployment still returns only the QR image.
  entry_code?: string;
}
export async function participantSession() {
  try {
    return { csrf: (await currentActor()).csrf_token, guest: false };
  } catch (error) {
    if (
      !(error instanceof ProofError) ||
      error.status !== 401 ||
      error.code !== "UNAUTHENTICATED"
    )
      throw error;
  }
  return { csrf: (await currentGuest()).csrf_token, guest: true };
}
export async function registrationRequest<T>(
  path: string,
  signal: AbortSignal,
  options?: { csrf: string; key: string },
  proof?: string | null,
): Promise<T> {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new ProofError("NETWORK", 0);
  const controller = new AbortController(),
    abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await accountFetch(new URL(`/api/v1${path}`, origin), {
      method: options ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: {
        ...(options
          ? {
              "Content-Type": "application/json",
              "X-CSRF-Token": options.csrf,
              "Idempotency-Key": options.key,
            }
          : {}),
        ...(proof ? { Authorization: `PrivateLink ${proof}` } : {}),
      },
      body: options ? "{}" : undefined,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = body as { code?: string };
      throw new ProofError(error.code ?? "UNKNOWN", response.status);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError("NETWORK", 0);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
