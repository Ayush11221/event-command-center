import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { ContactType } from "@prisma/client";

export interface Contact {
  type: ContactType;
  value: string;
  lookupHash: string;
}

export function normalizeContact(
  type: ContactType,
  raw: string,
  key: Buffer,
): Contact {
  if (typeof raw !== "string" || raw.length > 320) {
    throw new Error("Invalid contact");
  }
  let value: string;
  if (type === ContactType.EMAIL) {
    value = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
      throw new Error("Invalid email");
    }
  } else {
    value = raw.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(value)) {
      throw new Error("Invalid phone");
    }
  }
  const lookupHash = createHmac("sha256", key)
    .update(`${type}:${value}`)
    .digest("hex");
  return { type, value, lookupHash };
}

export function encryptContact(value: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

export function decryptContact(value: string, key: Buffer): string {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < 29) throw new Error("Invalid encrypted contact");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
