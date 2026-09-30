import { createApp } from "./app.js";
import { parseConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";

try {
  const config = parseConfig(process.env);
  const logger = createLogger();
  const app = createApp(config, logger);
  const server = app.listen(config.port, "127.0.0.1", () => {
    logger.info("backend listening");
  });

  server.on("error", () => {
    logger.error("backend listener failed");
    process.exitCode = 1;
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close(() => {
        logger.info("backend stopped");
      });
    });
  }
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Invalid backend configuration";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
