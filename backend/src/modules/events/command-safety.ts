import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { CommandReplayStatus, Prisma, type PrismaClient } from "@prisma/client";
import { ApiError, unavailable } from "../auth/errors.js";

const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const COMMAND_REPLAY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const PROTECTED_REPLAY_RETENTION_MS = 24 * 60 * 60 * 1_000;
const PROTECTED_RESPONSE_VERSION = 1;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

type JsonObject = Record<string, unknown>;

export interface ProtectedReplayKey {
  version: number;
  key: Uint8Array;
}

export interface IdempotentCommandInput {
  actorUserId: string;
  action: string;
  resourceKey: string;
  idempotencyKey: string;
  request: unknown;
  protectedResponseKey?: ProtectedReplayKey;
  now?: Date;
}

export interface CommandResponse<T extends JsonObject> {
  status: number;
  body: T;
}

export interface CommandOutcome<
  T extends JsonObject,
> extends CommandResponse<T> {
  replayed: boolean;
}

interface ReplayRow {
  id: string;
  requestFingerprint: string;
  status: CommandReplayStatus;
  responseStatus: number | null;
  responseBody: Prisma.JsonValue | null;
  protectedResponse: Uint8Array | null;
  protectedResponseKeyVersion: number | null;
  protectedReplayExpiresAt: Date | null;
}

export function parseRevisionPrecondition(value: string | undefined): number {
  const match = value?.match(/^"([1-9]\d*)"$/);
  const revision = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(revision)) {
    throw new ApiError(400, "VALIDATION", "Invalid If-Match header", {
      details: { field: "If-Match" },
    });
  }
  return revision;
}

export function parseIdempotencyKey(value: string | undefined): string {
  if (
    value === undefined ||
    value.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    value.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !/^[!-~]+$/.test(value)
  ) {
    throw new ApiError(400, "VALIDATION", "Invalid Idempotency-Key header", {
      details: { field: "Idempotency-Key" },
    });
  }
  return value;
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("JSON input must be acyclic");
    ancestors.add(value);
    const result = `[${value.map((item) => canonicalize(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError("JSON input must be acyclic");
    const object = value as Record<string, unknown>;
    ancestors.add(object);
    const result = `{${Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(object[key], ancestors)}`,
      )
      .join(",")}}`;
    ancestors.delete(object);
    return result;
  }
  throw new TypeError("Value is not JSON serializable");
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set());
}

export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function idempotencyKeyHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function replayAad(
  input: Pick<IdempotentCommandInput, "actorUserId" | "action" | "resourceKey">,
  keyHash: string,
  fingerprint: string,
  keyVersion: number,
): Buffer {
  return Buffer.from(
    canonicalJson({
      actor_user_id: input.actorUserId,
      action: input.action,
      resource_key: input.resourceKey,
      idempotency_key_hash: keyHash,
      request_fingerprint: fingerprint,
      key_version: keyVersion,
    }),
    "utf8",
  );
}

function validateProtectedKey(key: ProtectedReplayKey): void {
  if (
    !Number.isSafeInteger(key.version) ||
    key.version < 1 ||
    key.key.length !== 32
  )
    throw new TypeError("Protected replay key must be a versioned 32-byte key");
}

