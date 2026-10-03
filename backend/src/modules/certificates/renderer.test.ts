import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { renderPdf, rendererAvailable } from "./renderer.js";
import type { RenderInput } from "./pdf.js";

const workers = vi.hoisted(() => ({
  created: [] as EventEmitter[],
  options: [] as Record<string, unknown>[],
}));
vi.mock("node:worker_threads", () => ({
  Worker: class extends EventEmitter {
    constructor(_source: string, options: Record<string, unknown>) {
      super();
      workers.created.push(this);
      workers.options.push(options);
    }
    async terminate() {
      this.emit("exit", 1);
      return 1;
    }
  },
}));
const input: RenderInput = {
  template_id: "classic",
  template_version: 1,
  font_id: "sans",
  recipientName: "Synthetic Name",
  eventName: "Fixture",
  eventStartAt: "2026-10-03T12:00:00Z",
  eventTimeZone: "UTC",
  issuedAt: "2026-10-03T13:00:00Z",
  certificateNumber: "PREVIEW",
  preview: true,
};
afterEach(() => {
  vi.useRealTimers();
  workers.created.length = 0;
  workers.options.length = 0;
});
it("terminates generation at two seconds and releases renderer capacity", async () => {
  vi.useFakeTimers();
  const promise = renderPdf(input);
  const failure = expect(promise).rejects.toMatchObject({
    code: "DEPENDENCY_UNAVAILABLE",
    status: 503,
  });
  expect(rendererAvailable()).toBe(false);
  expect(workers.options[0].resourceLimits).toEqual({
    maxOldGenerationSizeMb: 64,
    maxYoungGenerationSizeMb: 16,
    stackSizeMb: 4,
  });
  const terminated = vi.spyOn(
    workers.created[0] as EventEmitter & { terminate(): Promise<number> },
    "terminate",
  );
  await vi.advanceTimersByTimeAsync(2000);
  await failure;
  expect(terminated).toHaveBeenCalledOnce();
  expect(rendererAvailable()).toBe(true);
});
it("rejects oversized worker output and terminates its worker", async () => {
  const promise = renderPdf(input);
  const failure = expect(promise).rejects.toMatchObject({
    status: 422,
    code: "VALIDATION",
  });
  const terminated = vi.spyOn(
    workers.created[0] as EventEmitter & { terminate(): Promise<number> },
    "terminate",
  );
  workers.created[0].emit("message", { bytes: new Uint8Array(1048577) });
  await failure;
  expect(terminated).toHaveBeenCalledOnce();
  expect(rendererAvailable()).toBe(true);
});
it("does not expose worker exceptions containing participant text", async () => {
  const promise = renderPdf(input);
  workers.created[0].emit("error", new Error(input.recipientName));
  await expect(promise).rejects.toMatchObject({
    code: "DEPENDENCY_UNAVAILABLE",
  });
  await expect(promise).rejects.not.toThrow(input.recipientName);
  expect(rendererAvailable()).toBe(true);
});
