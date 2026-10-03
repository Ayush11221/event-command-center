import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { AuthDependencies } from "../modules/auth/http.js";
import { metrics } from "./telemetry.js";

export function operationalRouter(deps: AuthDependencies) {
  const router = Router();
  router.get("/metrics", async (request, response) => {
    const key = process.env.METRICS_TOKEN;
    const supplied = Buffer.from(request.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${key ?? ""}`);
    if (
      !key ||
      !/^[a-f0-9]{64}$/i.test(key) ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      response.sendStatus(404);
      return;
    }
    let text = metrics();
    try {
      const rows = await deps.db.$queryRaw<
        { domain: string; state: string; count: bigint }[]
      >`
        SELECT 'certificate_issue' AS domain, status::text AS state, count(*) FROM "CertificateIssueWork" GROUP BY status
        UNION ALL SELECT 'batch', status, count(*) FROM "CertificateBatch" GROUP BY status
        UNION ALL SELECT 'delivery', status, count(*) FROM "CertificateDelivery" GROUP BY status`;
      text += "# TYPE eoc_durable_work gauge\n";
      for (const row of rows)
        text += `eoc_durable_work{domain="${row.domain}",state="${row.state}"} ${row.count}\n`;
      text += "eoc_database_available 1\n";
    } catch {
      text += "eoc_database_available 0\n";
    }
    response
      .set({
        "Content-Type": "text/plain; version=0.0.4",
        "Cache-Control": "no-store",
      })
      .send(text);
  });
  return router;
}
