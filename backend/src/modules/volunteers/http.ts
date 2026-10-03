import express, { Router, type Request, type Response } from "express";
import {
  authenticate,
  requireCsrf,
  type AuthDependencies,
  type AuthContext,
} from "../auth/http.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import {
  parseIdempotencyKey,
  parseRevisionPrecondition,
} from "../events/command-safety.js";
import { invalid } from "../events/scoped-cursor.js";
import { eventResults } from "../event-results/service.js";
import { searchAudit } from "../audit-search/service.js";
import { VolunteerTasks } from "./service.js";
export function volunteerRouter(deps: AuthDependencies) {
  const router = Router(),
    tasks = new VolunteerTasks(deps);
  const run =
    (
      action: (
        req: Request,
        res: Response,
        actor: AuthContext,
        eventId: string,
      ) => Promise<void>,
    ) =>
    async (req: Request, res: Response) => {
      res.set({
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      let actor: AuthContext | undefined;
      try {
        actor = await authenticate(req, deps);
        if (req.method !== "GET") {
          requireCsrf(req, actor, deps);
          if (Object.keys(req.query).length) invalid("query");
          await new Promise<void>((resolve, reject) =>
            express.json({ limit: "16kb", strict: true })(req, res, (error) =>
              error
                ? reject(new ApiError(400, "VALIDATION", "Invalid JSON body"))
                : resolve(),
            ),
          );
        } else if (
          req.headers["transfer-encoding"] ||
          Number(req.headers["content-length"] ?? 0) > 0
        )
          invalid("body");
        await action(req, res, actor, String(req.params.eventId).toLowerCase());
      } catch (error) {
        const known = error instanceof ApiError ? error : unavailable();
        // Denial evidence never attaches a guessed event or untrusted request text.
        if ([401, 403, 404].includes(known.status)) {
          try {
            await deps.db.$transaction((tx) =>
              recordAudit(tx, {
                actorKind: actor ? "ACCOUNT" : "SYSTEM",
                actorUserId: actor?.userId,
                action: "SLICE11_ACTION_DENIED",
                outcome: "DENIED",
                correlationId: res.locals.correlationId,
                metadata: { code: known.code },
              }),
            );
          } catch {
            throw unavailable();
          }
        }
        throw known;
      }
    };
  const base = "/events/:eventId/volunteer-tasks",
    detail = base + "/:taskId";
  router.get(
    base,
    run(async (req, res, actor, eventId) => {
      res.json({
        ...(await tasks.list(actor, eventId, req.query)),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  router.get(
    detail,
    run(async (req, res, actor, eventId) => {
      if (Object.keys(req.query).length) invalid("query");
      const result = await tasks.read(
        actor,
        eventId,
        String(req.params.taskId).toLowerCase(),
      );
      res
        .set("ETag", result.etag)
        .json({ task: result.task, correlation_id: res.locals.correlationId });
    }),
  );
  for (const [method, path, action] of [
    ["post", base, "CREATE"],
    ["patch", detail, "EDIT"],
    ["patch", detail + "/assignee", "ASSIGN"],
    ["patch", detail + "/status", "STATUS"],
    ["post", detail + "/cancel", "CANCEL"],
  ] as const) {
    router[method](
      path,
      run(async (req, res, actor, eventId) => {
        const result = await tasks.command(
          actor,
          eventId,
          action === "CREATE"
            ? undefined
            : String(req.params.taskId).toLowerCase(),
          action,
          req.body,
          parseIdempotencyKey(req.header("Idempotency-Key")),
          action === "CREATE"
            ? undefined
            : parseRevisionPrecondition(req.header("If-Match")),
          res.locals.correlationId as string,
        );
        res.status(result.status).set("ETag", result.body.etag).json({
          task: result.body.task,
          correlation_id: res.locals.correlationId,
        });
      }),
    );
  }
  router.get(
    "/events/:eventId/results",
    run(async (req, res, actor, eventId) => {
      if (Object.keys(req.query).length) invalid("query");
      res.json({
        results: await eventResults(
          deps,
          actor,
          eventId,
          res.locals.correlationId as string,
        ),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  router.get(
    "/events/:eventId/audit-events",
    run(async (req, res, actor, eventId) => {
      res.json({
        ...(await searchAudit(
          deps,
          actor,
          eventId,
          req.query,
          res.locals.correlationId as string,
        )),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  return router;
}
