import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import type { RequestHandler } from "express";

const buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
const categories = [
  "auth",
  "discovery",
  "registrations",
  "scan-decisions",
  "operations",
  "forecasts",
  "certificates",
  "certificate-batches",
  "volunteer-tasks",
  "results",
  "audit-events",
  "health",
];
export function category(path: string) {
  return categories.find((key) => path.split("/").includes(key)) ?? "other";
}
const measurements = new Map<
  string,
  { count: number; sum: number; buckets: number[] }
>();
export function observe(operation: string, outcome: string, seconds: number) {
  const key = `${operation}|${outcome}`;
  const row = measurements.get(key) ?? {
    count: 0,
    sum: 0,
    buckets: buckets.map(() => 0),
  };
  row.count++;
  row.sum += seconds;
  buckets.forEach((edge, i) => {
    if (seconds <= edge) row.buckets[i]++;
  });
  measurements.set(key, row);
}
export function metrics() {
  const lines = ["# TYPE eoc_operation_seconds histogram"];
  for (const [key, row] of measurements) {
    const [operation, outcome] = key.split("|");
    const labels = `operation="${operation}",outcome="${outcome}"`;
    buckets.forEach((edge, i) =>
      lines.push(
        `eoc_operation_seconds_bucket{${labels},le="${edge}"} ${row.buckets[i]}`,
      ),
    );
    lines.push(
      `eoc_operation_seconds_bucket{${labels},le="+Inf"} ${row.count}`,
      `eoc_operation_seconds_sum{${labels}} ${row.sum}`,
      `eoc_operation_seconds_count{${labels}} ${row.count}`,
    );
  }
  lines.push(
    `# TYPE eoc_process_resident_bytes gauge`,
    `eoc_process_resident_bytes ${process.memoryUsage().rss}`,
    `# TYPE eoc_process_uptime_seconds gauge`,
    `eoc_process_uptime_seconds ${process.uptime()}`,
  );
  return lines.join("\n") + "\n";
}
export const requestTelemetry: RequestHandler = (request, response, next) => {
  const operation = category(request.path),
    started = performance.now();
  const span = trace.getTracer("eoc").startSpan("http.request", {
    attributes: { operation, method: request.method },
  });
  response.locals.traceId = span.spanContext().traceId;
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    const outcome = response.writableFinished
      ? `${Math.floor(response.statusCode / 100)}xx`
      : "aborted";
    observe(operation, outcome, (performance.now() - started) / 1000);
    span.setAttribute("outcome", outcome);
    span.end();
  };
  response.once("finish", finish);
  response.once("close", finish);
  context.with(trace.setSpan(context.active(), span), next);
};
export async function operation<T>(
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  return trace.getTracer("eoc").startActiveSpan(name, async (span) => {
    const started = performance.now();
    try {
      const result = await run();
      observe(name, "success", (performance.now() - started) / 1000);
      return result;
    } catch (error) {
      observe(name, "failure", (performance.now() - started) / 1000);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
export function traceHeaders(correlationId?: string) {
  const span = trace.getSpan(context.active())?.spanContext();
  return {
    ...(correlationId ? { "X-Correlation-Id": correlationId } : {}),
    ...(span
      ? {
          traceparent: `00-${span.traceId}-${span.spanId}-${span.traceFlags & 1 ? "01" : "00"}`,
        }
      : {}),
  };
}
