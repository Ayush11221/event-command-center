-- Additive: legacy sessions retain their original expiry and cannot renew.
ALTER TABLE "Session"
  ADD COLUMN "absoluteExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "renewalHash" CHAR(64),
  ADD COLUMN "renewalVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "renewedAt" TIMESTAMPTZ(3);

ALTER TABLE "Session" ADD CONSTRAINT "Session_renewal_bounds" CHECK (
  "renewalVersion" >= 0 AND
  ("absoluteExpiresAt" IS NULL OR
    ("expiresAt" <= "absoluteExpiresAt" AND
     "absoluteExpiresAt" <= "createdAt" + INTERVAL '7 days')) AND
  ("renewalHash" IS NULL OR
    ("absoluteExpiresAt" IS NOT NULL AND "renewedAt" IS NOT NULL))
);
