import { Router } from "express";
import {
  authenticate,
  type AuthContext,
  type AuthDependencies,
} from "../auth/http.js";
import { recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { currentForecast, forecastHistory } from "./service.js";

export function forecastingRouter(deps: AuthDependencies) {
  const router = Router();
  for (const current of [true, false])
    router.get(
      `/events/:eventId/forecasts${current ? "/current" : ""}`,
      async (req, res) => {
        res.set({
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        });
        let actor: AuthContext | undefined;
        try {
          actor = await authenticate(req, deps);
          if (
            req.body !== undefined ||
            req.headers["transfer-encoding"] ||
            Number(req.headers["content-length"] ?? 0) > 0 ||
            (current && Object.keys(req.query).length)
          )
            throw new ApiError(
              400,
              "VALIDATION",
              "Unsupported forecast request fields",
            );
          const eventId = String(req.params.eventId).toLowerCase(),
            correlationId = res.locals.correlationId as string;
          res.json(
            current
              ? await currentForecast(deps, actor, eventId, correlationId)
              : await forecastHistory(
                  deps,
                  actor,
                  eventId,
                  req.query,
                  correlationId,
                ),
          );
        } catch (error) {
          const known = error instanceof ApiError ? error : unavailable();
          try {
            await deps.db.$transaction((tx) =>
              recordAudit(tx, {
                actorKind: actor ? "ACCOUNT" : "SYSTEM",
                actorUserId: actor?.userId,
                action: "FORECAST_READ_DENIED",
                outcome: "DENIED",
                correlationId: res.locals.correlationId as string,
                metadata: { code: known.code },
              }),
            );
          } catch {
            throw unavailable();
          }
          throw known;
        }
      },
    );
  return router;
}
