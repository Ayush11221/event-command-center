-- Derived advisory runs only. Existing event, registration, scan and attendance
-- rows/constraints are unchanged; no occupancy counter or source-history copy.
CREATE TABLE "ForecastRun" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "persistedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "result" JSONB NOT NULL,
  CONSTRAINT "ForecastRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ForecastRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ForecastRun_result_check" CHECK (
    COALESCE(jsonb_typeof("result") = 'object'
    AND "result" ?& ARRAY['event_id', 'contract_version', 'status', 'generated_at', 'input', 'method', 'points', 'evaluation', 'limitations']
    AND "result"->>'event_id' = "eventId"::text
    AND "result"->>'contract_version' = '1'
    AND jsonb_typeof("result"->'contract_version') = 'number'
    AND jsonb_typeof("result"->'generated_at') = 'string'
    AND jsonb_typeof("result"->'input') = 'object'
    AND jsonb_typeof("result"->'method') = 'object'
    AND jsonb_typeof("result"->'limitations') = 'array'
    AND ("result" - ARRAY['event_id', 'contract_version', 'status', 'generated_at', 'input', 'method', 'points', 'evaluation', 'limitations']) = '{}'::jsonb
    AND "result"->>'status' IN ('AVAILABLE', 'INSUFFICIENT_DATA', 'STALE_INPUT', 'MODEL_UNAVAILABLE', 'INVALID_INPUT')
    AND jsonb_typeof("result"->'points') = 'array'
    AND (("result"->>'status' = 'AVAILABLE' AND jsonb_array_length("result"->'points') = 2 AND jsonb_typeof("result"->'evaluation') = 'object')
      OR ("result"->>'status' <> 'AVAILABLE' AND jsonb_array_length("result"->'points') = 0 AND "result"->'evaluation' = 'null'::jsonb))
    , false)
  )
);
CREATE INDEX "ForecastRun_eventId_persistedAt_id_idx" ON "ForecastRun"("eventId", "persistedAt" DESC, "id" DESC);
CREATE FUNCTION forecast_run_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Forecast results are immutable';
END;
$$;
CREATE TRIGGER "ForecastRun_immutable" BEFORE UPDATE OR DELETE ON "ForecastRun"
FOR EACH ROW EXECUTE FUNCTION forecast_run_immutable();
