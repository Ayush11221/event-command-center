import { Router } from "express";
import type { AuthDependencies } from "../auth/http.js";
import { authenticate, requireCsrf } from "../auth/http.js";
import { accountActor } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { editManagementEvent } from "./edit.js";
import {
  parseIdempotencyKey,
  parseRevisionPrecondition,
} from "./command-safety.js";
import { createEventGate, parseGateBody } from "./gates.js";
import {
  createDraftEvent,
  getManagementEvent,
  listManagementEvents,
} from "./service.js";
import {
  parseCreateDraftBody,
  parseCreateDraftKey,
  parseEventListQuery,
} from "./validation.js";

export function eventRouter(deps: AuthDependencies) {
  const router = Router();

  async function auditForbidden(actorUserId: string, correlationId: string) {
    try {
      await deps.db.auditEvent.create({
        data: {
          actorKind: accountActor,
          actorUserId,
          action: "EVENT_ACTION_DENIED",
          outcome: "DENIED",
          correlationId,
        },
      });
    } catch {
      throw unavailable();
    }
  }

  router.get("/", async (request, response) => {
    const actor = await authenticate(request, deps);
    try {
      const query = parseEventListQuery(request.query);
      response.json(
        await listManagementEvents(
          deps,
          actor.userId,
          query,
          response.locals.correlationId as string,
        ),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        await auditForbidden(
          actor.userId,
          response.locals.correlationId as string,
        );
      }
      throw error;
    }
  });

  router.post("/", async (request, response) => {
    const actor = await authenticate(request, deps);
    try {
      requireCsrf(request, actor, deps);
      const body = parseCreateDraftBody(request.body);
      const key = parseCreateDraftKey(request.header("Idempotency-Key"));
      const result = await createDraftEvent(
        deps,
        actor.userId,
        body.name,
        key,
        response.locals.correlationId as string,
      );
      response.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        await auditForbidden(
          actor.userId,
          response.locals.correlationId as string,
        );
      }
      throw error;
    }
  });

  router.get("/:eventId", async (request, response) => {
    const actor = await authenticate(request, deps);
    try {
      response.setHeader("Cache-Control", "no-store");
      response.json(
        await getManagementEvent(
          deps,
          actor.userId,
          request.params.eventId,
          response.locals.correlationId as string,
        ),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404)
        await auditForbidden(
          actor.userId,
          response.locals.correlationId as string,
        );
      throw error;
    }
  });

  router.patch("/:eventId", async (request, response) => {
    const actor = await authenticate(request, deps);
    try {
      requireCsrf(request, actor, deps);
      const revision = parseRevisionPrecondition(request.header("If-Match"));
      response.setHeader("Cache-Control", "no-store");
      response.json(
        await editManagementEvent(
          deps,
          actor,
          request.params.eventId,
          revision,
          request.body,
          response.locals.correlationId as string,
        ),
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404)
      )
        await auditForbidden(
          actor.userId,
          response.locals.correlationId as string,
        );
      throw error;
    }
  });

  router.post("/:eventId/gates", async (request, response) => {
    const actor = await authenticate(request, deps);
    try {
      requireCsrf(request, actor, deps);
      const revision = parseRevisionPrecondition(request.header("If-Match"));
      const key = parseIdempotencyKey(request.header("Idempotency-Key"));
      const body = parseGateBody(request.body);
      const result = await createEventGate(
        deps,
        actor,
        request.params.eventId,
        revision,
        key,
        body,
        response.locals.correlationId as string,
      );
      response.setHeader("Cache-Control", "no-store");
      response.status(result.status).json(result.body);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404)
      )
        await auditForbidden(
          actor.userId,
          response.locals.correlationId as string,
        );
      throw error;
    }
  });

  return router;
}
