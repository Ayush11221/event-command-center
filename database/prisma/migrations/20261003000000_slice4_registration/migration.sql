CREATE TYPE "RegistrationState" AS ENUM ('REGISTERED', 'CANCELLED');
CREATE TABLE "GuestIdentity" (
  "id" UUID PRIMARY KEY, "lookupHash" CHAR(64) NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuestIdentity_hash_format" CHECK ("lookupHash" ~ '^[0-9a-f]{64}$')
);
CREATE TABLE "Registration" (
  "id" UUID PRIMARY KEY,
  "eventId" UUID NOT NULL REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "guestIdentityId" UUID REFERENCES "GuestIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "state" "RegistrationState" NOT NULL DEFAULT 'REGISTERED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMPTZ(3),
  "cancelledByUserId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cancelledActorKind" "AuditActorKind",
  "firstAcceptedCheckInAt" TIMESTAMPTZ(3),
  CONSTRAINT "Registration_owner_xor" CHECK (("userId" IS NULL) <> ("guestIdentityId" IS NULL)),
  CONSTRAINT "Registration_cancel_before_checkin" CHECK (state <> 'CANCELLED' OR "firstAcceptedCheckInAt" IS NULL),
  CONSTRAINT "Registration_cancellation_consistent" CHECK (
    (state = 'REGISTERED' AND "cancelledAt" IS NULL AND "cancelledActorKind" IS NULL AND "cancelledByUserId" IS NULL)
    OR (state = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledActorKind" IS NOT NULL
      AND (("cancelledActorKind" = 'ACCOUNT' AND "cancelledByUserId" IS NOT NULL)
        OR ("cancelledActorKind" = 'GUEST' AND "cancelledByUserId" IS NULL)))
  )
);
CREATE UNIQUE INDEX "Registration_active_user_event_key" ON "Registration"("eventId", "userId") WHERE state = 'REGISTERED';
CREATE UNIQUE INDEX "Registration_active_guest_event_key" ON "Registration"("eventId", "guestIdentityId") WHERE state = 'REGISTERED';
CREATE INDEX "Registration_eventId_state_idx" ON "Registration"("eventId", state);
CREATE INDEX "Registration_userId_eventId_createdAt_idx" ON "Registration"("userId", "eventId", "createdAt" DESC);
CREATE INDEX "Registration_guestIdentityId_eventId_createdAt_idx" ON "Registration"("guestIdentityId", "eventId", "createdAt" DESC);
CREATE TABLE "QRCredential" (
  "id" UUID PRIMARY KEY,
  "registrationId" UUID NOT NULL REFERENCES "Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "verifierHash" CHAR(64) NOT NULL UNIQUE,
  "keyVersion" SMALLINT NOT NULL DEFAULT 1,
  "protectedRepresentation" BYTEA,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3), "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "QRCredential_protected_active" CHECK ("revokedAt" IS NOT NULL OR "protectedRepresentation" IS NOT NULL),
  CONSTRAINT "QRCredential_verifier_format" CHECK ("verifierHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "QRCredential_key_positive" CHECK ("keyVersion" > 0),
  CONSTRAINT "QRCredential_expiry_order" CHECK ("expiresAt" IS NULL OR "expiresAt" > "issuedAt")
);
CREATE UNIQUE INDEX "QRCredential_active_registration_key" ON "QRCredential"("registrationId") WHERE "revokedAt" IS NULL;
CREATE INDEX "QRCredential_registrationId_idx" ON "QRCredential"("registrationId");
ALTER TABLE "CommandReplay" ALTER COLUMN "actorUserId" DROP NOT NULL;
ALTER TABLE "CommandReplay" ADD COLUMN "actorGuestIdentityId" UUID REFERENCES "GuestIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommandReplay" ADD CONSTRAINT "CommandReplay_actor_xor" CHECK (("actorUserId" IS NULL) <> ("actorGuestIdentityId" IS NULL));
CREATE UNIQUE INDEX "CommandReplay_guest_action_resource_key_key" ON "CommandReplay"("actorGuestIdentityId", action, "resourceKey", "idempotencyKeyHash");
