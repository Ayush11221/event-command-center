CREATE TYPE "ScanOutcome" AS ENUM ('ACCEPTED', 'REJECTED');
CREATE TYPE "AttendanceKind" AS ENUM ('CHECK_IN');
CREATE UNIQUE INDEX "Registration_eventId_id_key" ON "Registration" ("eventId", id);
CREATE UNIQUE INDEX "QRCredential_registrationId_id_key" ON "QRCredential" ("registrationId", id);
CREATE TABLE "ScanDecision" (
  id UUID PRIMARY KEY, "scanId" UUID NOT NULL,
  "eventId" UUID NOT NULL REFERENCES "Event"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "gateId" UUID NOT NULL,
  "operatorUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "registrationId" UUID, "credentialId" UUID,
  decision "ScanOutcome" NOT NULL, reason VARCHAR(40) NOT NULL,
  "decidedAt" TIMESTAMPTZ(3) NOT NULL, "correlationId" VARCHAR(64) NOT NULL,
  CONSTRAINT "ScanDecision_eventId_gateId_fkey" FOREIGN KEY ("eventId", "gateId") REFERENCES "Gate"("eventId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ScanDecision_eventId_registrationId_fkey" FOREIGN KEY ("eventId", "registrationId") REFERENCES "Registration"("eventId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ScanDecision_registrationId_credentialId_fkey" FOREIGN KEY ("registrationId", "credentialId") REFERENCES "QRCredential"("registrationId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ScanDecision_credential_reference" CHECK ("credentialId" IS NULL OR "registrationId" IS NOT NULL),
  CONSTRAINT "ScanDecision_acceptance" CHECK (
    (decision = 'ACCEPTED' AND reason = 'ACCEPTED' AND "registrationId" IS NOT NULL AND "credentialId" IS NOT NULL)
    OR (decision = 'REJECTED' AND reason IN ('INVALID_CREDENTIAL', 'EXPIRED_CREDENTIAL', 'CANCELLED_CREDENTIAL', 'ALREADY_CHECKED_IN', 'REGISTRATION_UNAVAILABLE'))
  )
);
CREATE UNIQUE INDEX "ScanDecision_operatorUserId_gateId_scanId_key" ON "ScanDecision" ("operatorUserId", "gateId", "scanId");
CREATE INDEX "ScanDecision_eventId_gateId_decidedAt_idx" ON "ScanDecision" ("eventId", "gateId", "decidedAt");
CREATE TABLE "AttendanceTransition" (
  id UUID PRIMARY KEY,
  "eventId" UUID NOT NULL REFERENCES "Event"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "gateId" UUID NOT NULL,
  "operatorUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "registrationId" UUID NOT NULL,
  "scanDecisionId" UUID NOT NULL REFERENCES "ScanDecision"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  kind "AttendanceKind" NOT NULL DEFAULT 'CHECK_IN', "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AttendanceTransition_eventId_gateId_fkey" FOREIGN KEY ("eventId", "gateId") REFERENCES "Gate"("eventId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceTransition_eventId_registrationId_fkey" FOREIGN KEY ("eventId", "registrationId") REFERENCES "Registration"("eventId", id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AttendanceTransition_registrationId_key" ON "AttendanceTransition" ("registrationId");
CREATE UNIQUE INDEX "AttendanceTransition_scanDecisionId_key" ON "AttendanceTransition" ("scanDecisionId");
CREATE INDEX "AttendanceTransition_eventId_acceptedAt_idx" ON "AttendanceTransition" ("eventId", "acceptedAt");

-- The immutable ledger is the source of the Slice 4 cancellation barrier.
CREATE FUNCTION checkin_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "ScanDecision"%ROWTYPE;
BEGIN
  SELECT * INTO source FROM "ScanDecision" WHERE id = NEW."scanDecisionId";
  IF source.decision IS DISTINCT FROM 'ACCEPTED'::"ScanOutcome"
    OR source."eventId" IS DISTINCT FROM NEW."eventId"
    OR source."gateId" IS DISTINCT FROM NEW."gateId"
    OR source."operatorUserId" IS DISTINCT FROM NEW."operatorUserId"
    OR source."registrationId" IS DISTINCT FROM NEW."registrationId"
    OR source."decidedAt" IS DISTINCT FROM NEW."acceptedAt" THEN
    RAISE EXCEPTION 'Check-in requires its matching accepted scan';
  END IF;
  UPDATE "Registration" SET "firstAcceptedCheckInAt" = NEW."acceptedAt"
    WHERE id = NEW."registrationId" AND state = 'REGISTERED' AND "firstAcceptedCheckInAt" IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration cannot be checked in'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AttendanceTransition_guard" BEFORE INSERT ON "AttendanceTransition"
  FOR EACH ROW EXECUTE FUNCTION checkin_transition_guard();
CREATE FUNCTION scan_requires_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision = 'ACCEPTED' AND NOT EXISTS (
    SELECT 1 FROM "AttendanceTransition" WHERE "scanDecisionId" = NEW.id
  ) THEN RAISE EXCEPTION 'Accepted scan requires a check-in'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "ScanDecision_requires_attendance" AFTER INSERT ON "ScanDecision"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION scan_requires_attendance();
CREATE FUNCTION preserve_scan_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Scan and attendance history is append-only'; END $$;
CREATE TRIGGER "ScanDecision_immutable" BEFORE UPDATE OR DELETE ON "ScanDecision"
  FOR EACH ROW EXECUTE FUNCTION preserve_scan_history();
CREATE TRIGGER "AttendanceTransition_immutable" BEFORE UPDATE OR DELETE ON "AttendanceTransition"
  FOR EACH ROW EXECUTE FUNCTION preserve_scan_history();
CREATE FUNCTION preserve_first_checkin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."firstAcceptedCheckInAt" IS NOT NULL AND NEW."firstAcceptedCheckInAt" IS DISTINCT FROM OLD."firstAcceptedCheckInAt"
  THEN RAISE EXCEPTION 'First accepted check-in cannot be changed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Registration_preserve_checkin" BEFORE UPDATE ON "Registration"
  FOR EACH ROW EXECUTE FUNCTION preserve_first_checkin();
