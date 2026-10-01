-- An issued challenge is not proof-capable until delivery has completed.
ALTER TABLE "OtpChallenge" ADD COLUMN "deliveredAt" TIMESTAMPTZ(3);

-- Event ownership is fixed at creation; no Slice 2 transfer operation exists.
CREATE FUNCTION "reject_event_owner_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" THEN
    RAISE EXCEPTION 'event owner is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Event_owner_immutable" BEFORE UPDATE OF "ownerUserId" ON "Event"
FOR EACH ROW EXECUTE FUNCTION "reject_event_owner_change"();
