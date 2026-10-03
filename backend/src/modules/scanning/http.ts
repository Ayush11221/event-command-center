import { Router } from "express";
import {
  authenticate,
  requireCsrf,
  type AuthContext,
  type AuthDependencies,
} from "../auth/http.js";
import { recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { scanInput, type ScanInput } from "./input.js";
import { checkIn } from "./service.js";
import { observe } from "../../observability/telemetry.js";

export function scanningRouter(deps: AuthDependencies) {
  const router = Router();
  router.post("/scan-decisions", async (req, res) => {
    res.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    let actor: AuthContext | undefined;
    let input: ScanInput | undefined;
    try {
      actor = await authenticate(req, deps);
      requireCsrf(req, actor, deps);
      if (Object.keys(req.query).length)
        throw new ApiError(400, "VALIDATION", "Query fields are not supported");
      input = scanInput(req.body, req.header("Idempotency-Key"));
      const result = await checkIn(
        deps,
        actor,
        input,
        res.locals.correlationId as string,
      );
      observe("scan_outcome", result.body.decision, 0);
      res.status(result.status).json({
        ...result.body,
        replayed: result.replayed,
        correlation_id: res.locals.correlationId,
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw unavailable();
      try {
        await deps.db.$transaction((tx) =>
          recordAudit(tx, {
            actorKind: actor ? "ACCOUNT" : "SYSTEM",
            actorUserId: actor?.userId,
            action: "SCAN_ACTION_DENIED",
            outcome: "DENIED",
            correlationId: res.locals.correlationId as string,
            metadata: {
              code: error.code,
              ...(input
                ? {
                    scan_id: input.scan_id,
                    requested_event_id: input.event_id,
                    requested_gate_id: input.gate_id,
                  }
                : {}),
            },
          }),
        );
      } catch {
        throw unavailable();
      }
      throw error;
    }
  });
  return router;
}
