import { Router, type Request, type Response } from "express";
import type { AuthDependencies } from "../auth/http.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import { parseIdempotencyKey } from "../events/command-safety.js";
import {
  auditActor,
  establishGuest,
  registrationIdentity,
  type Identity,
} from "./identity.js";
import {
  cancel,
  credential,
  ownLatest,
  readRegistration,
  register,
} from "./service.js";

function emptyBody(request: Request) {
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body) ||
    Object.keys(request.body).length
  )
    throw new ApiError(400, "VALIDATION", "Expected an empty object body");
}
function proof(request: Request) {
  return request
    .header("Authorization")
    ?.match(/^PrivateLink ([A-Za-z0-9_-]{43})$/)?.[1];
}
export function registrationRouter(deps: AuthDependencies) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  const route =
    (
      mutation: boolean,
      action: (
        request: Request,
        response: Response,
        identity: Identity,
      ) => Promise<void>,
    ) =>
    async (request: Request, response: Response) => {
      let identity: Identity | undefined;
      try {
        identity = await registrationIdentity(request, deps, mutation);
        await action(request, response, identity);
      } catch (error) {
        if (!(error instanceof ApiError)) throw unavailable();
        // A required denial audit must succeed before returning the denial.
        try {
          await deps.db.$transaction((tx) =>
            recordAudit(tx, {
              ...(identity
                ? auditActor(identity)
                : { actorKind: "SYSTEM" as const }),
              action: "REGISTRATION_ACTION_DENIED",
              outcome: "DENIED",
              correlationId: response.locals.correlationId as string,
              metadata: { code: error.code },
            }),
          );
        } catch {
          throw unavailable();
        }
        throw error;
      }
    };
  router.post(
    "/events/:eventId/registrations",
    route(true, async (req, res, identity) => {
      emptyBody(req);
      const key = parseIdempotencyKey(req.header("Idempotency-Key"));
      await establishGuest(identity, deps, res.locals.correlationId as string);
      const result = await register(
        deps,
        identity,
        String(req.params.eventId),
        proof(req),
        key,
        res.locals.correlationId as string,
      );
      res
        .status(result.status)
        .json({ ...result.body, correlation_id: res.locals.correlationId });
    }),
  );
  router.get(
    "/events/:eventId/registrations",
    route(false, async (req, res, identity) => {
      if (Object.keys(req.query).length)
        throw new ApiError(400, "VALIDATION", "Query fields are not supported");
      res.json({
        ...(await ownLatest(
          deps,
          identity,
          String(req.params.eventId),
          proof(req),
          res.locals.correlationId as string,
        )),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  router.get(
    "/registrations/:registrationId",
    route(false, async (req, res, identity) => {
      res.json({
        ...(await readRegistration(
          deps,
          identity,
          String(req.params.registrationId),
          res.locals.correlationId as string,
        )),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  router.post(
    "/registrations/:registrationId/cancel",
    route(true, async (req, res, identity) => {
      emptyBody(req);
      const key = parseIdempotencyKey(req.header("Idempotency-Key"));
      if (identity.kind === "GUEST" && !identity.id)
        throw new ApiError(
          404,
          "REGISTRATION_NOT_FOUND",
          "Registration not found",
        );
      const result = await cancel(
        deps,
        identity,
        String(req.params.registrationId),
        key,
        res.locals.correlationId as string,
      );
      res
        .status(result.status)
        .json({ ...result.body, correlation_id: res.locals.correlationId });
    }),
  );
  router.get(
    "/registrations/:registrationId/credential",
    route(false, async (req, res, identity) => {
      res.json({
        ...(await credential(
          deps,
          identity,
          String(req.params.registrationId),
          res.locals.correlationId as string,
        )),
        correlation_id: res.locals.correlationId,
      });
    }),
  );
  return router;
}
