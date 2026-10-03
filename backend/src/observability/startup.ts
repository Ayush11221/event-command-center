import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type SpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { createLogger } from "../config/logger.js";

// Preload before pg. Export only identifiers and timing, never SQL/attributes.
if (process.env.TELEMETRY_ENABLED === "true") {
  const logger = createLogger();
  const exporter: SpanExporter = {
    export(spans: ReadableSpan[], callback) {
      try {
        for (const span of spans)
          logger.info(
            {
              telemetry: "trace",
              trace_id: span.spanContext().traceId,
              span_id: span.spanContext().spanId,
              parent_span_id: span.parentSpanContext?.spanId,
              operation: span.name.startsWith("pg.")
                ? "postgresql.query"
                : span.name,
              duration_ms: span.duration[0] * 1000 + span.duration[1] / 1e6,
              status: span.status.code,
            },
            "operation trace",
          );
      } catch {
        /* telemetry is best effort */
      }
      callback({ code: 0 });
    },
    async shutdown() {},
  };
  const ratio = Number(process.env.TRACE_SAMPLE_RATIO ?? "0.1");
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)
    throw new Error("Invalid TRACE_SAMPLE_RATIO");
  const provider = new NodeTracerProvider({
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(ratio),
    }),
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        maxQueueSize: 512,
        maxExportBatchSize: 64,
        scheduledDelayMillis: 1000,
      }),
    ],
  });
  provider.register();
  registerInstrumentations({
    instrumentations: [
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });
  process.once("beforeExit", () => {
    void provider.forceFlush();
  });
}
