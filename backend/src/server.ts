import { createApp } from "./app.js";
import { parseConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createDatabase } from "./config/database.js";
import { parseFoundationConfig } from "./config/foundation.js";
import { OtpService } from "./modules/auth/otp.js";
import { createOtpSender, loadSmsGateway } from "./modules/auth/sender.js";
import { ContactType } from "@prisma/client";
import { attachOperationsRealtime } from "./modules/occupancy/realtime.js";
import {
  CertificateService,
  startCertificateRecovery,
} from "./modules/certificates/service.js";

async function main() {
  const config = parseConfig(process.env);
  const foundation = parseFoundationConfig(process.env);
  const logger = createLogger();
  const db = createDatabase(foundation.databaseUrl);
  const smsGateway = foundation.smsGatewayModule
    ? await loadSmsGateway(foundation.smsGatewayModule)
    : undefined;
  const sender = createOtpSender(foundation, smsGateway);
  if (!sender.available(ContactType.PHONE)) {
    logger.warn(
      "Phone OTP delivery unavailable: SMS gateway is not configured",
    );
  }
  const otp = new OtpService(db, foundation, sender, (message) => {
    logger.warn(message);
  });
  const dependencies = {
    db,
    config: foundation,
    otp,
    frontendOrigin: config.frontendOrigin,
  };
  const certificates = new CertificateService(dependencies);
  const stopCertificates = startCertificateRecovery(certificates, () =>
    logger.warn("Certificate recovery dependency unavailable"),
  );
  const app = createApp(config, logger, dependencies, certificates);
  const server = app.listen(config.port, "127.0.0.1", () => {
    logger.info("backend listening");
  });
  const realtime = attachOperationsRealtime(server, {
    db,
    config: foundation,
    otp,
    frontendOrigin: config.frontendOrigin,
  });

  server.on("error", () => {
    logger.error("backend listener failed");
    process.exitCode = 1;
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      realtime.close(async () => {
        await stopCertificates();
        await db.$disconnect();
        logger.info("backend stopped");
      });
    });
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Invalid backend configuration";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
