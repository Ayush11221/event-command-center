import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { lockManagementEvent } from "../events/management-command.js";
import { recordAudit } from "../auth/audit.js";
export async function eventResults(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  correlationId: string,
) {
  return deps.db.$transaction(async (tx) => {
    await lockManagementEvent(tx, actor, eventId);
    const [row] = await tx.$queryRaw<
      {
        state: string;
        total: bigint;
        cancelled: bigint;
        accepted: bigint;
        eligible: bigint;
        issued: bigint;
        revoked: bigint;
        gates: { gate_id: string; accepted_check_ins: number }[];
        deliveries: Record<string, number>;
        incomplete: boolean;
        unrecorded: boolean;
        as_of: Date;
      }[]
    >`
      WITH r AS (SELECT * FROM "Registration" WHERE "eventId"=${eventId}::uuid),
      a AS (SELECT * FROM "AttendanceTransition" WHERE "eventId"=${eventId}::uuid AND kind='CHECK_IN'),
      c AS (SELECT id,status,"registrationId" FROM "Certificate" WHERE "eventId"=${eventId}::uuid),
      d AS (SELECT d.status FROM "CertificateDelivery" d JOIN c ON c.id=d."certificateId" WHERE d."eventId"=${eventId}::uuid)
      SELECT e.state::text, (SELECT count(*) FROM r) AS total,
        (SELECT count(*) FROM r WHERE state='CANCELLED') AS cancelled,
        (SELECT count(*) FROM a) AS accepted,
        (SELECT count(*) FROM r WHERE r.state='REGISTERED' AND EXISTS(SELECT 1 FROM a WHERE a."registrationId"=r.id AND a."acceptedAt"=r."firstAcceptedCheckInAt") AND NOT EXISTS(SELECT 1 FROM c WHERE c."registrationId"=r.id)) AS eligible,
        (SELECT count(*) FROM c WHERE status='ISSUED') AS issued,
        (SELECT count(*) FROM c WHERE status='REVOKED') AS revoked,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('gate_id',g.id,'accepted_check_ins',(SELECT count(*) FROM a WHERE a."gateId"=g.id)) ORDER BY g.id),'[]'::jsonb) FROM "Gate" g WHERE g."eventId"=e.id) AS gates,
        (SELECT jsonb_build_object('NOT_REQUIRED',count(*) FILTER(WHERE status='NOT_REQUIRED'),'PENDING',count(*) FILTER(WHERE status='PENDING'),'SENDING',count(*) FILTER(WHERE status='SENDING'),'SENT',count(*) FILTER(WHERE status='SENT'),'UNKNOWN',count(*) FILTER(WHERE status='UNKNOWN'),'FAILED',count(*) FILTER(WHERE status='FAILED')) FROM d) AS deliveries,
        (EXISTS(SELECT 1 FROM "CertificateIssueWork" w WHERE w."eventId"=e.id AND w.status='PENDING') OR EXISTS(SELECT 1 FROM "CertificateBatch" b WHERE b."eventId"=e.id AND b.status IN ('PENDING','RUNNING'))) AS incomplete,
        EXISTS(SELECT 1 FROM c WHERE NOT EXISTS(SELECT 1 FROM "CertificateDelivery" cd WHERE cd."certificateId"=c.id AND cd."eventId"=e.id)) AS unrecorded,
        statement_timestamp() AS as_of
      FROM "Event" e WHERE e.id=${eventId}::uuid`;
    if (!row) throw unavailable();
    if (row.state !== "COMPLETED")
      throw new ApiError(
        409,
        "RESULTS_NOT_COMPLETED",
        "Completed event required",
      );
    const numbers = [
      row.total,
      row.cancelled,
      row.accepted,
      row.eligible,
      row.issued,
      row.revoked,
    ].map(Number);
    if (
      ![
        ...numbers,
        ...Object.values(row.deliveries),
        ...row.gates.map((g) => g.accepted_check_ins),
      ].every((n) => Number.isSafeInteger(n) && n >= 0)
    )
      throw unavailable();
    const [total, cancelled, accepted, eligible, issued, revoked] = numbers as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const denominator = total - cancelled,
      valid = denominator > 0 && accepted <= denominator;
    const limitations = [
      "NO_EXIT_OR_DWELL_DATA",
      "HISTORICAL_OCCUPANCY_NOT_RECORDED",
    ];
    if (denominator === 0) limitations.push("NO_REGISTERED_DENOMINATOR");
    else if (!valid) limitations.push("ATTENDANCE_RATE_UNAVAILABLE");
    if (row.incomplete) limitations.push("CERTIFICATE_PROCESSING_INCOMPLETE");
    if (
      row.deliveries.PENDING! +
        row.deliveries.SENDING! +
        row.deliveries.UNKNOWN! >
      0
    )
      limitations.push("DELIVERY_PENDING_OR_UNCERTAIN");
    if (row.unrecorded) limitations.push("DELIVERY_STATE_NOT_RECORDED");
    await recordAudit(tx, {
      actorKind: "ACCOUNT",
      actorUserId: actor.userId,
      eventId,
      action: "EVENT_RESULTS_VIEWED",
      outcome: "ACCEPTED",
      correlationId,
    });
    return {
      event_id: eventId,
      event_state: "COMPLETED" as const,
      total_registrations: total,
      cancelled_registrations: cancelled,
      accepted_check_ins: accepted,
      attendance_rate_percentage: valid
        ? Number(((accepted * 100) / denominator).toFixed(2))
        : null,
      gate_check_ins: row.gates,
      certificate_eligible_count: eligible,
      certificate_issued_count: issued,
      certificate_revoked_count: revoked,
      certificate_delivery_counts: row.deliveries,
      data_limitations: limitations.sort(),
      as_of: row.as_of.toISOString(),
    };
  });
}
