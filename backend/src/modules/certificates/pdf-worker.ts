import { parentPort, workerData } from "node:worker_threads";
import { renderDocument, type RenderInput } from "./pdf.js";
import { ApiError } from "../auth/errors.js";

try {
  const bytes = await renderDocument(workerData.input as RenderInput);
  parentPort!.postMessage({ bytes }, [bytes.buffer as ArrayBuffer]);
} catch (error) {
  // Never send raw renderer exceptions: they may contain participant text.
  const known = error instanceof ApiError;
  parentPort!.postMessage({
    error: {
      status: known ? error.status : 503,
      code: known ? error.code : "DEPENDENCY_UNAVAILABLE",
      details: known ? error.details : undefined,
    },
  });
}
