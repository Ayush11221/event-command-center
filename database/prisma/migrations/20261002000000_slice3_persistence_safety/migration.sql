-- Slice 3 persistence and shared command-safety foundation.
-- This is a forward-only extension of the two Slice 2 migrations.

-- CreateEnum
CREATE TYPE "EventState" AS ENUM ('DRAFT', 'PUBLISHED', 'LIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CommandReplayStatus" AS ENUM ('PENDING', 'COMPLETED');

-- ExtendEvent
ALTER TABLE "Event"
  ADD COLUMN "name" VARCHAR(200),
  ADD COLUMN "description" TEXT,
  ADD COLUMN "publicLocation" VARCHAR(500),
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "category" VARCHAR(100),
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "startAt" TIMESTAMPTZ(3),
  ADD COLUMN "endAt" TIMESTAMPTZ(3),
  ADD COLUMN "timeZone" VARCHAR(100),
  ADD COLUMN "visibility" "EventVisibility",
  ADD COLUMN "registrationCapacity" INTEGER,
  ADD COLUMN "registrationOpensAt" TIMESTAMPTZ(3),
  ADD COLUMN "registrationClosesAt" TIMESTAMPTZ(3),
  ADD COLUMN "registrationCancellationCutoffAt" TIMESTAMPTZ(3),
  ADD COLUMN "registrationManuallyClosed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "checkoutEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "publishedAt" TIMESTAMPTZ(3);

-- Existing Slice 2 fixtures are synthetic Drafts without names. Preserve them
-- as Drafts and give them a deliberately neutral, editable management name.
UPDATE "Event" SET "name" = 'Untitled event' WHERE "name" IS NULL;
ALTER TABLE "Event" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "Event" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "Event"
  ALTER COLUMN "state" TYPE "EventState"
  USING ("state"::text::"EventState");
ALTER TABLE "Event" ALTER COLUMN "state" SET DEFAULT 'DRAFT';

ALTER TABLE "Event" ADD CONSTRAINT "Event_name_nonblank"
  CHECK (btrim("name") <> '');
ALTER TABLE "Event" ADD CONSTRAINT "Event_schedule_complete_and_ordered"
  CHECK (
    ("startAt" IS NULL AND "endAt" IS NULL)
    OR ("startAt" IS NOT NULL AND "endAt" IS NOT NULL AND "endAt" > "startAt")
  );
ALTER TABLE "Event" ADD CONSTRAINT "Event_registration_capacity_positive"
  CHECK ("registrationCapacity" IS NULL OR "registrationCapacity" > 0);
ALTER TABLE "Event" ADD CONSTRAINT "Event_registration_window_ordered"
  CHECK (
    "registrationOpensAt" IS NULL
    OR "registrationClosesAt" IS NULL
    OR "registrationClosesAt" > "registrationOpensAt"
  );
ALTER TABLE "Event" ADD CONSTRAINT "Event_revision_positive"
  CHECK ("revision" > 0);

-- CreateTable
CREATE TABLE "PrivateAccessLink" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "verifierHash" CHAR(64) NOT NULL,
  "verifierKeyVersion" SMALLINT NOT NULL DEFAULT 1,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  "replacesLinkId" UUID,

  CONSTRAINT "PrivateAccessLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrivateAccessLink_verifier_format" CHECK ("verifierHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "PrivateAccessLink_verifier_key_version_positive" CHECK ("verifierKeyVersion" > 0),
  CONSTRAINT "PrivateAccessLink_revoked_after_issue" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "issuedAt"),
  CONSTRAINT "PrivateAccessLink_not_self_replacement" CHECK ("replacesLinkId" IS NULL OR "replacesLinkId" <> "id")
);

