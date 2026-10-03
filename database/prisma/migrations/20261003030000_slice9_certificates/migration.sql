CREATE TYPE "CertificateStatus" AS ENUM ('ISSUED', 'REVOKED');
CREATE TYPE "CertificateIssueWorkStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "CertificateRecipientName" (
  "registrationId" UUID PRIMARY KEY,
  "eventId" UUID NOT NULL,
  name VARCHAR(100) NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100 AND name = btrim(name)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("eventId", "registrationId") REFERENCES "Registration"("eventId", id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CertificateIssueWork" (
  id UUID PRIMARY KEY,
  "registrationId" UUID NOT NULL UNIQUE,
  "eventId" UUID NOT NULL,
  status "CertificateIssueWorkStatus" NOT NULL DEFAULT 'PENDING',
  "commandReplayId" UUID NOT NULL UNIQUE REFERENCES "CommandReplay"(id) ON DELETE RESTRICT,
  "requestedByUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "executionByUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "executionSessionId" UUID NOT NULL,
  "correlationId" VARCHAR(64) NOT NULL,
  "templateId" VARCHAR(16) NOT NULL CHECK ("templateId" IN ('classic','modern','minimal')),
  "templateVersion" SMALLINT NOT NULL CHECK ("templateVersion" = 1),
  "fontId" VARCHAR(8) NOT NULL CHECK ("fontId" IN ('sans','serif')),
  "eligibilityRuleVersion" VARCHAR(40) NOT NULL CHECK ("eligibilityRuleVersion" = 'CERT_ELIGIBILITY_V1'),
  "attendanceTransitionId" UUID NOT NULL REFERENCES "AttendanceTransition"(id) ON DELETE RESTRICT,
  "firstAcceptedCheckInAt" TIMESTAMPTZ(3) NOT NULL,
  "recipientName" VARCHAR(100) NOT NULL,
  "recipientNameRevision" INTEGER NOT NULL CHECK ("recipientNameRevision" > 0),
  "eventName" VARCHAR(200) NOT NULL,
  "eventStartAt" TIMESTAMPTZ(3) NOT NULL,
  "eventTimeZone" VARCHAR(100) NOT NULL,
  "generationCycle" INTEGER NOT NULL DEFAULT 1 CHECK ("generationCycle" > 0),
  "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" BETWEEN 0 AND 3),
  "fencingToken" BIGINT NOT NULL DEFAULT 0 CHECK ("fencingToken" >= 0),
  "claimToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "retryAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,
  "generationStartedAt" TIMESTAMPTZ(3),
  "lastErrorCode" VARCHAR(80),
  "lastErrorAt" TIMESTAMPTZ(3),
  "completedCertificateId" UUID UNIQUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  FOREIGN KEY ("eventId", "registrationId") REFERENCES "Registration"("eventId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (("claimToken" IS NULL) = ("leaseExpiresAt" IS NULL)),
  CHECK (("lastErrorCode" IS NULL) = ("lastErrorAt" IS NULL)),
  CHECK (
    (status = 'PENDING' AND "completedAt" IS NULL AND "failedAt" IS NULL AND "completedCertificateId" IS NULL
      AND (("claimToken" IS NULL AND "retryAt" IS NOT NULL) OR ("claimToken" IS NOT NULL AND "retryAt" IS NULL)))
    OR (status = 'COMPLETED' AND "completedAt" IS NOT NULL AND "completedCertificateId" IS NOT NULL AND "completedCertificateId" = id AND "failedAt" IS NULL
      AND "claimToken" IS NULL AND "retryAt" IS NULL AND "lastErrorCode" IS NULL)
    OR (status = 'FAILED' AND "failedAt" IS NOT NULL AND "lastErrorCode" IS NOT NULL AND "completedAt" IS NULL
      AND "completedCertificateId" IS NULL AND "claimToken" IS NULL AND "retryAt" IS NULL)
  )
);
CREATE INDEX "CertificateIssueWork_due_idx" ON "CertificateIssueWork"("retryAt", id) WHERE status = 'PENDING';
CREATE INDEX "CertificateIssueWork_lease_idx" ON "CertificateIssueWork"("leaseExpiresAt", id) WHERE status = 'PENDING';

