import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scanFingerprint, scanInput } from "./input.js";
const valid = {
  scan_id: randomUUID(),
  event_id: randomUUID(),
  gate_id: randomUUID(),
  credential: "opaque",
};
describe("scan input boundary", () => {
  it("accepts only the fixed check-in request and canonicalizes IDs", () => {
    expect(
      scanInput(
        { ...valid, event_id: valid.event_id.toUpperCase() },
        valid.scan_id,
      ),
    ).toEqual(valid);
  });
  it.each([
    null,
    [],
    "proof",
    {},
    { ...valid, role: "GATE_SECURITY" },
    { ...valid, direction: "EXIT" },
    { ...valid, direction: null },
    { ...valid, registration_id: randomUUID() },
    { ...valid, event_id: "bad" },
    { ...valid, scan_id: 3 },
    { ...valid, gate_id: null },
    { ...valid, credential: "" },
    { ...valid, credential: 1 },
    { ...valid, credential: "a".repeat(129) },
  ])("rejects malformed or privileged fields %#", (body) => {
    expect(() => scanInput(body, valid.scan_id)).toThrow();
  });
  it.each([undefined, "short", randomUUID(), valid.scan_id.toUpperCase()])(
    "requires the header to equal the canonical scan ID %#",
    (key) => {
      expect(() => scanInput(valid, key)).toThrow();
    },
  );
  it("fingerprints proof with a separate HMAC without retaining its value", () => {
    const root = Buffer.alloc(32, 10),
      result = scanFingerprint(valid, root);
    expect(result).not.toHaveProperty("credential");
    expect(result.credential_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toEqual(scanFingerprint(valid, root));
    expect(result).not.toEqual(
      scanFingerprint({ ...valid, credential: "other" }, root),
    );
    expect(result).not.toEqual(scanFingerprint(valid, Buffer.alloc(32, 11)));
    expect(() => scanFingerprint(valid, Buffer.alloc(1))).toThrow();
  });
  it("accepts exit, preserves legacy entry fingerprints and distinguishes directions", () => {
    expect(
      scanInput({ ...valid, direction: "CHECK_IN" }, valid.scan_id),
    ).toEqual(valid);
    const exit = scanInput({ ...valid, direction: "CHECK_OUT" }, valid.scan_id);
    expect(exit.direction).toBe("CHECK_OUT");
    expect(scanFingerprint(exit, Buffer.alloc(32, 10))).not.toEqual(
      scanFingerprint(valid, Buffer.alloc(32, 10)),
    );
  });
});
