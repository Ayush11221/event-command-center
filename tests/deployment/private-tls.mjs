// Run inside the simulated Railway API container, with its normal CA trust.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { callForecast } from "/app/backend/dist/modules/forecasting/client.js";

const url = "https://forecast.railway.internal:8000/internal/health";
const key = readFileSync("/run/secrets/forecast_key", "utf8").trim();
assert.equal((await fetch(url)).status, 401);
assert.equal(
  (await fetch(url, { headers: { Authorization: "Bearer invalid" } })).status,
  401,
);
assert.equal(
  (await fetch(url, { headers: { Authorization: `Bearer ${key}` } })).status,
  200,
);
await assert.rejects(
  () => fetch("https://wrong.railway.internal:8000/internal/health"),
  (error) => error.cause?.code === "ERR_TLS_CERT_ALTNAME_INVALID",
);
const untrusted = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    "try { await fetch('https://forecast.railway.internal:8000/internal/health'); process.exit(1); } catch (e) { process.exit(['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(e.cause?.code) ? 0 : 2); }",
  ],
  { env: { ...process.env, NODE_EXTRA_CA_CERTS: "" } },
);
assert.equal(untrusted.status, 0);
const request = {
  contract_version: 1,
  event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  as_of: new Date().toISOString(),
  time_zone: null,
  schedule: { start_at: null, end_at: null },
  occupied: 0,
  capacity: null,
  revision: 0,
  observations: [],
  horizons: [30, 60],
  method: { name: "persistence", version: "1" },
};
const config = {
  forecastServiceUrl: "https://forecast.railway.internal:8000",
  forecastServiceKey: key,
};
assert.equal((await callForecast(config, request)).status, "INSUFFICIENT_DATA");
assert.equal(
  (await callForecast({ ...config, forecastServiceKey: "invalid" }, request))
    .status,
  "MODEL_UNAVAILABLE",
);
assert.equal(
  (
    await callForecast(
      { ...config, forecastServiceUrl: "https://wrong.railway.internal:8000" },
      request,
    )
  ).status,
  "MODEL_UNAVAILABLE",
);
console.log(
  "PASS: authenticated private TLS and real forecast client; missing/wrong bearer, wrong hostname and untrusted CA rejected; existing MODEL_UNAVAILABLE behavior retained",
);
