import { Router } from "express";
import type { AuthDependencies } from "../auth/http.js";
import { ApiError } from "../auth/errors.js";
import {
  getPublicEvent,
  listPublicEvents,
  parsePublicCatalogQuery,
} from "./service.js";

export function discoveryRouter(deps: AuthDependencies) {
  const router = Router();
  router.use((_request, response, next) => {
    // Re-evaluate visibility/lifecycle on every read, including after a change.
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/events", async (request, response) => {
    response.json(
      await listPublicEvents(
        deps,
        parsePublicCatalogQuery(request.query),
        response.locals.correlationId as string,
      ),
    );
  });
  router.get("/events/:eventId", async (request, response) => {
    if (Object.keys(request.query).length)
      throw new ApiError(
        400,
        "VALIDATION",
        "Invalid public event detail query",
      );
    response.json(
      await getPublicEvent(
        deps,
        request.params.eventId,
        response.locals.correlationId as string,
      ),
    );
  });
  return router;
}
