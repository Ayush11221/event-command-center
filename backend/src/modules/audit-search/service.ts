import { Prisma } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { lockManagementEvent } from "../events/management-command.js";
import { recordAudit } from "../auth/audit.js";
import {
  ScopedCursor,
  queryFields,
  page,
  utc,
  uuid,
  invalid,
} from "../events/scoped-cursor.js";
export const targetTypes = [
  "EVENT",
  "GATE",
  "USER",
  "REGISTRATION",
  "CREDENTIAL",
  "SCAN_DECISION",
  "PRIVATE_ACCESS_LINK",
  "CERTIFICATE",
  "CERTIFICATE_ISSUE_WORK",
  "CERTIFICATE_BATCH",
  "CERTIFICATE_DELIVERY",
  "VOLUNTEER_TASK",
  "UNKNOWN",
];
const mapping: [string, string, string[]][] = [
  [
    "EVENT",
    "eventId",
    [
      "EVENT_CREATED",
      "EVENT_UPDATED",
      "EVENT_TRANSITIONED",
      "EVENT_RESULTS_VIEWED",
      "AUDIT_SEARCHED",
    ],
  ],
  ["GATE", "gate_id", ["GATE_CREATED"]],
  ["USER", "targetUserId", ["STAFF_GRANTED", "STAFF_REVOKED"]],
  [
    "PRIVATE_ACCESS_LINK",
    "link_id",
    ["PRIVATE_LINK_ISSUED", "PRIVATE_LINK_REISSUED", "PRIVATE_LINK_REVOKED"],
  ],
  [
    "REGISTRATION",
    "registration_id",
    [
      "REGISTRATION_CREATED",
      "REGISTRATION_CANCELLED",
      "REGISTRATION_VIEWED",
      "CERTIFICATE_STATUS_VIEWED",
      "CERTIFICATE_NAME_SET",
      "CERTIFICATE_NAME_CHANGED",
    ],
  ],
  ["CREDENTIAL", "credential_id", ["CREDENTIAL_VIEWED"]],
  ["SCAN_DECISION", "scan_decision_id", ["SCAN_CHECK_IN"]],
  [
    "CERTIFICATE",
    "certificate_id",
    ["CERTIFICATE_ARTIFACT_VIEWED", "CERTIFICATE_REVOKED"],
  ],
  [
    "CERTIFICATE_ISSUE_WORK",
    "issue_work_id",
    [
      "CERTIFICATE_ISSUE_REQUESTED",
      "CERTIFICATE_ISSUED",
      "CERTIFICATE_GENERATION_FAILED",
      "CERTIFICATE_GENERATION_RECOVERY_REQUESTED",
      "CERTIFICATE_GENERATION_CLAIMED",
      "CERTIFICATE_GENERATION_RETRY_SCHEDULED",
    ],
  ],
  [
    "CERTIFICATE_BATCH",
    "batch_id",
    [
      "CERTIFICATE_BATCH_ACCEPTED",
      "CERTIFICATE_BATCH_COMPLETED",
      "CERTIFICATE_BATCH_ITEM_FAILED",
      "CERTIFICATE_BATCH_ISSUE_REQUESTED",
    ],
  ],
  [
    "CERTIFICATE_DELIVERY",
    "delivery_id",
    [
      "CERTIFICATE_DELIVERY_REQUESTED",
      "CERTIFICATE_DELIVERY_RETRY_REQUESTED",
      "CERTIFICATE_DELIVERY_SUBMISSION_AUTHORIZED",
      "CERTIFICATE_DELIVERY_OUTCOME",
    ],
  ],
  [
    "VOLUNTEER_TASK",
    "task_id",
    [
      "VOLUNTEER_TASK_CREATED",
      "VOLUNTEER_TASK_UPDATED",
      "VOLUNTEER_TASK_REASSIGNED",
      "VOLUNTEER_TASK_STATUS_CHANGED",
      "VOLUNTEER_TASK_CANCELLED",
    ],
  ],
];
export function auditQuery(query: Record<string, unknown>) {
  queryFields(query, [
    "actor",
    "action",
    "target_type",
    "outcome",
    "from",
    "to",
    "cursor",
    "limit",
  ]);
  const pagination = page(query);
  const actor = query.actor as string | undefined;
  if (
    actor !== undefined &&
    !uuid.test(actor) &&
    actor !== "SYSTEM" &&
    actor !== "GUEST"
  )
    invalid("actor");
  for (const [field, max] of [
    ["action", 80],
    ["outcome", 24],
  ] as const)
    if (
      query[field] !== undefined &&
      (typeof query[field] !== "string" ||
        !/^[A-Z][A-Z0-9_]*$/.test(query[field]) ||
        query[field].length > max)
    )
      invalid(field);
  if (
    query.target_type !== undefined &&
    !targetTypes.includes(query.target_type as string)
  )
    invalid("target_type");
  const from = query.from === undefined ? null : utc(query.from, "from"),
    to = query.to === undefined ? null : utc(query.to, "to");
  if (from && to && from >= to) invalid("to");
  return {
    ...pagination,
    filters: {
      actor: actor ? (uuid.test(actor) ? actor.toLowerCase() : actor) : null,
      action: (query.action as string) ?? null,
      target_type: (query.target_type as string) ?? null,
      outcome: (query.outcome as string) ?? null,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
    },
  };
}
export async function searchAudit(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  query: Record<string, unknown>,
  correlationId: string,
) {
  const q = auditQuery(query),
    f = q.filters;
  return deps.db.$transaction(async (tx) => {
    await lockManagementEvent(tx, actor, eventId);
    const cursor = new ScopedCursor(
        "AUDIT",
        actor.userId,
        eventId,
        f,
        deps.config.contactKey,
      ),
      boundary = cursor.decode(q.cursor);
    const typeCases = mapping.map(
      ([type, , actions]) =>
        Prisma.sql`WHEN action IN (${Prisma.join(actions)}) THEN ${type}`,
    );
    const idCases = mapping.map(
      ([, key, actions]) =>
        Prisma.sql`WHEN action IN (${Prisma.join(actions)}) THEN ${key === "eventId" ? Prisma.sql`"eventId"::text` : key === "targetUserId" ? Prisma.sql`"targetUserId"::text` : Prisma.sql`metadata->>${key}`}`,
    );
    const filters: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (f.actor)
      filters.push(
        uuid.test(f.actor)
          ? Prisma.sql`"actorUserId"=${f.actor}::uuid`
          : Prisma.sql`"actorKind"::text=${f.actor}`,
      );
    if (f.action) filters.push(Prisma.sql`action=${f.action}`);
    if (f.outcome) filters.push(Prisma.sql`outcome=${f.outcome}`);
    if (f.target_type) filters.push(Prisma.sql`target_type=${f.target_type}`);
    if (f.from) filters.push(Prisma.sql`"createdAt">=${new Date(f.from)}`);
    if (f.to) filters.push(Prisma.sql`"createdAt"<${new Date(f.to)}`);
    if (boundary)
      filters.push(
        Prisma.sql`("createdAt",id)<(${new Date(boundary.last_at)},${boundary.last_id}::uuid)`,
      );
    const rows = await tx.$queryRaw<
      {
        id: string;
        eventId: string;
        actorKind: "ACCOUNT" | "GUEST" | "SYSTEM";
        actorUserId: string | null;
        action: string;
        outcome: string;
        createdAt: Date;
        correlationId: string;
        target_type: string;
        target_id: string | null;
      }[]
    >(Prisma.sql`
      WITH mapped AS (SELECT id,"eventId","actorKind","actorUserId",action,outcome,"createdAt","correlationId",
        CASE ${Prisma.join(typeCases, " ")} ELSE 'UNKNOWN' END AS kind,
        CASE ${Prisma.join(idCases, " ")} ELSE NULL END AS raw_target
        FROM "AuditEvent" WHERE "eventId"=${eventId}::uuid),
      evidence AS (SELECT *,CASE WHEN raw_target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN kind ELSE 'UNKNOWN' END AS target_type,
        CASE WHEN raw_target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN raw_target::uuid ELSE NULL END AS target_id FROM mapped)
      SELECT id,"eventId","actorKind","actorUserId",action,outcome,"createdAt","correlationId",target_type,target_id
      FROM evidence WHERE ${Prisma.join(filters, " AND ")} ORDER BY "createdAt" DESC,id DESC LIMIT ${q.limit + 1}`);
    const selected = rows.slice(0, q.limit),
      last = selected.at(-1);
    await recordAudit(tx, {
      actorKind: "ACCOUNT",
      actorUserId: actor.userId,
      eventId,
      action: "AUDIT_SEARCHED",
      outcome: "ACCEPTED",
      correlationId,
      metadata: { filters: f, result_count: selected.length },
    });
    return {
      items: selected.map((row) => ({
        id: row.id,
        event_id: row.eventId,
        actor: { kind: row.actorKind, id: row.actorUserId },
        action: row.action,
        target_type: row.target_type,
        target_id: row.target_id,
        outcome: row.outcome,
        occurred_at: row.createdAt.toISOString(),
        correlation_id: row.correlationId,
      })),
      next_cursor:
        rows.length > q.limit && last
          ? cursor.encode({
              last_at: last.createdAt.toISOString(),
              last_id: last.id,
            })
          : null,
    };
  });
}
