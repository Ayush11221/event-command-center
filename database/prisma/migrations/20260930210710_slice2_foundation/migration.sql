-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "ProofPurpose" AS ENUM ('ACCOUNT', 'GUEST_OWNERSHIP');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('EVENT_ADMIN', 'GATE_SECURITY', 'VOLUNTEER');

-- CreateEnum
CREATE TYPE "AuditActorKind" AS ENUM ('ACCOUNT', 'GUEST', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "organizerCapable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifiedContact" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ContactType" NOT NULL,
    "lookupHash" CHAR(64) NOT NULL,
    "encrypted" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VerifiedContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "contactType" "ContactType" NOT NULL,
    "contactLookupHash" CHAR(64) NOT NULL,
    "purpose" "ProofPurpose" NOT NULL,
    "contextEventId" UUID,
    "codeHash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSentAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gate" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,

    CONSTRAINT "Gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRoleAssignment" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,
    "gateId" UUID,
    "scopeKey" VARCHAR(40) NOT NULL,
    "grantedByUserId" UUID NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedByUserId" UUID,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EventRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorKind" "AuditActorKind" NOT NULL,
    "actorUserId" UUID,
    "eventId" UUID,
    "targetUserId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "correlationId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerifiedContact_userId_idx" ON "VerifiedContact"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedContact_type_lookupHash_key" ON "VerifiedContact"("type", "lookupHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "OtpChallenge_contactType_contactLookupHash_createdAt_idx" ON "OtpChallenge"("contactType", "contactLookupHash", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Event_ownerUserId_idx" ON "Event"("ownerUserId");

-- CreateIndex
CREATE INDEX "Gate_eventId_idx" ON "Gate"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Gate_eventId_id_key" ON "Gate"("eventId", "id");

-- CreateIndex
CREATE INDEX "EventRoleAssignment_userId_eventId_revokedAt_idx" ON "EventRoleAssignment"("userId", "eventId", "revokedAt");

-- CreateIndex
CREATE INDEX "EventRoleAssignment_eventId_role_revokedAt_idx" ON "EventRoleAssignment"("eventId", "role", "revokedAt");

-- CreateIndex
CREATE INDEX "EventRoleAssignment_eventId_gateId_revokedAt_idx" ON "EventRoleAssignment"("eventId", "gateId", "revokedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_eventId_createdAt_idx" ON "AuditEvent"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "VerifiedContact" ADD CONSTRAINT "VerifiedContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gate" ADD CONSTRAINT "Gate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRoleAssignment" ADD CONSTRAINT "EventRoleAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRoleAssignment" ADD CONSTRAINT "EventRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRoleAssignment" ADD CONSTRAINT "EventRoleAssignment_eventId_gateId_fkey" FOREIGN KEY ("eventId", "gateId") REFERENCES "Gate"("eventId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRoleAssignment" ADD CONSTRAINT "EventRoleAssignment_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRoleAssignment" ADD CONSTRAINT "EventRoleAssignment_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep Slice 2 security and authorization invariants in PostgreSQL, not only Prisma.
ALTER TABLE "Session" ADD CONSTRAINT "Session_expiry_after_creation" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_attempt_bounds" CHECK ("attempts" BETWEEN 0 AND 5);
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_expiry_after_creation" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "EventRoleAssignment" ADD CONSTRAINT "EventRoleAssignment_scope" CHECK (
  ("role" = 'GATE_SECURITY' AND "gateId" IS NOT NULL AND "scopeKey" = "gateId"::text)
  OR ("role" <> 'GATE_SECURITY' AND "gateId" IS NULL AND "scopeKey" = 'EVENT')
);
ALTER TABLE "EventRoleAssignment" ADD CONSTRAINT "EventRoleAssignment_revoke_evidence" CHECK (
  ("revokedAt" IS NULL AND "revokedByUserId" IS NULL)
  OR ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL)
);
CREATE UNIQUE INDEX "EventRoleAssignment_active_unique" ON "EventRoleAssignment"("eventId", "userId", "role", "scopeKey") WHERE "revokedAt" IS NULL;

-- Audit evidence is append-only even if application code later makes a mistake.
CREATE FUNCTION "reject_audit_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;
CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_audit_change"();
