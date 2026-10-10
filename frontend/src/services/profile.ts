import { accountFetch } from "./account-session";
import { ProofError } from "./proof";
export interface AccountProfile {
  display_name: string | null;
  verified_email: string | null;
  phone_number: string | null;
  organization: string | null;
  affiliation_id: string | null;
}
export interface ProfileDetails {
  display_name: string;
  phone_number: string;
  organization: string;
  affiliation_id: string | null;
}
async function request(
  signal: AbortSignal,
  details?: ProfileDetails,
  csrf?: string,
) {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new ProofError("NETWORK", 0);
  try {
    const response = await accountFetch(
      new URL("/api/v1/auth/account/profile", origin),
      {
        method: details === undefined ? "GET" : "POST",
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal,
        headers:
          details === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf ?? "",
              },
        body: details === undefined ? undefined : JSON.stringify(details),
      },
    );
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new ProofError(
        typeof body.code === "string" ? body.code : "UNKNOWN",
        response.status,
      );
    if (
      !(body.display_name === null || typeof body.display_name === "string") ||
      (details === undefined &&
        !(
          body.verified_email === null ||
          typeof body.verified_email === "string"
        )) ||
      !["phone_number", "organization", "affiliation_id"].every(
        (key) => body[key] === null || typeof body[key] === "string",
      )
    )
      throw new ProofError("INVALID_RESPONSE", 0);
    return body;
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError("NETWORK", 0);
  }
}
export async function accountProfile(
  signal: AbortSignal,
): Promise<AccountProfile> {
  const body = await request(signal);
  return {
    display_name: body.display_name as string | null,
    verified_email: body.verified_email as string | null,
    phone_number: body.phone_number as string | null,
    organization: body.organization as string | null,
    affiliation_id: body.affiliation_id as string | null,
  };
}
export async function saveAccountProfile(
  details: ProfileDetails,
  csrf: string,
  signal: AbortSignal,
) {
  await request(signal, details, csrf);
}
