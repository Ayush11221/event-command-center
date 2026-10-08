import { accountFetch } from "./account-session";
import { ProofError } from "./proof";

export type StaffRole = "EVENT_ADMIN" | "GATE_SECURITY" | "VOLUNTEER";
export const staffRoleLabels: Record<StaffRole, string> = {
  EVENT_ADMIN: "Event Admin",
  GATE_SECURITY: "Gate / Security",
  VOLUNTEER: "Volunteer",
};
export interface StaffAccount {
  user_id: string;
  email: string;
}
export interface StaffAssignment {
  id: string;
  userId: string;
  role: StaffRole;
  gateId: string | null;
  grantedAt: string;
  email: string | null;
}
export interface StaffList {
  assignments: StaffAssignment[];
  allowed_roles: StaffRole[];
}
export interface StaffGrant {
  user_id: string;
  role: StaffRole;
  gate_id?: string;
}

async function request(
  eventId: string,
  suffix: string,
  signal: AbortSignal,
  method = "GET",
  csrf?: string,
  body?: object,
): Promise<unknown> {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new ProofError("NETWORK", 0);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const response = await accountFetch(
      new URL(
        `/api/v1/events/${encodeURIComponent(eventId)}/assignments${suffix}`,
        origin,
      ),
      {
        method,
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new ProofError(data?.code ?? "UNKNOWN", response.status);
    return data;
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError("NETWORK", 0);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
function invalid(): never {
  throw new ProofError("INVALID_RESPONSE", 0);
}
function role(value: unknown): value is StaffRole {
  return typeof value === "string" && Object.hasOwn(staffRoleLabels, value);
}

export async function listStaff(
  eventId: string,
  signal: AbortSignal,
): Promise<StaffList> {
  const data = (await request(eventId, "", signal)) as StaffList;
  if (
    !Array.isArray(data?.assignments) ||
    !Array.isArray(data.allowed_roles) ||
    !data.allowed_roles.every(role)
  )
    invalid();
  return {
    allowed_roles: data.allowed_roles,
    assignments: data.assignments.map((row) => {
      if (
        !row ||
        typeof row.id !== "string" ||
        typeof row.userId !== "string" ||
        !role(row.role) ||
        !(row.gateId === null || typeof row.gateId === "string") ||
        typeof row.grantedAt !== "string" ||
        !Number.isFinite(Date.parse(row.grantedAt)) ||
        !(row.email === null || typeof row.email === "string") ||
        (row.role === "GATE_SECURITY" ? !row.gateId : row.gateId !== null)
      )
        invalid();
      return {
        id: row.id,
        userId: row.userId,
        role: row.role,
        gateId: row.gateId,
        grantedAt: row.grantedAt,
        email: row.email,
      };
    }),
  };
}
export async function lookupStaffAccount(
  eventId: string,
  email: string,
  csrf: string,
  signal: AbortSignal,
): Promise<StaffAccount | null> {
  const data = (await request(
    eventId,
    "/account-lookup",
    signal,
    "POST",
    csrf,
    { email },
  )) as { account: StaffAccount | null };
  if (data?.account === null) return null;
  if (
    typeof data?.account?.user_id !== "string" ||
    typeof data.account.email !== "string"
  )
    invalid();
  return { user_id: data.account.user_id, email: data.account.email };
}
export async function grantStaff(
  eventId: string,
  grant: StaffGrant,
  csrf: string,
  signal: AbortSignal,
): Promise<void> {
  const data = (await request(eventId, "", signal, "POST", csrf, grant)) as {
    id: string;
  };
  if (typeof data?.id !== "string") invalid();
}
export async function revokeStaff(
  eventId: string,
  assignmentId: string,
  csrf: string,
  signal: AbortSignal,
): Promise<void> {
  const data = (await request(
    eventId,
    `/${encodeURIComponent(assignmentId)}`,
    signal,
    "DELETE",
    csrf,
  )) as { status: string };
  if (data?.status !== "revoked") invalid();
}
