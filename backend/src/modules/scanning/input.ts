import { createHmac } from "node:crypto";
import { ApiError } from "../auth/errors.js";
import { parseIdempotencyKey } from "../events/command-safety.js";

export interface ScanInput {
  scan_id: string;
  event_id: string;
  gate_id: string;
  credential: string;
  direction?: "CHECK_IN" | "CHECK_OUT";
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function scanInput(body: unknown, key: string | undefined): ScanInput {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApiError(400, "VALIDATION", "Invalid scan request");
  const row = body as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (field) =>
        !["scan_id", "event_id", "gate_id", "credential", "direction"].includes(
          field,
        ),
    ) ||
    !["scan_id", "event_id", "gate_id", "credential"].every((field) =>
      Object.hasOwn(row, field),
    ) ||
    !["scan_id", "event_id", "gate_id"].every(
      (field) => typeof row[field] === "string" && uuid.test(row[field]),
    ) ||
    typeof row.credential !== "string" ||
    row.credential.length < 1 ||
    row.credential.length > 128 ||
    (Object.hasOwn(row, "direction") &&
      !["CHECK_IN", "CHECK_OUT"].includes(row.direction as string))
  )
    throw new ApiError(400, "VALIDATION", "Invalid scan request");
  const result = {
    scan_id: (row.scan_id as string).toLowerCase(),
    event_id: (row.event_id as string).toLowerCase(),
    gate_id: (row.gate_id as string).toLowerCase(),
    credential: row.credential,
    ...(row.direction === "CHECK_OUT"
      ? { direction: "CHECK_OUT" as const }
      : {}),
  };
  if (parseIdempotencyKey(key) !== result.scan_id)
    throw new ApiError(400, "VALIDATION", "Idempotency-Key must equal scan_id");
  return result;
}

// Fingerprint even malformed inputs without persisting the proof.
export function scanFingerprint(input: ScanInput, root: Uint8Array) {
  if (root.length !== 32) throw new TypeError("Invalid scanner root key");
  const key = createHmac("sha256", root).update("eoc.scan.request.v1").digest();
  const { credential, ...context } = input;
  return {
    ...context,
    credential_fingerprint: createHmac("sha256", key)
      .update(credential)
      .digest("hex"),
  };
}
