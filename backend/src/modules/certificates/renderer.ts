import { Worker } from "node:worker_threads";
import { ApiError, unavailable } from "../auth/errors.js";
import { PDF_LIMIT } from "./contract.js";
import type { RenderInput } from "./pdf.js";

export type Renderer = (input: RenderInput) => Promise<Uint8Array>;
let active = false;
export const rendererAvailable = () => !active;
export const renderPdf: Renderer = async (input) => {
  if (active) throw unavailable();
  active = true;
  const module = new URL(
    import.meta.url.endsWith(".ts") ? "./pdf-worker.ts" : "./pdf-worker.js",
    import.meta.url,
  ).href;
  const bootstrap = module.endsWith(".ts")
    ? "import('tsx/esm/api').then(({tsImport}) => tsImport(workerData.module, workerData.module))"
    : "import(workerData.module)";
  let worker: Worker | undefined;
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      worker = new Worker(
        `const {workerData}=require('node:worker_threads'); ${bootstrap}.catch(() => process.exit(1));`,
        {
          eval: true,
          workerData: { module, input },
          resourceLimits: {
            maxOldGenerationSizeMb: 64,
            maxYoungGenerationSizeMb: 16,
            stackSizeMb: 4,
          },
        },
      );
      const timer = setTimeout(() => reject(unavailable()), 2000);
      worker.once(
        "message",
        (message: {
          bytes?: Uint8Array;
          error?: {
            status: number;
            code: string;
            details?: Record<string, unknown>;
          };
        }) => {
          if (message.error)
            reject(
              new ApiError(
                message.error.status,
                message.error.code,
                "Certificate generation failed",
                { details: message.error.details },
              ),
            );
          else if (
            message.bytes &&
            message.bytes.byteLength > 0 &&
            message.bytes.byteLength <= PDF_LIMIT
          )
            resolve(message.bytes);
          else reject(new ApiError(422, "VALIDATION", "Invalid PDF output"));
        },
      );
      worker.once("error", () => reject(unavailable()));
      worker.once("exit", () => reject(unavailable()));
      // The timer is owned by the worker lifetime, including errors/termination.
      worker.once("exit", () => clearTimeout(timer));
    });
  } finally {
    if (worker) await worker.terminate();
    active = false;
  }
};
