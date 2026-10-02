import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  decryptProtectedResponse,
  encryptProtectedResponse,
  parseIdempotencyKey,
  parseRevisionPrecondition,
  requestFingerprint,
} from "./command-safety.js";
import {
  generatePrivateLinkProof,
  privateLinkVerifier,
  privateLinkVerifierMatches,
} from "./private-links.js";

describe("Slice 3 command safety", () => {
  it("accepts only the exact quoted positive revision form", () => {
    expect(parseRevisionPrecondition('"1"')).toBe(1);
    expect(parseRevisionPrecondition('"9007199254740991"')).toBe(
      Number.MAX_SAFE_INTEGER,
    );

    for (const value of [undefined, "1", 'W/"1"', '"0"', '"01"', '"-1"']) {
      expect(() => parseRevisionPrecondition(value)).toThrowError(
        expect.objectContaining({
          code: "VALIDATION",
          details: { field: "If-Match" },
        }),
      );
    }
  });

  it("bounds idempotency keys and excludes whitespace/control characters", () => {
    const key = "command-key-1234";
    expect(parseIdempotencyKey(key)).toBe(key);

    for (const value of [
      undefined,
      "too-short",
      "contains whitespace",
      `line-break-value\n123`,
      "x".repeat(201),
    ]) {
      expect(() => parseIdempotencyKey(value)).toThrowError(
        expect.objectContaining({ code: "VALIDATION" }),
      );
    }
  });

  it("canonicalizes JSON object keys for stable request fingerprints", () => {
    expect(canonicalJson({ z: [2, { b: true, a: null }], a: "value" })).toBe(
      '{"a":"value","z":[2,{"a":null,"b":true}]}',
    );
    expect(requestFingerprint({ a: 1, b: 2 })).toBe(
      requestFingerprint({ b: 2, a: 1 }),
    );
    expect(requestFingerprint({ a: 1 })).not.toBe(requestFingerprint({ a: 2 }));
  });

  it("encrypts protected replay material with authenticated context", () => {
    const key = { version: 3, key: randomBytes(32) };
    const body = {
      event_id: "event-1",
      access_url: "https://events.test/private#access=secret-proof",
    };
    const aad = Buffer.from("actor/action/resource/fingerprint", "utf8");
    const encrypted = encryptProtectedResponse(body, key, aad);

    expect(Buffer.from(encrypted).includes(Buffer.from("secret-proof"))).toBe(
      false,
    );
    expect(decryptProtectedResponse(encrypted, key, aad)).toEqual(body);
    expect(() =>
      decryptProtectedResponse(encrypted, key, Buffer.from("wrong-context")),
    ).toThrow();
    expect(() =>
      decryptProtectedResponse(
        encrypted,
        { version: 3, key: randomBytes(32) },
        aad,
      ),
    ).toThrow();
  });

  it("generates opaque PRIVATE proofs and stores only keyed verifiers", () => {
    const proof = generatePrivateLinkProof();
    const key = { version: 1, key: randomBytes(32) };
    const verifier = privateLinkVerifier(proof, key);

    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier).not.toContain(proof);
    expect(privateLinkVerifierMatches(proof, verifier, key)).toBe(true);
    expect(
      privateLinkVerifierMatches(generatePrivateLinkProof(), verifier, key),
    ).toBe(false);
    expect(
      privateLinkVerifierMatches(proof, verifier, {
        version: 1,
        key: randomBytes(32),
      }),
    ).toBe(false);
  });
});
