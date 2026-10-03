import type { FoundationConfig } from "../../config/foundation.js";
import {
  fallback,
  inputFor,
  validResult,
  type ForecastRequest,
  type ForecastResult,
} from "./contract.js";

export async function callForecast(
  config: FoundationConfig,
  request: ForecastRequest,
): Promise<ForecastResult> {
  if (!config.forecastServiceUrl || !config.forecastServiceKey)
    return fallback(request, "MODEL_UNAVAILABLE");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(
      new URL("/internal/v1/forecasts", config.forecastServiceUrl),
      {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.forecastServiceKey}`,
        },
        body: JSON.stringify(request),
      },
    );
    if (!response.ok || !response.body)
      return fallback(
        request,
        response.status === 400 ? "INVALID_INPUT" : "MODEL_UNAVAILABLE",
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 65536) {
        controller.abort();
        return fallback(request, "INVALID_INPUT");
      }
      chunks.push(chunk.value);
    }
    let result: unknown;
    try {
      result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return fallback(request, "INVALID_INPUT");
    }
    const input = inputFor(request);
    if (
      !validResult(result, request.event_id) ||
      Object.entries(input).some(
        ([key, value]) => result.input[key as keyof typeof input] !== value,
      ) ||
      Date.parse(result.generated_at) > Date.now()
    )
      return fallback(request, "INVALID_INPUT");
    return result;
  } catch {
    // Transport errors, timeout, TLS errors and exception bodies are never public.
    return fallback(request, "MODEL_UNAVAILABLE");
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}
