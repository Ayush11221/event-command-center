-- Preserve existing entry decisions, first-arrival evidence and replay identity.
ALTER TYPE "AttendanceKind" ADD VALUE 'CHECK_OUT';
ALTER TABLE "ScanDecision" ADD COLUMN direction "AttendanceKind" NOT NULL DEFAULT 'CHECK_IN';
ALTER TABLE "AttendanceTransition" ADD COLUMN sequence INTEGER NOT NULL DEFAULT 1;
DROP INDEX "AttendanceTransition_registrationId_key";
CREATE UNIQUE INDEX "AttendanceTransition_registrationId_sequence_key"
  ON "AttendanceTransition" ("registrationId", sequence);
ALTER TABLE "AttendanceTransition" ADD CONSTRAINT "AttendanceTransition_positive_sequence" CHECK (sequence > 0);
ALTER TABLE "ScanDecision" DROP CONSTRAINT "ScanDecision_acceptance";
ALTER TABLE "ScanDecision" ADD CONSTRAINT "ScanDecision_acceptance" CHECK (
  (decision = 'ACCEPTED' AND reason = 'ACCEPTED' AND "registrationId" IS NOT NULL AND "credentialId" IS NOT NULL)
  OR (decision = 'REJECTED' AND reason IN (
    'INVALID_CREDENTIAL', 'EXPIRED_CREDENTIAL', 'CANCELLED_CREDENTIAL',
    'ALREADY_CHECKED_IN', 'REGISTRATION_UNAVAILABLE', 'CHECKOUT_DISABLED',
    'NOT_CHECKED_IN', 'ALREADY_CHECKED_OUT'
  ))
);

CREATE OR REPLACE FUNCTION checkin_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "ScanDecision"%ROWTYPE;
DECLARE registration "Registration"%ROWTYPE;
DECLARE previous "AttendanceTransition"%ROWTYPE;
DECLARE event "Event"%ROWTYPE;
BEGIN
  -- Serialize all gates and direct ledger inserts for this event before reading state.
  SELECT * INTO event FROM "Event" WHERE id = NEW."eventId" FOR UPDATE;
  SELECT * INTO registration FROM "Registration" WHERE id = NEW."registrationId" FOR UPDATE;
  SELECT * INTO source FROM "ScanDecision" WHERE id = NEW."scanDecisionId";
  IF source.decision IS DISTINCT FROM 'ACCEPTED'::"ScanOutcome"
    OR source."eventId" IS DISTINCT FROM NEW."eventId"
    OR source."gateId" IS DISTINCT FROM NEW."gateId"
    OR source."operatorUserId" IS DISTINCT FROM NEW."operatorUserId"
    OR source."registrationId" IS DISTINCT FROM NEW."registrationId"
    OR source."decidedAt" IS DISTINCT FROM NEW."acceptedAt"
    OR source.direction IS DISTINCT FROM NEW.kind
    OR registration.state IS DISTINCT FROM 'REGISTERED'::"RegistrationState" THEN
    RAISE EXCEPTION 'Attendance requires its matching accepted scan and active registration';
  END IF;
  SELECT * INTO previous FROM "AttendanceTransition"
    WHERE "registrationId" = NEW."registrationId" ORDER BY sequence DESC LIMIT 1;
  NEW.sequence := COALESCE(previous.sequence, 0) + 1;
  IF NEW.kind::text = 'CHECK_OUT' THEN
    IF NOT event."checkoutEnabled" OR event.state::text <> 'LIVE'
      OR previous.kind IS DISTINCT FROM 'CHECK_IN'::"AttendanceKind" THEN
      RAISE EXCEPTION 'Exit requires enabled checkout and an inside participant';
    END IF;
  ELSIF previous.kind::text = 'CHECK_IN' THEN
    RAISE EXCEPTION 'Participant is already inside';
  ELSIF previous.kind::text = 'CHECK_OUT' THEN
    IF NOT event."checkoutEnabled" OR event.state::text <> 'LIVE' THEN
      RAISE EXCEPTION 'Re-entry requires enabled checkout and a live event';
    END IF;
  ELSE
    UPDATE "Registration" SET "firstAcceptedCheckInAt" = NEW."acceptedAt"
      WHERE id = NEW."registrationId" AND "firstAcceptedCheckInAt" IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registration cannot be checked in'; END IF;
  END IF;
  RETURN NEW;
END $$;
