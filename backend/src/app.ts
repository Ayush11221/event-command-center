import cors from "cors";
import express from "express";
import type { Logger } from "pino";
import type { AppConfig } from "./config/env.js";
import type { AuthDependencies } from "./modules/auth/http.js";
import { authRouter } from "./modules/auth/http.js";
import { ApiError } from "./modules/auth/errors.js";
import { eventRouter } from "./modules/events/http.js";
import { discoveryRouter } from "./modules/discovery/http.js";
import { staffRouter } from "./modules/staff/http.js";
import { registrationRouter } from "./modules/registrations/http.js";
import { scanningRouter } from "./modules/scanning/http.js";
import { occupancyRouter } from "./modules/occupancy/http.js";
import { forecastingRouter } from "./modules/forecasting/http.js";
import { correlation } from "./middleware/correlation.js";
import { healthRouter } from "./routes/health.js";
import { certificateRouter } from "./modules/certificates/http.js";
import { CertificateService } from "./modules/certificates/service.js";
import { CertificateBatches } from "./modules/certificate-delivery/batches.js";
import { CertificateDeliveries } from "./modules/certificate-delivery/delivery.js";
import { certificateDeliveryRouter } from "./modules/certificate-delivery/http.js";

export function createApp(
  config: AppConfig,
  logger: Logger,
  foundation?: AuthDependencies,
  certificates?: CertificateService,
  deliveries?: CertificateDeliveries,
) {
  const app = express();
  app.disable("x-powered-by");

  app.use(correlation);
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, origin === config.frontendOrigin),
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: [
        "Content-Type",
        "X-Correlation-Id",
        "X-CSRF-Token",
        "If-Match",
        "Idempotency-Key",
        "Authorization",
      ],
      credentials: true,
    }),
  );
  app.use((request, response, next) => {
    response.on("finish", () => {
      logger.info(
        {
          correlation_id: response.locals.correlationId as string,
          method: request.method,
          path: request.path,
          status_code: response.statusCode,
        },
        "request completed",
      );
    });
    next();
  });

  app.use("/health", healthRouter());
  if (foundation) {
    // Forecast reads reject every body after authentication, including malformed
    // or oversized JSON. Do not let the shared mutation parser handle these GETs.
    app.use("/api/v1", forecastingRouter(foundation));
    app.use(
      "/api/v1",
      certificateDeliveryRouter(
        foundation,
        new CertificateBatches(foundation),
        deliveries ?? new CertificateDeliveries(foundation),
      ),
    );
    // Certificate routes authenticate before their feature-local body parser.
    app.use(
      "/api/v1",
      certificateRouter(
        foundation,
        certificates ?? new CertificateService(foundation),
      ),
    );
    app.use(express.json({ limit: "16kb", strict: true }));
    app.get("/health/ready", async (_request, response) => {
      try {
        await foundation.db.$queryRaw`SELECT 1`;
        response.json({
          status: "ready",
          correlation_id: response.locals.correlationId,
        });
      } catch {
        response.status(503).json({
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Service unavailable",
          correlation_id: response.locals.correlationId,
        });
      }
    });
    app.use("/api/v1/auth", authRouter(foundation));
    app.use("/api/v1/events", eventRouter(foundation));
    app.use("/api/v1/events", staffRouter(foundation));
    app.use("/api/v1/discovery", discoveryRouter(foundation));
    app.use("/api/v1", registrationRouter(foundation));
    app.use("/api/v1", scanningRouter(foundation));
    app.use("/api/v1", occupancyRouter(foundation));
  }
  app.use((_request, response) => {
    response.status(404).json({
      code: "NOT_FOUND",
      message: "Not found",
      correlation_id: response.locals.correlationId as string,
    });
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      if (response.headersSent) return;
      const known =
        error instanceof ApiError
          ? error
          : error instanceof SyntaxError &&
              "status" in error &&
              error.status === 400
            ? new ApiError(400, "VALIDATION", "Invalid JSON body")
            : undefined;
      if (!known)
        logger.error(
          { correlation_id: response.locals.correlationId },
          "request failed",
        );
      response.status(known?.status ?? 500).json({
        code: known?.code ?? "INTERNAL_ERROR",
        message: known?.message ?? "Request failed",
        ...(known?.details === undefined ? {} : { details: known.details }),
        ...(known?.retryable === undefined
          ? {}
          : { retryable: known.retryable }),
        correlation_id: response.locals.correlationId,
      });
    },
  );

  return app;
}
