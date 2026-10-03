import { afterEach, expect, it, vi } from "vitest";
import {
  startCertificateRecovery,
  type CertificateService,
} from "./service.js";
afterEach(() => vi.useRealTimers());
it("starts recovery immediately, ticks without overlapping work and stops cleanly", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const recover = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const close = startCertificateRecovery(
    { recover } as unknown as CertificateService,
    vi.fn(),
  );
  expect(recover).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(recover).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(recover).toHaveBeenCalledTimes(2);
  await close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(recover).toHaveBeenCalledTimes(2);
});
it("reports recovery dependency failure and retries the recovery scan on a later tick", async () => {
  vi.useFakeTimers();
  const fail = vi.fn(),
    recover = vi
      .fn()
      .mockRejectedValueOnce(new Error("Synthetic outage"))
      .mockResolvedValue(undefined);
  const close = startCertificateRecovery(
    { recover } as unknown as CertificateService,
    fail,
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(fail).toHaveBeenCalledTimes(1);
  expect(recover).toHaveBeenCalledTimes(2);
  await close();
});
