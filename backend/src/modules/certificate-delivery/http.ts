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
  registrationIdentity,
  type Identity,
} from "../registrations/identity.js";
import { parseIdempotencyKey } from "../events/command-safety.js";
import { objectBody } from "../certificates/contract.js";
import { CertificateBatches } from "./batches.js";
import { CertificateDeliveries } from "./delivery.js";
import { batchRequest, itemQuery, uuid } from "./contract.js";

export function certificateDeliveryRouter(
  deps: AuthDependencies,
  batches: CertificateBatches,
  deliveries: CertificateDeliveries,
) {
  const router = Router();
  const run =
    (
      owner: boolean,
      items: boolean,
      action: (
        req: Request,
        res: Response,
        actor: AuthContext | Identity,
      ) => Promise<void>,
    ) =>
    async (req: Request, res: Response) => {
      res.set({
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      try {
        const actor = owner
          ? await registrationIdentity(req, deps, false)
          : await authenticate(req, deps);
        if (req.method === "POST") requireCsrf(req, actor as AuthContext, deps);
        if (
          (!items && Object.keys(req.query).length) ||
          (req.method === "GET" &&
            (req.headers["transfer-encoding"] ||
              Number(req.headers["content-length"] ?? 0) > 0))
        )
          throw new ApiError(400, "VALIDATION", "Unsupported query or body");
        for (const key of ["registrationId", "batchId"]) {
          if (req.params[key] && !uuid.test(String(req.params[key])))
            throw new ApiError(
              404,
              key === "batchId" ? "BATCH_NOT_FOUND" : "REGISTRATION_NOT_FOUND",
              "Resource not found",
            );
        }
        if (req.method === "POST")
          await new Promise<void>((resolve, reject) =>
            express.json({ limit: "16kb", strict: true })(req, res, (error) =>
              error
                ? reject(new ApiError(400, "VALIDATION", "Invalid JSON body"))
                : resolve(),
            ),
          );
        await action(req, res, actor);
      } catch (error) {
        const known = error instanceof ApiError ? error : unavailable();
        try {
          await deps.db.$transaction((tx) =>
            recordAudit(tx, {
              actorKind: "SYSTEM",
              action: "CERTIFICATE_DELIVERY_ACTION_DENIED",
              outcome: "DENIED",
              correlationId: res.locals.correlationId,
              metadata: { code: known.code },
            }),
          );
        } catch {
          throw unavailable();
        }
        throw known;
      }
    };
  const batchPath = "/events/:eventId/certificate-batches",
    staffPath =
      "/events/:eventId/registrations/:registrationId/certificate/delivery";
  const send = (
    res: Response,
    result: { status: number; body: Record<string, unknown> },
  ) => {
    res
      .status(result.status)
      .json({ ...result.body, correlation_id: res.locals.correlationId });
  };
  const key = (req: Request) =>
    parseIdempotencyKey(req.header("Idempotency-Key"));
  router.post(
    batchPath,
    run(false, false, async (req, res, actor) =>
      send(
        res,
        await batches.create(
          actor as AuthContext,
          String(req.params.eventId).toLowerCase(),
          batchRequest(req.body),
          key(req),
          res.locals.correlationId,
        ),
      ),
    ),
  );
  router.get(
    batchPath + "/:batchId",
    run(false, false, async (req, res, actor) => {
      res.json({
        batch: await batches.status(
          actor as AuthContext,
          String(req.params.eventId).toLowerCase(),
          String(req.params.batchId).toLowerCase(),
        ),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  router.get(
    batchPath + "/:batchId/items",
    run(false, true, async (req, res, actor) => {
      res.json({
        ...(await batches.items(
          actor as AuthContext,
          String(req.params.eventId).toLowerCase(),
          String(req.params.batchId).toLowerCase(),
          itemQuery(req.query),
        )),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  router.get(
    staffPath,
    run(false, false, async (req, res, actor) => {
      res.json({
        delivery: await deliveries.read(
          actor,
          String(req.params.eventId).toLowerCase(),
          String(req.params.registrationId).toLowerCase(),
        ),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  router.get(
    "/registrations/:registrationId/certificate/delivery",
    run(true, false, async (req, res, actor) => {
      res.json({
        delivery: await deliveries.read(
          actor,
          null,
          String(req.params.registrationId).toLowerCase(),
        ),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  router.post(
    staffPath,
    run(false, false, async (req, res, actor) => {
      objectBody(req.body, []);
      send(
        res,
        await deliveries.enroll(
          actor as AuthContext,
          String(req.params.eventId).toLowerCase(),
          String(req.params.registrationId).toLowerCase(),
          key(req),
          res.locals.correlationId,
        ),
      );
    }),
  );
  router.post(
    staffPath + "/retry",
    run(false, false, async (req, res, actor) => {
      objectBody(req.body, []);
      send(
        res,
        await deliveries.retry(
          actor as AuthContext,
          String(req.params.eventId).toLowerCase(),
          String(req.params.registrationId).toLowerCase(),
          key(req),
          res.locals.correlationId,
        ),
      );
    }),
  );
  return router;
}
