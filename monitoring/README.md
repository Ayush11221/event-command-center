# Slice 12 telemetry operations

Railway uses the same JSON logging/trace exporter and private authenticated metrics endpoint. It does not automatically enable OTLP export or host Prometheus/Grafana. Platform log permissions, retention and private scraping require operator configuration; see [Railway deployment adaptations](../docs/implementation/RAILWAY_DEPLOYMENT.md).

Pino logs use existing correlation IDs and bounded route categories. They omit raw paths, query strings, tokens, OTPs, contacts, SQL parameters, QR/PDF bytes and arbitrary tracing attributes. Internal FastAPI logs allowlisted correlation/trace IDs and aggregate timing only. Audit events remain durable domain evidence; telemetry is not a replacement.

The API preloads `backend/dist/observability/startup.js` using Node `--import`. OpenTelemetry spans cover HTTP, PostgreSQL, Node→FastAPI and certificate/batch/delivery recovery. Ten-percent parent-based sampling, bounded batching and an allowlist-only JSON exporter prevent tracing from becoming a correctness dependency. PostgreSQL instrumentation never exports SQL/parameter attributes. FastAPI receives W3C trace context and emits correlated logs; a full Python tracing/export backend is not claimed.

`/internal/metrics` requires the 64-hex `METRICS_TOKEN` secret and timing-safe bearer comparison. It is unreachable through the public edge. Operators can query inside the API container with a script that reads the mounted token; never paste tokens into command arguments. Metrics expose bounded HTTP count/latency/status, scan decisions, forecast state/operation duration, database health, process RSS/uptime and durable certificate-work/batch/delivery state counts. Registration traffic uses the registration category. Realtime end-to-end propagation is measured in the release harness, not inferred from socket sends or server response latency.

Example Prometheus expressions for a privately configured scraper:

```promql
sum(rate(eoc_operation_seconds_count{outcome="5xx"}[5m]))
histogram_quantile(0.95, sum by (le, operation) (rate(eoc_operation_seconds_bucket[5m])))
eoc_database_available
```

Check actual metric names in the endpoint before configuring a scraper. Prometheus/Grafana hosting is optional and not deployed by this slice; there is no public metrics port or new product-alert category. Dashboarding and long-term trace export are NOT MEASURED. A failed exporter must not fail registration/check-in or durable work.

The deployment/release operator owns health, scrape credentials, secret rotation, backups and log access. Default Docker logs are bounded/rotated by Compose; retain demo logs/evidence for seven days, keep access operator-only, and delete exported evidence when no longer needed. GitHub release artifacts expire after seven days. Database audit/replay/work retention remains governed by finalized domain contracts: do not purge replay identity merely because a response cache expired. No real-data retention/deletion policy is approved here. Review certificate recovery and delivery UNKNOWN/FAILED counts with the application owner; do not infer SMTP recipient receipt from SENT.

Readiness means database access, not optional forecast/email success. Correlate a request's sanitized trace/correlation ID with PostgreSQL spans and internal forecast logs when diagnosing failures. State-count metrics do not expose event/participant IDs or replace authorization checks.
