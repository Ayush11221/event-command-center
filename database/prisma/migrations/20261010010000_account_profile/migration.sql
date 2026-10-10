ALTER TABLE "User" ADD COLUMN "displayName" VARCHAR(100);
ALTER TABLE "User" ADD COLUMN "profilePhone" VARCHAR(16);
ALTER TABLE "User" ADD COLUMN "organization" VARCHAR(120);
ALTER TABLE "User" ADD COLUMN "affiliationId" VARCHAR(64);
ALTER TABLE "User" ADD CONSTRAINT "User_displayName_valid"
  CHECK ("displayName" IS NULL OR (length(btrim("displayName")) BETWEEN 1 AND 100));
