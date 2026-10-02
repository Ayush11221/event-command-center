import { describe, expect, it } from "vitest";
import { parsePrivateIssueBody } from "./issue-private-link.js";
import {
  generatePrivateLinkProof,
  privateAccessUrl,
  privateLinkKeys,
  privateLinkVerifier,
  privateLinkVerifierMatches,
} from "./private-links.js";
import { parsePrivateAuthorization } from "../discovery/service.js";

describe("V8 private issuance and bearer primitives", () => {
  it("accepts only the documented empty body", () => {
    expect(parsePrivateIssueBody({})).toEqual({});
  });
  it.each([
    null,
    undefined,
    [],
    "proof",
    { proof: "secret" },
    { event_id: "guess" },
  ])("rejects unsupported issuance input %j", (body) => {
    expect(() => parsePrivateIssueBody(body)).toThrow(
      expect.objectContaining({ code: "VALIDATION", status: 400 }),
    );
  });
  it("generates independent 256-bit opaque proofs and verifies without storing plaintext", () => {
    const keys = privateLinkKeys(Buffer.alloc(32, 8));
    const proofs = new Set(
      Array.from({ length: 100 }, generatePrivateLinkProof),
    );
    expect(proofs.size).toBe(100);
    for (const proof of proofs) {
      expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const hash = privateLinkVerifier(proof, keys.verifier);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).not.toContain(proof);
      expect(privateLinkVerifierMatches(proof, hash, keys.verifier)).toBe(true);
      expect(
        privateLinkVerifierMatches(
          generatePrivateLinkProof(),
          hash,
          keys.verifier,
        ),
      ).toBe(false);
    }
  });
  it("separates verifier and replay keys from the root and rejects invalid root length", () => {
    const root = Buffer.alloc(32, 8),
      keys = privateLinkKeys(root);
    expect(keys.verifier.key).not.toEqual(root);
    expect(keys.replay.key).not.toEqual(root);
    expect(keys.verifier.key).not.toEqual(keys.replay.key);
    expect(privateLinkKeys(root)).toEqual(keys);
    expect(() => privateLinkKeys(Buffer.alloc(31))).toThrow();
  });
  it("uses only the configured origin and approved fragment URL", () => {
    const proof = generatePrivateLinkProof();
    expect(privateAccessUrl("https://events.example", proof)).toBe(
      `https://events.example/private#access=${proof}`,
    );
    expect(privateAccessUrl("http://127.0.0.1:5173", proof)).toContain(
      "/private#access=",
    );
  });
  it.each([
    "http://events.example",
    "https://events.example/path",
    "https://events.example?secret=x",
    "https://user:secret@events.example",
    "garbage",
  ])("rejects unsafe configured origin %s", (origin) => {
    expect(() =>
      privateAccessUrl(origin, generatePrivateLinkProof()),
    ).toThrow();
  });
  it("accepts the exact PrivateLink scheme without OTP/account proof", () => {
    const proof = generatePrivateLinkProof();
    expect(parsePrivateAuthorization(`PrivateLink ${proof}`)).toBe(proof);
  });
  it.each([
    undefined,
    "",
    "Bearer secret",
    "PrivateLink short",
    `PrivateLink ${"a".repeat(44)}`,
    `PrivateLink ${"a".repeat(42)}!`,
    `privatelink ${"a".repeat(43)}`,
    `PrivateLink  ${"a".repeat(43)}`,
  ])("collapses malformed proof %s to the same safe failure", (header) => {
    expect(() => parsePrivateAuthorization(header)).toThrow(
      expect.objectContaining({
        status: 404,
        code: "PRIVATE_UNAVAILABLE",
        message: "Private event unavailable",
      }),
    );
  });
});
