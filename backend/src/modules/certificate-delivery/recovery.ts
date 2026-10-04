import type { CertificateBatches } from "./batches.js";
import type { CertificateDeliveries } from "./delivery.js";
import { operation } from "../../observability/telemetry.js";
export function startDeliveryRecovery(
  batches: CertificateBatches,
  deliveries: CertificateDeliveries,
  onUnavailable: (err: unknown) => void,
) {
  let stopped = false,
    pending: Promise<void> | undefined;
  const tick = () => {
    if (stopped || pending) return;
    pending = Promise.allSettled([
      operation("batch_recovery", () => batches.recover()),
      operation("delivery_recovery", () => deliveries.recover()),
    ])
      .then((results) => {
        for (const row of results)
          if (row.status === "rejected") onUnavailable(row.reason);
      })
      .finally(() => {
        pending = undefined;
      });
  };
  tick();
  const timer = setInterval(tick, 1000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
