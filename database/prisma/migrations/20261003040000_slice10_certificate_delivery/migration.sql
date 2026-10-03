-- Legacy domain relations remain SQL-owned, as in Slice 9. Raw selected IDs
-- intentionally have no Registration FK: missing IDs are independent outcomes.
CREATE TABLE "CertificateBatch" (
 id UUID PRIMARY KEY, "eventId" UUID NOT NULL REFERENCES "Event"(id) ON DELETE RESTRICT,
 "requestedByUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "acceptanceSessionId" UUID NOT NULL, "commandReplayId" UUID NOT NULL UNIQUE REFERENCES "CommandReplay"(id) ON DELETE RESTRICT,
 "correlationId" VARCHAR(64) NOT NULL,
 "templateId" VARCHAR(16) NOT NULL CHECK ("templateId" IN ('classic','modern','minimal')),
 "templateVersion" SMALLINT NOT NULL CHECK ("templateVersion" = 1),
 "fontId" VARCHAR(8) NOT NULL CHECK ("fontId" IN ('sans','serif')),
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','PARTIAL_FAILED','FAILED')),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
 CHECK ((status = 'PENDING' AND "startedAt" IS NULL AND "completedAt" IS NULL)
 OR (status = 'RUNNING' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL)
 OR (status IN ('COMPLETED','PARTIAL_FAILED','FAILED') AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL))
);
CREATE INDEX "CertificateBatch_status_createdAt_id_idx" ON "CertificateBatch"(status,"createdAt",id);
ALTER TABLE "CertificateIssueWork" ADD COLUMN "executionBatchId" UUID REFERENCES "CertificateBatch"(id) ON DELETE RESTRICT;
CREATE FUNCTION certificate_work_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."executionBatchId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CertificateBatch" WHERE id=NEW."executionBatchId"
 AND "eventId"=NEW."eventId" AND "requestedByUserId"=NEW."executionByUserId" AND "acceptanceSessionId"=NEW."executionSessionId")
 THEN RAISE EXCEPTION 'Batch execution provenance mismatch'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='PENDING' AND NEW."executionBatchId" IS DISTINCT FROM OLD."executionBatchId"
 THEN RAISE EXCEPTION 'Pending execution provenance is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CertificateIssueWork_batch_guard" BEFORE INSERT OR UPDATE ON "CertificateIssueWork" FOR EACH ROW EXECUTE FUNCTION certificate_work_batch_guard();
CREATE TABLE "CertificateBatchItem" (
 id UUID PRIMARY KEY, "batchId" UUID NOT NULL REFERENCES "CertificateBatch"(id) ON DELETE RESTRICT,
 "eventId" UUID NOT NULL REFERENCES "Event"(id) ON DELETE RESTRICT, "registrationId" UUID NOT NULL,
 "eligibleAtCreation" BOOLEAN NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
 "issueWorkId" UUID REFERENCES "CertificateIssueWork"(id) ON DELETE RESTRICT, "generationCycle" INTEGER,
 "certificateId" UUID REFERENCES "Certificate"(id) ON DELETE RESTRICT, "resultCode" VARCHAR(80),
 UNIQUE ("batchId","registrationId"), CHECK (("issueWorkId" IS NULL) = ("generationCycle" IS NULL)),
 CHECK ("generationCycle" IS NULL OR "generationCycle" > 0),
 CHECK ((status = 'SUCCEEDED' AND "certificateId" IS NOT NULL AND "resultCode" IN ('GENERATED','ALREADY_SATISFIED'))
 OR (status = 'FAILED' AND "certificateId" IS NULL AND "resultCode" IS NOT NULL)
 OR (status IN ('PENDING','RUNNING') AND "certificateId" IS NULL AND "resultCode" IS NULL))
);
CREATE INDEX "CertificateBatchItem_issueWorkId_generationCycle_idx" ON "CertificateBatchItem"("issueWorkId","generationCycle");
CREATE INDEX "CertificateBatchItem_status_batchId_registrationId_idx" ON "CertificateBatchItem"(status,"batchId","registrationId");
CREATE TABLE "CertificateDelivery" (
 id UUID PRIMARY KEY, "certificateId" UUID NOT NULL UNIQUE REFERENCES "Certificate"(id) ON DELETE RESTRICT,
 "eventId" UUID NOT NULL REFERENCES "Event"(id) ON DELETE RESTRICT,
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('NOT_REQUIRED','PENDING','SENDING','SENT','FAILED','UNKNOWN')),
 "reasonCode" VARCHAR(80), "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" BETWEEN 0 AND 3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastAttemptAt" TIMESTAMPTZ(3), "sentAt" TIMESTAMPTZ(3),
 CHECK ((status = 'SENT') = ("sentAt" IS NOT NULL)),
 CHECK (status NOT IN ('NOT_REQUIRED','FAILED','UNKNOWN') OR "reasonCode" IS NOT NULL)
);
CREATE INDEX "CertificateDelivery_status_createdAt_id_idx" ON "CertificateDelivery"(status,"createdAt",id);
CREATE TABLE "CertificateDeliveryAttempt" (
 id UUID PRIMARY KEY, "deliveryId" UUID NOT NULL REFERENCES "CertificateDelivery"(id) ON DELETE RESTRICT,
 "attemptNumber" SMALLINT NOT NULL CHECK ("attemptNumber" BETWEEN 1 AND 3),
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED','UNKNOWN','NOT_REQUIRED')),
 "recipientUserId" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
 "recipientContactId" UUID REFERENCES "VerifiedContact"(id) ON DELETE RESTRICT,
 "encryptedRecipient" TEXT, "claimToken" UUID, "fencingToken" BIGINT NOT NULL DEFAULT 0 CHECK ("fencingToken" >= 0),
 "leaseExpiresAt" TIMESTAMPTZ(3), "reasonCode" VARCHAR(80),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3),
 UNIQUE ("deliveryId","attemptNumber"),
 CHECK (("claimToken" IS NULL) = ("leaseExpiresAt" IS NULL)),
 CHECK ((status = 'PENDING' AND "claimToken" IS NULL AND "completedAt" IS NULL)
 OR (status = 'SENDING' AND "claimToken" IS NOT NULL AND "startedAt" IS NOT NULL AND "completedAt" IS NULL
 AND "recipientUserId" IS NOT NULL AND "recipientContactId" IS NOT NULL AND "encryptedRecipient" IS NOT NULL)
 OR (status IN ('SENT','FAILED','UNKNOWN','NOT_REQUIRED') AND "claimToken" IS NULL AND "completedAt" IS NOT NULL))
);
CREATE INDEX "CertificateDeliveryAttempt_status_leaseExpiresAt_id_idx" ON "CertificateDeliveryAttempt"(status,"leaseExpiresAt",id);

