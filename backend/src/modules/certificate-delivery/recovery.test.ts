import { afterEach, expect, it, vi } from "vitest";
import { startDeliveryRecovery } from "./recovery.js";
import type { CertificateBatches } from "./batches.js";
import type { CertificateDeliveries } from "./delivery.js";
afterEach(() => vi.useRealTimers());
it("starts both recovery scans, avoids overlapping ticks and shuts down", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const batch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      )
      .mockResolvedValue(undefined),
    delivery = vi.fn().mockResolvedValue(undefined),
    warn = vi.fn();
  const stop = startDeliveryRecovery(
    { recover: batch } as unknown as CertificateBatches,
    { recover: delivery } as unknown as CertificateDeliveries,
    warn,
  );
  await vi.advanceTimersByTimeAsync(3000);
  expect(batch).toHaveBeenCalledTimes(1);
  expect(delivery).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(batch).toHaveBeenCalledTimes(2);
  await stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(batch).toHaveBeenCalledTimes(2);
  expect(warn).not.toHaveBeenCalled();
});
it("keeps the other recovery boundary running when one dependency fails", async () => {
  vi.useFakeTimers();
  const batch = vi.fn().mockRejectedValue(new Error("outage")),
    delivery = vi.fn().mockResolvedValue(undefined),
    warn = vi.fn();
  const stop = startDeliveryRecovery(
    { recover: batch } as unknown as CertificateBatches,
    { recover: delivery } as unknown as CertificateDeliveries,
    warn,
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(warn).toHaveBeenCalled();
  expect(delivery.mock.calls.length).toBeGreaterThan(1);
  await stop();
});
