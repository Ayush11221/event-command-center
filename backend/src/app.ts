import cors from "cors";
import express from "express";
import type { Logger } from "pino";
import type { AppConfig } from "./config/env.js";
import { correlation } from "./middleware/correlation.js";
import { healthRouter } from "./routes/health.js";

export function createApp(config: AppConfig, logger: Logger) {
  const app = express();
  app.disable("x-powered-by");

  app.use(correlation);
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, origin === config.frontendOrigin),
      methods: ["GET"],
      allowedHeaders: ["X-Correlation-Id"],
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
  app.use((_request, response) => {
    response.status(404).json({
      code: "NOT_FOUND",
      message: "Not found",
      correlation_id: response.locals.correlationId as string,
    });
  });

  return app;
}