CREATE FUNCTION certificate_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Certificate batches are retained'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "CommandReplay" WHERE id=NEW."commandReplayId" AND action='CERTIFICATE_BATCH'
 AND "actorUserId"=NEW."requestedByUserId" AND "resourceKey"=NEW."eventId"::text)
 THEN RAISE EXCEPTION 'Batch replay scope mismatch'; END IF;
 IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','startedAt','completedAt']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['status','startedAt','completedAt']) OR NOT
 (NEW.status=OLD.status OR (OLD.status='PENDING' AND NEW.status='RUNNING') OR
 (OLD.status='RUNNING' AND NEW.status IN ('COMPLETED','PARTIAL_FAILED','FAILED'))))
 THEN RAISE EXCEPTION 'Invalid batch transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CertificateBatch_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CertificateBatch" FOR EACH ROW EXECUTE FUNCTION certificate_batch_guard();

CREATE FUNCTION certificate_batch_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Batch selections are retained'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS (SELECT 1 FROM "CertificateBatch" b JOIN "CommandReplay" p ON p.id=b."commandReplayId"
 WHERE b.id=NEW."batchId" AND b.status='PENDING' AND p.status='PENDING')
 THEN RAISE EXCEPTION 'Batch selection is immutable after acceptance'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "CertificateBatch" WHERE id=NEW."batchId" AND "eventId"=NEW."eventId")
 OR (NEW."issueWorkId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CertificateIssueWork" WHERE id=NEW."issueWorkId"
 AND "eventId"=NEW."eventId" AND "registrationId"=NEW."registrationId" AND "generationCycle">=NEW."generationCycle"))
 OR (NEW."certificateId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Certificate" WHERE id=NEW."certificateId"
 AND "eventId"=NEW."eventId" AND "registrationId"=NEW."registrationId"))
 THEN RAISE EXCEPTION 'Batch item binding mismatch'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."batchId"<>OLD."batchId" OR NEW."eventId"<>OLD."eventId"
 OR NEW."registrationId"<>OLD."registrationId" OR NEW."eligibleAtCreation"<>OLD."eligibleAtCreation"
 OR NOT (NEW.status=OLD.status OR (OLD.status='PENDING' AND NEW.status='RUNNING') OR
 (OLD.status='RUNNING' AND NEW.status IN ('SUCCEEDED','FAILED')))
 OR (OLD.status IN ('SUCCEEDED','FAILED') AND NEW IS DISTINCT FROM OLD))
 THEN RAISE EXCEPTION 'Invalid batch item transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CertificateBatchItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CertificateBatchItem" FOR EACH ROW EXECUTE FUNCTION certificate_batch_item_guard();

CREATE FUNCTION certificate_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Deliveries are retained'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "Certificate" WHERE id=NEW."certificateId" AND "eventId"=NEW."eventId")
 THEN RAISE EXCEPTION 'Delivery certificate binding mismatch'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."certificateId"<>OLD."certificateId" OR NEW."eventId"<>OLD."eventId"
 OR NEW."createdAt"<>OLD."createdAt" OR (OLD.status IN ('NOT_REQUIRED','SENT','UNKNOWN') AND NEW IS DISTINCT FROM OLD)
 OR NEW."attemptCount"<OLD."attemptCount" OR NEW."attemptCount">OLD."attemptCount"+1 OR NOT
 (NEW.status=OLD.status OR (OLD.status='PENDING' AND NEW.status IN ('SENDING','NOT_REQUIRED','FAILED'))
 OR (OLD.status='SENDING' AND NEW.status IN ('SENT','FAILED','UNKNOWN')) OR (OLD.status='FAILED' AND NEW.status IN ('PENDING','NOT_REQUIRED'))))
 THEN RAISE EXCEPTION 'Invalid delivery transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CertificateDelivery_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CertificateDelivery" FOR EACH ROW EXECUTE FUNCTION certificate_delivery_guard();