-- CreateTable
CREATE TABLE "CommandReplay" (
  "id" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "resourceKey" VARCHAR(120) NOT NULL,
  "idempotencyKeyHash" CHAR(64) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "status" "CommandReplayStatus" NOT NULL DEFAULT 'PENDING',
  "responseStatus" SMALLINT,
  "responseBody" JSONB,
  "protectedResponse" BYTEA,
  "protectedResponseKeyVersion" SMALLINT,
  "protectedReplayExpiresAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "CommandReplay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommandReplay_action_nonblank" CHECK (btrim("action") <> ''),
  CONSTRAINT "CommandReplay_resource_nonblank" CHECK (btrim("resourceKey") <> ''),
  CONSTRAINT "CommandReplay_key_hash_format" CHECK ("idempotencyKeyHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CommandReplay_fingerprint_format" CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CommandReplay_expiry_after_creation" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "CommandReplay_completion_after_creation" CHECK ("completedAt" IS NULL OR "completedAt" >= "createdAt"),
  CONSTRAINT "CommandReplay_response_status_range" CHECK ("responseStatus" IS NULL OR "responseStatus" BETWEEN 100 AND 599),
  CONSTRAINT "CommandReplay_protected_key_version_positive" CHECK ("protectedResponseKeyVersion" IS NULL OR "protectedResponseKeyVersion" > 0),
  CONSTRAINT "CommandReplay_protected_replay_window" CHECK (
    "protectedReplayExpiresAt" IS NULL
    OR (
      "protectedReplayExpiresAt" > "createdAt"
      AND "protectedReplayExpiresAt" <= "createdAt" + INTERVAL '24 hours'
      AND "protectedReplayExpiresAt" <= "expiresAt"
    )
  ),
  CONSTRAINT "CommandReplay_state_shape" CHECK (
    (
      "status" = 'PENDING'
      AND "responseStatus" IS NULL
      AND "responseBody" IS NULL
      AND "protectedResponse" IS NULL
      AND "protectedResponseKeyVersion" IS NULL
      AND "protectedReplayExpiresAt" IS NULL
      AND "completedAt" IS NULL
    )
    OR
    (
      "status" = 'COMPLETED'
      AND "responseStatus" IS NOT NULL
      AND "completedAt" IS NOT NULL
      AND (
        (
          "responseBody" IS NOT NULL
          AND "protectedResponse" IS NULL
          AND "protectedResponseKeyVersion" IS NULL
          AND "protectedReplayExpiresAt" IS NULL
        )
        OR
        (
          "responseBody" IS NULL
          AND "protectedResponse" IS NOT NULL
          AND "protectedResponseKeyVersion" IS NOT NULL
          AND "protectedReplayExpiresAt" IS NOT NULL
        )
      )
    )
  )
);

-- Replace the Slice 2 owner lookup with the exact management cursor order.
DROP INDEX "Event_ownerUserId_idx";
CREATE INDEX "Event_ownerUserId_createdAt_id_idx"
  ON "Event"("ownerUserId", "createdAt" DESC, "id" DESC);

-- Current assigned-Admin lookup. The broader Slice 2 indexes remain intact.
CREATE INDEX "EventRoleAssignment_active_admin_user_event_idx"
  ON "EventRoleAssignment"("userId", "eventId")
  WHERE "role" = 'EVENT_ADMIN' AND "revokedAt" IS NULL;

-- Public discovery cursor order. The filter excludes incomplete/non-public rows.
CREATE INDEX "Event_public_catalog_idx"
  ON "Event"("publishedAt" DESC, "id" DESC)
  WHERE "state" = 'PUBLISHED' AND "visibility" = 'PUBLIC';

CREATE UNIQUE INDEX "PrivateAccessLink_verifierHash_key"
  ON "PrivateAccessLink"("verifierHash");
CREATE UNIQUE INDEX "PrivateAccessLink_replacesLinkId_key"
  ON "PrivateAccessLink"("replacesLinkId");
CREATE UNIQUE INDEX "PrivateAccessLink_one_active_per_event"
  ON "PrivateAccessLink"("eventId") WHERE "revokedAt" IS NULL;
CREATE INDEX "PrivateAccessLink_eventId_issuedAt_idx"
  ON "PrivateAccessLink"("eventId", "issuedAt" DESC);

CREATE UNIQUE INDEX "CommandReplay_actor_action_resource_key_key"
  ON "CommandReplay"("actorUserId", "action", "resourceKey", "idempotencyKeyHash");
CREATE INDEX "CommandReplay_expiresAt_idx" ON "CommandReplay"("expiresAt");

-- AddForeignKey
ALTER TABLE "PrivateAccessLink" ADD CONSTRAINT "PrivateAccessLink_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivateAccessLink" ADD CONSTRAINT "PrivateAccessLink_replacesLinkId_fkey"
  FOREIGN KEY ("replacesLinkId") REFERENCES "PrivateAccessLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommandReplay" ADD CONSTRAINT "CommandReplay_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