CREATE TABLE "Certificate" (
  id UUID PRIMARY KEY REFERENCES "CertificateIssueWork"(id) ON DELETE RESTRICT,
  "registrationId" UUID NOT NULL UNIQUE,
  "eventId" UUID NOT NULL,
  status "CertificateStatus" NOT NULL DEFAULT 'ISSUED',
  "certificateNumber" CHAR(36) NOT NULL UNIQUE CHECK ("certificateNumber" = id::text),
  "recipientName" VARCHAR(100) NOT NULL,
  "templateId" VARCHAR(16) NOT NULL CHECK ("templateId" IN ('classic','modern','minimal')),
  "templateVersion" SMALLINT NOT NULL CHECK ("templateVersion" = 1),
  "fontId" VARCHAR(8) NOT NULL CHECK ("fontId" IN ('sans','serif')),
  "eligibilityRuleVersion" VARCHAR(40) NOT NULL CHECK ("eligibilityRuleVersion" = 'CERT_ELIGIBILITY_V1'),
  "attendanceTransitionId" UUID NOT NULL REFERENCES "AttendanceTransition"(id) ON DELETE RESTRICT,
  "firstAcceptedCheckInAt" TIMESTAMPTZ(3) NOT NULL,
  "pdfBytes" BYTEA NOT NULL CHECK (octet_length("pdfBytes") BETWEEN 1 AND 1048576),
  "pdfSha256" CHAR(64) NOT NULL CHECK ("pdfSha256" ~ '^[0-9a-f]{64}$' AND "pdfSha256" = encode(sha256("pdfBytes"), 'hex')),
  "issuedByUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedByUserId" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
  "revokedAt" TIMESTAMPTZ(3),
  "revokeReason" VARCHAR(200),
  FOREIGN KEY ("eventId", "registrationId") REFERENCES "Registration"("eventId", id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ((status = 'ISSUED' AND "revokedByUserId" IS NULL AND "revokedAt" IS NULL AND "revokeReason" IS NULL)
    OR (status = 'REVOKED' AND "revokedByUserId" IS NOT NULL AND "revokedAt" IS NOT NULL AND "revokedAt" >= "issuedAt"))
);
CREATE INDEX "Certificate_eventId_issuedAt_id_idx" ON "Certificate"("eventId", "issuedAt" DESC, id DESC);
ALTER TABLE "CertificateIssueWork" ADD FOREIGN KEY ("completedCertificateId") REFERENCES "Certificate"(id) ON DELETE RESTRICT;

CREATE FUNCTION certificate_name_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Certificate names are retained'; END IF;
  PERFORM id FROM "Event" WHERE id = NEW."eventId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "Certificate" WHERE "registrationId" = NEW."registrationId")
    OR NOT EXISTS (SELECT 1 FROM "Registration" WHERE id = NEW."registrationId" AND "eventId" = NEW."eventId" AND state = 'REGISTERED')
  THEN RAISE EXCEPTION 'Recipient name is locked'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."registrationId" <> OLD."registrationId" OR NEW."eventId" <> OLD."eventId"
    OR (NEW.name <> OLD.name AND NEW.revision <> OLD.revision + 1)
    OR (NEW.name = OLD.name AND NEW.revision <> OLD.revision))
  THEN RAISE EXCEPTION 'Invalid recipient name revision'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CertificateRecipientName_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CertificateRecipientName"
  FOR EACH ROW EXECUTE FUNCTION certificate_name_guard();

CREATE FUNCTION certificate_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "AttendanceTransition" a JOIN "Registration" r ON r.id = a."registrationId"
    WHERE a.id = NEW."attendanceTransitionId" AND a."eventId" = NEW."eventId" AND a."registrationId" = NEW."registrationId"
    AND a.kind = 'CHECK_IN' AND a."acceptedAt" = NEW."firstAcceptedCheckInAt"
    AND r."firstAcceptedCheckInAt" = a."acceptedAt" AND r.state = 'REGISTERED')
  THEN RAISE EXCEPTION 'Certificate requires matching accepted attendance'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Certificate_evidence" BEFORE INSERT ON "Certificate" FOR EACH ROW EXECUTE FUNCTION certificate_evidence_guard();
CREATE TRIGGER "CertificateIssueWork_evidence" BEFORE INSERT OR UPDATE ON "CertificateIssueWork"
  FOR EACH ROW EXECUTE FUNCTION certificate_evidence_guard();

