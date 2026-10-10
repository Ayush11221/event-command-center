import type { AuthContext, AuthDependencies } from "./http.js";
import { ApiError } from "./errors.js";
import { decryptContact } from "./contact.js";
import { recordAudit } from "./audit.js";

export interface ProfileDetails {
  display_name: string;
  phone_number: string;
  organization: string;
  affiliation_id: string | null;
}
export function profileInput(body: unknown): ProfileDetails {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApiError(400, "VALIDATION", "Invalid profile");
  const row = body as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) =>
        ![
          "display_name",
          "phone_number",
          "organization",
          "affiliation_id",
        ].includes(key),
    ) ||
    typeof row.display_name !== "string" ||
    typeof row.phone_number !== "string" ||
    typeof row.organization !== "string" ||
    !(
      row.affiliation_id === undefined ||
      row.affiliation_id === null ||
      typeof row.affiliation_id === "string"
    )
  )
    throw new ApiError(400, "VALIDATION", "Invalid profile");
  const name = row.display_name.trim();
  const organization = row.organization.trim();
  const affiliation =
    typeof row.affiliation_id === "string"
      ? row.affiliation_id.trim() || null
      : null;
  const phone = row.phone_number.trim().replace(/[ ()-]/g, "");
  if (
    !name ||
    name.length > 100 ||
    !organization ||
    organization.length > 120 ||
    (affiliation && affiliation.length > 64) ||
    !/^\+?\d{7,15}$/.test(phone) ||
    /[\p{Cc}\p{Cf}]/u.test(name + organization + (affiliation ?? ""))
  )
    throw new ApiError(400, "VALIDATION", "Invalid profile details");
  return {
    display_name: name,
    phone_number: phone,
    organization,
    affiliation_id: affiliation,
  };
}

export async function readProfile(deps: AuthDependencies, actor: AuthContext) {
  const user = await deps.db.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: {
      displayName: true,
      profilePhone: true,
      organization: true,
      affiliationId: true,
      contacts: {
        where: { type: "EMAIL" },
        select: { encrypted: true },
        take: 1,
      },
    },
  });
  return {
    display_name: user.displayName,
    phone_number: user.profilePhone,
    organization: user.organization,
    affiliation_id: user.affiliationId,
    verified_email: user.contacts[0]
      ? decryptContact(user.contacts[0].encrypted, deps.config.contactKey)
      : null,
  };
}

export async function saveProfile(
  deps: AuthDependencies,
  actor: AuthContext,
  details: ProfileDetails,
  correlationId: string,
) {
  await deps.db.$transaction(async (tx) => {
    // Hold session authority through commit. User UPDATE supplies its own row lock,
    // avoiding shared-to-exclusive lock upgrades across concurrent profile saves.
    const sessions = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Session" WHERE id = ${actor.sessionId}::uuid AND "userId" = ${actor.userId}::uuid
      AND "revokedAt" IS NULL AND "expiresAt" > statement_timestamp()
      AND ("absoluteExpiresAt" IS NULL OR "absoluteExpiresAt" > statement_timestamp()) FOR SHARE
    `;
    if (!sessions.length)
      throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
    await tx.user.update({
      where: { id: actor.userId },
      data: {
        displayName: details.display_name,
        profilePhone: details.phone_number,
        organization: details.organization,
        affiliationId: details.affiliation_id,
      },
    });
    await recordAudit(tx, {
      actorKind: "ACCOUNT",
      actorUserId: actor.userId,
      action: "ACCOUNT_PROFILE_SAVED",
      outcome: "ACCEPTED",
      correlationId,
    });
  });
  return details;
}