export function encryptProtectedResponse(
  body: JsonObject,
  key: ProtectedReplayKey,
  aad: Uint8Array,
): Uint8Array {
  validateProtectedKey(key);
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(body), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([PROTECTED_RESPONSE_VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function decryptProtectedResponse<T extends JsonObject>(
  envelope: Uint8Array,
  key: ProtectedReplayKey,
  aad: Uint8Array,
): T {
  validateProtectedKey(key);
  const bytes = Buffer.from(envelope);
  const minimumLength = 1 + GCM_IV_BYTES + GCM_TAG_BYTES + 1;
  if (bytes.length < minimumLength || bytes[0] !== PROTECTED_RESPONSE_VERSION)
    throw new Error("Invalid protected replay envelope");
  const ivStart = 1;
  const tagStart = ivStart + GCM_IV_BYTES;
  const bodyStart = tagStart + GCM_TAG_BYTES;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key.key,
    bytes.subarray(ivStart, tagStart),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(bytes.subarray(tagStart, bodyStart));
  const plaintext = Buffer.concat([
    decipher.update(bytes.subarray(bodyStart)),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

function validateScope(input: IdempotentCommandInput): void {
  if (!input.action.trim() || input.action.length > 80)
    throw new TypeError("Command action is invalid");
  if (!input.resourceKey.trim() || input.resourceKey.length > 120)
    throw new TypeError("Command resource scope is invalid");
  if (input.protectedResponseKey)
    validateProtectedKey(input.protectedResponseKey);
}

function validateCommandResponse<T extends JsonObject>(
  response: CommandResponse<T>,
): void {
  if (
    !Number.isInteger(response.status) ||
    response.status < 100 ||
    response.status > 599
  )
    throw new TypeError("Command response status is invalid");
  canonicalJson(response.body);
}

export async function executeIdempotentCommand<T extends JsonObject>(
  db: PrismaClient,
  input: IdempotentCommandInput,
  command: (tx: Prisma.TransactionClient) => Promise<CommandResponse<T>>,
): Promise<CommandOutcome<T>> {
  validateScope(input);
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  const keyHash = idempotencyKeyHash(idempotencyKey);
  const fingerprint = requestFingerprint(input.request);
  const now = input.now ?? new Date();
  const retentionMs = input.protectedResponseKey
    ? PROTECTED_REPLAY_RETENTION_MS
    : COMMAND_REPLAY_RETENTION_MS;
  const expiresAt = new Date(now.getTime() + retentionMs);

  // Expired protected results must be irrecoverable even if the attempted new
  // command later fails its current revision/state checks.
  await db.commandReplay.deleteMany({
    where: {
      actorUserId: input.actorUserId,
      action: input.action,
      resourceKey: input.resourceKey,
      idempotencyKeyHash: keyHash,
      expiresAt: { lte: now },
    },
  });

  return db.$transaction(
    async (tx) => {
      const replayId = randomUUID();
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "CommandReplay" (
          "id", "actorUserId", "action", "resourceKey",
          "idempotencyKeyHash", "requestFingerprint", "expiresAt"
        ) VALUES (
          ${replayId}::uuid, ${input.actorUserId}::uuid, ${input.action},
          ${input.resourceKey}, ${keyHash}, ${fingerprint}, ${expiresAt}
        )
        ON CONFLICT ("actorUserId", "action", "resourceKey", "idempotencyKeyHash")
        DO NOTHING
        RETURNING "id"
      `;

      if (inserted.length === 0) {
        const existing = await tx.commandReplay.findUnique({
          where: {
            actorUserId_action_resourceKey_idempotencyKeyHash: {
              actorUserId: input.actorUserId,
              action: input.action,
              resourceKey: input.resourceKey,
              idempotencyKeyHash: keyHash,
            },
          },
        });
        if (!existing) throw unavailable();
        const row = existing as ReplayRow;
        if (row.requestFingerprint !== fingerprint) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for a different request",
          );
        }
        if (
          row.status !== CommandReplayStatus.COMPLETED ||
          row.responseStatus === null
        )
          throw unavailable();

        if (row.protectedResponse !== null) {
          const key = input.protectedResponseKey;
          if (
            !key ||
            row.protectedResponseKeyVersion !== key.version ||
            row.protectedReplayExpiresAt === null ||
            row.protectedReplayExpiresAt <= now
          )
            throw unavailable();
          try {
            const body = decryptProtectedResponse<T>(
              row.protectedResponse,
              key,
              replayAad(input, keyHash, fingerprint, key.version),
            );
            return { status: row.responseStatus, body, replayed: true };
          } catch {
            throw unavailable();
          }
        }

        if (row.responseBody === null) throw unavailable();
        return {
          status: row.responseStatus,
          body: row.responseBody as T,
          replayed: true,
        };
      }

      const result = await command(tx);
      validateCommandResponse(result);
      const protectedKey = input.protectedResponseKey;
      if (protectedKey) {
        const encrypted = encryptProtectedResponse(
          result.body,
          protectedKey,
          replayAad(input, keyHash, fingerprint, protectedKey.version),
        );
        await tx.commandReplay.update({
          where: { id: replayId },
          data: {
            status: CommandReplayStatus.COMPLETED,
            responseStatus: result.status,
            protectedResponse: Uint8Array.from(encrypted),
            protectedResponseKeyVersion: protectedKey.version,
            protectedReplayExpiresAt: expiresAt,
            completedAt: now,
          },
        });
      } else {
        await tx.commandReplay.update({
          where: { id: replayId },
          data: {
            status: CommandReplayStatus.COMPLETED,
            responseStatus: result.status,
            responseBody: result.body as Prisma.InputJsonValue,
            completedAt: now,
          },
        });
      }
      return { ...result, replayed: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
