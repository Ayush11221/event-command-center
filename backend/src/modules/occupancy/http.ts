import { Router } from "express";
import {
  authenticate,
  type AuthContext,
  type AuthDependencies,
} from "../auth/http.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import { operationsSnapshot } from "./service.js";

export function occupancyRouter(deps: AuthDependencies) {
  const router = Router();
  router.get("/events/:eventId/operations", async (req, res) => {
    res.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    let actor: AuthContext | undefined;
    try {
      actor = await authenticate(req, deps);
      if (Object.keys(req.query).length || req.body !== undefined)
        throw new ApiError(
          400,
          "VALIDATION",
          "Operations reads accept no query or body fields",
        );
      res.json(
        await operationsSnapshot(
          deps,
          actor,
          String(req.params.eventId),
          res.locals.correlationId as string,
        ),
      );
    } catch (error) {
      if (!(error instanceof ApiError)) throw unavailable();
      // Existing management reads do not audit successful read-only snapshots.
      // Denials are security evidence and required audit must fail closed.
      try {
        await deps.db.$transaction((tx) =>
          recordAudit(tx, {
            actorKind: actor ? "ACCOUNT" : "SYSTEM",
            actorUserId: actor?.userId,
            action: "OPERATIONS_READ_DENIED",
            outcome: "DENIED",
            correlationId: res.locals.correlationId as string,
            metadata: { code: error.code },
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
