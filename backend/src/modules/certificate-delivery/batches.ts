import { Prisma } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { ApiError } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import {
  staffScope,
  durableStaffScope,
  evidence,
} from "../certificates/access.js";
import { lockEventForCommand } from "../events/private-links.js";
import { durableCommand } from "./command.js";
import { batchIssueWork } from "./batch-work.js";
import { ensureDelivery } from "./intent.js";
import type { batchRequest } from "./contract.js";

const missing = () => new ApiError(404, "BATCH_NOT_FOUND", "Batch not found");
export async function batchView(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.certificateBatch.findUniqueOrThrow({ where: { id } });
  const items = await tx.certificateBatchItem.findMany({
    where: { batchId: id },
  });
  const deliveries = await tx.certificateDelivery.findMany({
    where: {
      certificateId: {
        in: items.flatMap((item) =>
          item.certificateId ? [item.certificateId] : [],
        ),
      },
    },
  });
  const count = (status: string) =>
    items.filter((item) => item.status === status).length;
  return {
    batch_id: row.id,
    event_id: row.eventId,
    status: row.status,
    template_id: row.templateId,
    template_version: row.templateVersion,
    font_id: row.fontId,
    selected_count: items.length,
    eligible_count: items.filter((item) => item.eligibleAtCreation).length,
    generated_count: items.filter((item) => item.resultCode === "GENERATED")
      .length,
    already_satisfied_count: items.filter(
      (item) => item.resultCode === "ALREADY_SATISFIED",
    ).length,
    successful_count: count("SUCCEEDED"),
    failed_count: count("FAILED"),
    pending_count: count("PENDING") + count("RUNNING"),
    delivery_counts: {
      not_required: deliveries.filter((d) => d.status === "NOT_REQUIRED")
        .length,
      pending: deliveries.filter((d) => d.status === "PENDING").length,
      sending: deliveries.filter((d) => d.status === "SENDING").length,
      sent: deliveries.filter((d) => d.status === "SENT").length,
      unknown: deliveries.filter((d) => d.status === "UNKNOWN").length,
      failed: deliveries.filter((d) => d.status === "FAILED").length,
    },
    created_at: row.createdAt.toISOString(),
    started_at: row.startedAt?.toISOString() ?? null,
    completed_at: row.completedAt?.toISOString() ?? null,
  };
}
export class CertificateBatches {
  constructor(readonly deps: AuthDependencies) {}
  create(
    actor: AuthContext,
    eventId: string,
    input: ReturnType<typeof batchRequest>,
    key: string,
    correlationId: string,
  ) {
    return durableCommand(
      this.deps,
      actor,
      eventId,
      "CERTIFICATE_BATCH",
      key,
      input,
      async (tx, replayId) => {
        const batch = await tx.certificateBatch.create({
          data: {
            eventId,
            requestedByUserId: actor.userId,
            acceptanceSessionId: actor.sessionId,
            commandReplayId: replayId,
            correlationId,
            templateId: input.template_id,
            templateVersion: input.template_version,
            fontId: input.font_id,
          },
        });
        for (const registrationId of input.registration_ids) {
          const row = await tx.registration.findFirst({
            where: { id: registrationId, eventId },
          });
          await tx.certificateBatchItem.create({
            data: {
              batchId: batch.id,
              eventId,
              registrationId,
              eligibleAtCreation: !!row && !!(await evidence(tx, row)),
            },
          });
        }
        await recordAudit(tx, {
          actorKind: "ACCOUNT",
          actorUserId: actor.userId,
          eventId,
          action: "CERTIFICATE_BATCH_ACCEPTED",
          outcome: "SUCCESS",
          correlationId,
          metadata: {
            batch_id: batch.id,
            selected_count: input.registration_ids.length,
          },
        });
        return { status: 202, body: { batch: await batchView(tx, batch.id) } };
      },
    );
  }
  private async scope(
    tx: Prisma.TransactionClient,
    actor: AuthContext,
    eventId: string,
    id: string,
  ) {
    await staffScope(tx, actor, eventId);
    if (!(await tx.certificateBatch.findFirst({ where: { id, eventId } })))
      throw missing();
  }
  status(actor: AuthContext, eventId: string, id: string) {
    return this.deps.db.$transaction(async (tx) => {
      await this.scope(tx, actor, eventId, id);
      return batchView(tx, id);
    });
  }
  items(
    actor: AuthContext,
    eventId: string,
    id: string,
    query: { cursor?: string; limit: number },
  ) {
    return this.deps.db.$transaction(async (tx) => {
      await this.scope(tx, actor, eventId, id);
      if (
        query.cursor &&
        !(await tx.certificateBatchItem.findFirst({
          where: { batchId: id, registrationId: query.cursor },
        }))
      )
        throw new ApiError(400, "VALIDATION", "Invalid item cursor");
      const rows = await tx.certificateBatchItem.findMany({
        where: {
          batchId: id,
          ...(query.cursor ? { registrationId: { gt: query.cursor } } : {}),
        },
        orderBy: { registrationId: "asc" },
        take: query.limit + 1,
      });
      return {
        items: rows.slice(0, query.limit).map((row) => ({
          registration_id: row.registrationId,
          status: row.status,
          issue_work_id: row.issueWorkId,
          certificate_id: row.certificateId,
          result_code: row.resultCode,
        })),
        next_cursor:
          rows.length > query.limit
            ? rows[query.limit - 1].registrationId
            : null,
      };
    });
  }
  async recover() {
    const batches = await this.deps.db.certificateBatch.findMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 25,
    });
    for (const batch of batches)
      await this.deps.db.$transaction(
        async (tx) => {
          await lockEventForCommand(tx, batch.eventId);
          const current = await tx.certificateBatch.findUniqueOrThrow({
            where: { id: batch.id },
          });
          if (!["PENDING", "RUNNING"].includes(current.status)) return;
          if (current.status === "PENDING")
            await tx.certificateBatch.update({
              where: { id: batch.id },
              data: { status: "RUNNING", startedAt: new Date() },
            });
          const all = await tx.certificateBatchItem.findMany({
            where: {
              batchId: batch.id,
              status: { in: ["PENDING", "RUNNING"] },
            },
            orderBy: { registrationId: "asc" },
          });
          let authorityError: string | null = null;
          try {
            await durableStaffScope(tx, batch.requestedByUserId, batch.eventId);
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            authorityError = error.code;
          }
          // One new issuance per scan; all retained running outcomes can be reconciled.
          let accepted = false;
          for (const item of all) {
            if (item.status === "PENDING" && accepted && !authorityError)
              continue;
            if (item.status === "PENDING") {
              accepted = true;
              await tx.certificateBatchItem.update({
                where: { id: item.id },
                data: { status: "RUNNING" },
              });
            }
            let code: string | null = authorityError;
            let cycleReplaced = false;
            if (item.issueWorkId) {
              const work = await tx.certificateIssueWork.findUniqueOrThrow({
                where: { id: item.issueWorkId },
              });
              if (work.generationCycle !== item.generationCycle) {
                code = "ISSUE_CYCLE_REPLACED";
                cycleReplaced = true;
              }
            }
            const cert = await tx.certificate.findUnique({
              where: { registrationId: item.registrationId },
              select: { id: true, eventId: true, status: true },
            });
            if (
              !cycleReplaced &&
              cert?.eventId === batch.eventId &&
              cert.status === "ISSUED"
            ) {
              // Reconcile already committed issuance even after role loss.
              // Role loss still prevents creating a new legacy delivery intent.
              if (!authorityError)
                await ensureDelivery(tx, cert.id, batch.correlationId);
              const work =
                item.issueWorkId === cert.id
                  ? await tx.certificateIssueWork.findUnique({
                      where: { id: cert.id },
                    })
                  : null;
              await tx.certificateBatchItem.update({
                where: { id: item.id },
                data: {
                  status: "SUCCEEDED",
                  certificateId: cert.id,
                  resultCode:
                    work?.executionBatchId === batch.id
                      ? "GENERATED"
                      : "ALREADY_SATISFIED",
                },
              });
              continue;
            }
            if (cert?.eventId === batch.eventId && cert.status === "REVOKED")
              code = "CERTIFICATE_REVOKED";
            if (!code && item.issueWorkId) {
              const work = await tx.certificateIssueWork.findUniqueOrThrow({
                where: { id: item.issueWorkId },
              });
              if (work.generationCycle !== item.generationCycle)
                code = "ISSUE_CYCLE_REPLACED";
              else if (work.status === "FAILED")
                code = work.lastErrorCode ?? "GENERATION_FAILED";
              else continue;
            }
            if (!code) {
              const row = await tx.registration.findFirst({
                where: { id: item.registrationId, eventId: batch.eventId },
              });
              if (!row) code = "REGISTRATION_NOT_FOUND";
              else
                try {
                  const work = await batchIssueWork(tx, batch, row);
                  await tx.certificateBatchItem.update({
                    where: { id: item.id },
                    data: {
                      issueWorkId: work.id,
                      generationCycle: work.generationCycle,
                    },
                  });
                  continue;
                } catch (error) {
                  if (!(error instanceof ApiError)) throw error;
                  code = error.code;
                }
            }
            await tx.certificateBatchItem.update({
              where: { id: item.id },
              data: { status: "FAILED", resultCode: code },
            });
            await recordAudit(tx, {
              actorKind: "SYSTEM",
              eventId: batch.eventId,
              action: "CERTIFICATE_BATCH_ITEM_FAILED",
              outcome: "FAILED",
              correlationId: batch.correlationId,
              metadata: {
                batch_id: batch.id,
                registration_id: item.registrationId,
                code,
              },
            });
          }
          const view = await batchView(tx, batch.id);
          if (view.pending_count === 0) {
            const status =
              view.failed_count === 0
                ? "COMPLETED"
                : view.successful_count === 0
                  ? "FAILED"
                  : "PARTIAL_FAILED";
            await tx.certificateBatch.update({
              where: { id: batch.id },
              data: { status, completedAt: new Date() },
            });
            await recordAudit(tx, {
              actorKind: "SYSTEM",
              eventId: batch.eventId,
              action: "CERTIFICATE_BATCH_COMPLETED",
              outcome: status,
              correlationId: batch.correlationId,
              metadata: {
                batch_id: batch.id,
                successful_count: view.successful_count,
                failed_count: view.failed_count,
              },
            });
          }
        },
        { maxWait: 2000, timeout: 5000 },
      );
  }
}
