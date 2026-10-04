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
import { CertificateBatches } from "./modules/certificate-delivery/batches.js";
import { CertificateDeliveries } from "./modules/certificate-delivery/delivery.js";
import { startDeliveryRecovery } from "./modules/certificate-delivery/recovery.js";
import { loadSecrets } from "./config/secrets.js";
import { operation } from "./observability/telemetry.js";

async function main() {
  loadSecrets(process.env);
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
  const deliveries = new CertificateDeliveries(dependencies);
  const stopDeliveries = startDeliveryRecovery(
    new CertificateBatches(dependencies),
    deliveries,
    (err) =>
      logger.warn(
        { err },
        "Certificate batch/delivery recovery dependency unavailable",
      ),
  );
  const stopCertificates = startCertificateRecovery(certificates, (err) =>
    logger.warn({ err }, "Certificate recovery dependency unavailable"),
  );
  const app = createApp(config, logger, dependencies, certificates, deliveries);
  const server = app.listen(config.port, config.bindHost ?? "127.0.0.1", () => {
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
      const deadline = setTimeout(() => process.exit(1), 30000);
      deadline.unref();
      realtime.close(async () => {
        await operation("shutdown", async () => {
          await stopCertificates();
          await stopDeliveries();
          await db.$disconnect();
        });
        clearTimeout(deadline);
        logger.info("backend stopped");
      });
    });
  }
}

main().catch((error: unknown) => {
  createLogger().error(
    { err: error },
    "Backend startup failed; verify configuration and dependency availability",
  );
  process.exitCode = 1;
});
