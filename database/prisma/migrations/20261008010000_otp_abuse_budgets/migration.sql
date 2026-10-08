-- Additive shared OTP admission buckets; existing identity/session data is untouched.
CREATE TABLE "OtpRateLimitBucket" (
  "category" VARCHAR(8) NOT NULL,
  "key" CHAR(64) NOT NULL,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "count" INTEGER NOT NULL,
  CONSTRAINT "OtpRateLimitBucket_pkey" PRIMARY KEY ("category", "key", "windowStart"),
  CONSTRAINT "OtpRateLimitBucket_category_check" CHECK ("category" IN ('CONTACT', 'SOURCE', 'PROVIDER')),
  CONSTRAINT "OtpRateLimitBucket_count_check" CHECK ("count" > 0),
  CONSTRAINT "OtpRateLimitBucket_expiry_check" CHECK ("expiresAt" > "windowStart")
);
CREATE INDEX "OtpRateLimitBucket_expiresAt_idx" ON "OtpRateLimitBucket"("expiresAt");