CREATE FUNCTION certificate_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Delivery attempts are retained'; END IF;
 IF NEW.status='SENDING' AND (TG_OP='INSERT' OR OLD.status='PENDING') AND NOT EXISTS (
 SELECT 1 FROM "CertificateDelivery" d JOIN "Certificate" c ON c.id=d."certificateId"
 JOIN "Registration" r ON r.id=c."registrationId" JOIN "VerifiedContact" v ON v.id=NEW."recipientContactId"
 WHERE d.id=NEW."deliveryId" AND c.status='ISSUED' AND c."eventId"=d."eventId" AND r."userId"=NEW."recipientUserId"
 AND v."userId"=r."userId" AND v.type='EMAIL' AND v.encrypted=NEW."encryptedRecipient")
 THEN RAISE EXCEPTION 'Submission requires current recipient and issuance'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS (SELECT 1 FROM "CertificateDelivery" d JOIN "Certificate" c ON c.id=d."certificateId"
 WHERE d.id=NEW."deliveryId" AND c.status='ISSUED' AND NEW."attemptNumber"=d."attemptCount" AND d.status='PENDING')
 THEN RAISE EXCEPTION 'Delivery attempt requires current issuance'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW."deliveryId"<>OLD."deliveryId" OR NEW."attemptNumber"<>OLD."attemptNumber"
 OR NEW."fencingToken"<OLD."fencingToken" OR NOT
 (NEW.status=OLD.status OR (OLD.status='PENDING' AND NEW.status IN ('SENDING','FAILED','NOT_REQUIRED'))
 OR (OLD.status='SENDING' AND NEW.status IN ('SENT','FAILED','UNKNOWN')))
 OR (OLD.status IN ('SENT','FAILED','UNKNOWN','NOT_REQUIRED') AND NEW IS DISTINCT FROM OLD))
 THEN RAISE EXCEPTION 'Invalid delivery attempt transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CertificateDeliveryAttempt_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CertificateDeliveryAttempt" FOR EACH ROW EXECUTE FUNCTION certificate_attempt_guard();

CREATE FUNCTION certificate_batch_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "CertificateBatch"%ROWTYPE; total INTEGER; pending INTEGER; success INTEGER; failed INTEGER;
BEGIN
 SELECT * INTO b FROM "CertificateBatch" WHERE id=(CASE WHEN TG_TABLE_NAME='CertificateBatch' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'batchId' END)::uuid;
 SELECT count(*),count(*) FILTER (WHERE status IN ('PENDING','RUNNING')),count(*) FILTER (WHERE status='SUCCEEDED'),count(*) FILTER (WHERE status='FAILED')
 INTO total,pending,success,failed FROM "CertificateBatchItem" WHERE "batchId"=b.id;
 IF total NOT BETWEEN 1 AND 100 OR (b.status='COMPLETED' AND success<>total) OR (b.status='PARTIAL_FAILED' AND (pending<>0 OR success=0 OR failed=0))
 OR (b.status='FAILED' AND failed<>total) THEN RAISE EXCEPTION 'Invalid batch completion'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "CertificateBatch_completion" AFTER INSERT OR UPDATE ON "CertificateBatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION certificate_batch_completion_guard();
CREATE CONSTRAINT TRIGGER "CertificateBatchItem_completion" AFTER INSERT OR UPDATE ON "CertificateBatchItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION certificate_batch_completion_guard();
CREATE FUNCTION certificate_delivery_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "CertificateDelivery"%ROWTYPE; a "CertificateDeliveryAttempt"%ROWTYPE; total INTEGER;
BEGIN
 SELECT * INTO d FROM "CertificateDelivery" WHERE id=(CASE WHEN TG_TABLE_NAME='CertificateDelivery' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'deliveryId' END)::uuid;
 SELECT count(*) INTO total FROM "CertificateDeliveryAttempt" WHERE "deliveryId"=d.id;
 SELECT * INTO a FROM "CertificateDeliveryAttempt" WHERE "deliveryId"=d.id AND "attemptNumber"=d."attemptCount";
 IF total<>d."attemptCount" OR (total=0 AND d.status<>'NOT_REQUIRED') OR (total>0 AND a.status<>d.status)
 THEN RAISE EXCEPTION 'Delivery/attempt completion must be atomic'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "CertificateDelivery_completion" AFTER INSERT OR UPDATE ON "CertificateDelivery" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION certificate_delivery_completion_guard();
CREATE CONSTRAINT TRIGGER "CertificateDeliveryAttempt_completion" AFTER INSERT OR UPDATE ON "CertificateDeliveryAttempt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION certificate_delivery_completion_guard();
