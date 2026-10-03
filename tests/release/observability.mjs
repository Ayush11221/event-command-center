import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

// Inspect only this disposable demo; never print raw logs or mounted secrets.
function logs(service) {
  const result = spawnSync("docker", ["logs", `slice12-demo-${service}-1`], {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });
  assert.equal(result.status, 0);
  return (result.stdout + result.stderr).split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line.slice(line.indexOf("{")))];
    } catch {
      return [];
    }
  });
}
const node = logs("api"),
  python = logs("forecast");
const spans = node.filter((row) => row.telemetry === "trace");
const names = new Set(spans.map((row) => row.operation));
assert.ok(names.has("http.request"));
assert.ok(names.has("postgresql.query"));
assert.ok(names.has("forecast"));
const traceIds = new Set(spans.map((row) => row.trace_id));
const linked = python.filter(
  (row) => row.trace_id && traceIds.has(row.trace_id),
);
assert.ok(
  linked.length > 0,
  "Node and internal AI must share a trace identifier",
);
const result = spawnSync(
  "docker",
  [
    "exec",
    "slice12-demo-api-1",
    "node",
    "-e",
    "const fs=require('node:fs'); fetch('http://127.0.0.1:3000/internal/metrics',{headers:{Authorization:'Bearer '+fs.readFileSync('/run/secrets/metrics_token','utf8').trim()}}).then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))",
  ],
  { encoding: "utf8" },
);
assert.equal(result.status, 0);
assert.match(result.stdout, /eoc_database_available 1/);
assert.match(result.stdout, /eoc_operation_seconds_count/);
assert.match(result.stdout, /eoc_durable_work/);
const report = {
  status: "PASS",
  span_operations: [...names].sort(),
  sampled_spans: spans.length,
  linked_internal_forecast_logs: linked.length,
  private_metrics: "authenticated; database and durable-state gauges present",
  limits:
    "Sampled JSON spans and correlated Python logs, not a deployed external tracing or dashboard backend",
};
await mkdir(".artifacts/release", { recursive: true });
await writeFile(
  ".artifacts/release/observability.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