CREATE FUNCTION certificate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Certificates are retained'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM id FROM "Event" WHERE id = NEW."eventId" FOR UPDATE;
    IF NEW.status <> 'ISSUED' OR NOT EXISTS (SELECT 1 FROM "CertificateRecipientName" n
      WHERE n."registrationId" = NEW."registrationId" AND n."eventId" = NEW."eventId" AND n.name = NEW."recipientName")
    THEN RAISE EXCEPTION 'Certificate requires current recipient name'; END IF;
  ELSIF OLD.status <> 'ISSUED' OR NEW.status <> 'REVOKED'
    OR (to_jsonb(NEW) - ARRAY['status','revokedByUserId','revokedAt','revokeReason'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','revokedByUserId','revokedAt','revokeReason'])
  THEN RAISE EXCEPTION 'Certificate issuance is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Certificate_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Certificate"
  FOR EACH ROW EXECUTE FUNCTION certificate_guard();

CREATE FUNCTION certificate_work_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Certificate work is retained'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "CommandReplay" p WHERE p.id = NEW."commandReplayId"
    AND p."actorUserId" = NEW."executionByUserId" AND p.action = 'CERTIFICATE_ISSUE' AND p."resourceKey" = NEW."eventId"::text)
  THEN RAISE EXCEPTION 'Issue replay scope mismatch'; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.status = 'COMPLETED' OR NEW.id <> OLD.id OR NEW."registrationId" <> OLD."registrationId"
    OR NEW."eventId" <> OLD."eventId" OR NEW."requestedByUserId" <> OLD."requestedByUserId"
    OR NEW."fencingToken" < OLD."fencingToken"
    OR (NEW."claimToken" IS NOT NULL AND NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
      AND (NEW.status <> 'PENDING' OR NEW."fencingToken" <> OLD."fencingToken" + 1 OR NEW."attemptCount" <> OLD."attemptCount" + 1))
    OR (OLD.status = 'FAILED' AND (NEW.status <> 'PENDING' OR NEW."generationCycle" <> OLD."generationCycle" + 1
      OR NEW."commandReplayId" = OLD."commandReplayId" OR NEW."attemptCount" <> 0))
    OR (OLD.status = 'PENDING' AND (NEW."generationCycle" <> OLD."generationCycle" OR NEW."commandReplayId" <> OLD."commandReplayId")))
  THEN RAISE EXCEPTION 'Invalid issue work transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CertificateIssueWork_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CertificateIssueWork"
  FOR EACH ROW EXECUTE FUNCTION certificate_work_guard();

CREATE FUNCTION certificate_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w "CertificateIssueWork"%ROWTYPE; c "Certificate"%ROWTYPE; p "CommandReplay"%ROWTYPE; n "CertificateRecipientName"%ROWTYPE;
BEGIN
  SELECT * INTO w FROM "CertificateIssueWork" WHERE id = NEW.id;
  SELECT * INTO c FROM "Certificate" WHERE id = w.id;
  SELECT * INTO p FROM "CommandReplay" WHERE id = w."commandReplayId";
  SELECT * INTO n FROM "CertificateRecipientName" WHERE "registrationId" = w."registrationId";
  IF (w.status = 'COMPLETED' AND (c.id IS NULL OR c."registrationId" <> w."registrationId" OR c."eventId" <> w."eventId"
      OR c."recipientName" <> w."recipientName" OR c."issuedByUserId" <> w."executionByUserId"
      OR c."templateId" <> w."templateId" OR c."templateVersion" <> w."templateVersion" OR c."fontId" <> w."fontId"
      OR c."eligibilityRuleVersion" <> w."eligibilityRuleVersion" OR c."attendanceTransitionId" <> w."attendanceTransitionId"
      OR c."firstAcceptedCheckInAt" <> w."firstAcceptedCheckInAt" OR n.revision <> w."recipientNameRevision"
      OR p."responseStatus" <> 201))
    OR (w.status <> 'COMPLETED' AND c.id IS NOT NULL)
    OR (w.status = 'PENDING' AND p.status <> 'PENDING')
    OR (w.status <> 'PENDING' AND p.status <> 'COMPLETED')
  THEN RAISE EXCEPTION 'Certificate/work/replay completion must be atomic'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "CertificateIssueWork_completion" AFTER INSERT OR UPDATE ON "CertificateIssueWork"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION certificate_completion_guard();
CREATE CONSTRAINT TRIGGER "Certificate_completion" AFTER INSERT ON "Certificate"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION certificate_completion_guard();
