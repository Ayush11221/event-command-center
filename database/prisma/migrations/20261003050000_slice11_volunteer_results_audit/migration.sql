CREATE TYPE "VolunteerTaskStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TABLE "VolunteerTask" (
  id UUID PRIMARY KEY,
  "eventId" UUID NOT NULL REFERENCES "Event"(id) ON DELETE RESTRICT,
  "createdByUserId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "creationKeyHash" CHAR(64) NOT NULL CHECK ("creationKeyHash" ~ '^[0-9a-f]{64}$'),
  "assignedVolunteerId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "assignedRoleGrantId" UUID NOT NULL REFERENCES "EventRoleAssignment"(id) ON DELETE RESTRICT,
  title VARCHAR(160) NOT NULL,
  instructions TEXT NOT NULL,
  location VARCHAR(240),
  "startsAt" TIMESTAMPTZ(3), "endsAt" TIMESTAMPTZ(3),
  status "VolunteerTaskStatus" NOT NULL DEFAULT 'ASSIGNED',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMPTZ(3),
  "cancelledByUserId" UUID REFERENCES "User"(id) ON DELETE RESTRICT,
  "cancellationReason" VARCHAR(500),
  CHECK (char_length(btrim(title)) BETWEEN 1 AND 160 AND title ~ '[^[:space:]]'),
  CHECK (char_length(btrim(instructions)) BETWEEN 1 AND 4000 AND instructions ~ '[^[:space:]]'),
  CHECK (location IS NULL OR (char_length(btrim(location)) BETWEEN 1 AND 240 AND location ~ '[^[:space:]]')),
  CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"),
  CHECK ((status = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL
      AND "cancellationReason" IS NOT NULL AND "cancellationReason" ~ '[^[:space:]]'
      AND char_length(btrim("cancellationReason")) BETWEEN 1 AND 500 AND "cancelledAt" = "updatedAt")
    OR (status <> 'CANCELLED' AND "cancelledAt" IS NULL AND "cancelledByUserId" IS NULL AND "cancellationReason" IS NULL))
);
CREATE INDEX "VolunteerTask_eventId_createdAt_id_idx" ON "VolunteerTask"("eventId", "createdAt" DESC, id DESC);
CREATE UNIQUE INDEX "VolunteerTask_eventId_createdByUserId_creationKeyHash_key" ON "VolunteerTask"("eventId", "createdByUserId", "creationKeyHash");
CREATE INDEX "VolunteerTask_eventId_assignedVolunteerId_createdAt_id_idx" ON "VolunteerTask"("eventId", "assignedVolunteerId", "createdAt" DESC, id DESC);
CREATE INDEX "AuditEvent_eventId_createdAt_id_idx" ON "AuditEvent"("eventId", "createdAt" DESC, id DESC);

CREATE FUNCTION guard_volunteer_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Volunteer tasks cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ASSIGNED' OR NEW.revision <> 1 THEN RAISE EXCEPTION 'Invalid initial task state'; END IF;
  ELSE
    IF OLD.status IN ('COMPLETED', 'CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Terminal task is immutable';
    END IF;
    IF (NEW.id, NEW."eventId", NEW."createdAt", NEW."createdByUserId", NEW."creationKeyHash") IS DISTINCT FROM (OLD.id, OLD."eventId", OLD."createdAt", OLD."createdByUserId", OLD."creationKeyHash") THEN
      RAISE EXCEPTION 'Task identity is immutable';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'ASSIGNED' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED')) OR
      (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('COMPLETED', 'CANCELLED'))
    ) THEN RAISE EXCEPTION 'Invalid task transition'; END IF;
    IF (NEW."assignedVolunteerId", NEW."assignedRoleGrantId") IS DISTINCT FROM (OLD."assignedVolunteerId", OLD."assignedRoleGrantId")
      AND (OLD.status <> 'ASSIGNED' OR NEW.status <> 'ASSIGNED') THEN RAISE EXCEPTION 'Task cannot be reassigned'; END IF;
    IF (NEW.title,NEW.instructions,NEW.location,NEW."startsAt",NEW."endsAt") IS DISTINCT FROM
       (OLD.title,OLD.instructions,OLD.location,OLD."startsAt",OLD."endsAt") AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'Details and status are separate commands';
    END IF;
    IF (to_jsonb(NEW) - 'revision' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'revision' - 'updatedAt') THEN
      IF NEW.revision <> OLD.revision + 1 OR NEW."updatedAt" < OLD."updatedAt" THEN
        RAISE EXCEPTION 'Invalid task revision';
      END IF;
    ELSIF NEW.revision <> OLD.revision OR NEW."updatedAt" <> OLD."updatedAt" THEN
      RAISE EXCEPTION 'No-op must retain revision and time';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW."assignedRoleGrantId" IS DISTINCT FROM OLD."assignedRoleGrantId" OR NEW."assignedVolunteerId" IS DISTINCT FROM OLD."assignedVolunteerId" THEN
    PERFORM id FROM "EventRoleAssignment" WHERE id = NEW."assignedRoleGrantId" AND "eventId" = NEW."eventId"
      AND "userId" = NEW."assignedVolunteerId" AND role = 'VOLUNTEER' AND "revokedAt" IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid volunteer grant binding'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "VolunteerTask_guard" BEFORE INSERT OR UPDATE OR DELETE ON "VolunteerTask"
  FOR EACH ROW EXECUTE FUNCTION guard_volunteer_task();

-- A retained task cannot lose its same-event/user/VOLUNTEER binding through
-- an update to the referenced grant. Existing revocation behavior is unchanged.
CREATE FUNCTION guard_task_role_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW."eventId", NEW."userId", NEW.role) IS DISTINCT FROM (OLD.id, OLD."eventId", OLD."userId", OLD.role)
    AND EXISTS(SELECT 1 FROM "VolunteerTask" WHERE "eventId"=OLD."eventId" AND "assignedRoleGrantId"=OLD.id) THEN
    RAISE EXCEPTION 'Retained task role binding is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EventRoleAssignment_task_binding_guard" BEFORE UPDATE OF id, "eventId", "userId", role ON "EventRoleAssignment"
  FOR EACH ROW EXECUTE FUNCTION guard_task_role_binding();
