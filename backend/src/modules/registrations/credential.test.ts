import { describe, expect, it } from "vitest";
import {
  credentialVerifier,
  issueCredential,
  recoverCredential,
} from "./credential.js";
const root = Buffer.alloc(32, 42);
describe("QR protected representation", () => {
  it("generates random opaque tokens with no identity data and a keyed verifier", () => {
    const one = issueCredential("registration-a", root),
      two = issueCredential("registration-a", root);
    const token = recoverCredential(
      "registration-a",
      one.protectedRepresentation,
      root,
    );
    expect(token).toMatch(/^qr1\.[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(
      recoverCredential("registration-a", two.protectedRepresentation, root),
    );
    expect(one.verifierHash).toBe(credentialVerifier(token, root));
    expect(
      Buffer.from(one.protectedRepresentation).includes(Buffer.from(token)),
    ).toBe(false);
    expect(credentialVerifier(token, Buffer.alloc(32, 43))).not.toBe(
      one.verifierHash,
    );
  });
  it("rejects malformed and noncanonical tokens", () => {
    for (const token of [
      "",
      "qr1.foo",
      `qr1.${"A".repeat(42)}B`,
      "email@example.com",
    ])
      expect(() => credentialVerifier(token, root)).toThrow();
  });
  it("binds encryption to registration, key and authenticated bytes", () => {
    const one = issueCredential("a", root),
      tampered = Uint8Array.from(one.protectedRepresentation);
    tampered[tampered.length - 1] ^= 1;
    expect(() =>
      recoverCredential("b", one.protectedRepresentation, root),
    ).toThrow();
    expect(() =>
      recoverCredential("a", one.protectedRepresentation, Buffer.alloc(32, 43)),
    ).toThrow();
    expect(() => recoverCredential("a", tampered, root)).toThrow();
  });
});
