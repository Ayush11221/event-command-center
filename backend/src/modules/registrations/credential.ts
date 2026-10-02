import { createHmac, randomBytes } from "node:crypto";
import {
  encryptProtectedResponse,
  decryptProtectedResponse,
} from "../events/command-safety.js";

export function credentialKeys(root: Uint8Array) {
  if (root.length !== 32) throw new TypeError("Invalid credential root key");
  const derive = (purpose: string) => ({
    version: 1,
    key: createHmac("sha256", root).update(purpose).digest(),
  });
  return {
    verifier: derive("eoc.qr.verifier.v1"),
    storage: derive("eoc.qr.owner-representation.v1"),
  };
}
export function credentialVerifier(token: string, root: Uint8Array): string {
  if (
    !/^qr1\.[A-Za-z0-9_-]{43}$/.test(token) ||
    Buffer.from(token.slice(4), "base64url").toString("base64url") !==
      token.slice(4)
  )
    throw new TypeError("Invalid credential");
  return createHmac("sha256", credentialKeys(root).verifier.key)
    .update(token)
    .digest("hex");
}
const aad = (registrationId: string) =>
  Buffer.from(`eoc.qr.owner.v1:${registrationId}`);
export function issueCredential(registrationId: string, root: Uint8Array) {
  const token = `qr1.${randomBytes(32).toString("base64url")}`;
  return {
    verifierHash: credentialVerifier(token, root),
    keyVersion: 1,
    protectedRepresentation: Uint8Array.from(
      encryptProtectedResponse(
        { token },
        credentialKeys(root).storage,
        aad(registrationId),
      ),
    ),
  };
}
export function recoverCredential(
  registrationId: string,
  bytes: Uint8Array,
  root: Uint8Array,
) {
  const { token } = decryptProtectedResponse<{ token: string }>(
    bytes,
    credentialKeys(root).storage,
    aad(registrationId),
  );
  credentialVerifier(token, root);
  return token;
}
