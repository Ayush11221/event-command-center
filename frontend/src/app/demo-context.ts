const origin = "https://127.0.0.1:9443";
interface DemoEnvironment {
  VITE_FORECAST_DEMO?: string;
  VITE_API_ORIGIN?: string;
}
export function assertLocalDemo(env: DemoEnvironment, pageOrigin: string) {
  if (!env.VITE_FORECAST_DEMO) return;
  if (
    env.VITE_FORECAST_DEMO !== "synthetic_local" ||
    env.VITE_API_ORIGIN !== origin ||
    pageOrigin !== origin
  ) {
    throw new Error("Synthetic demo requires its isolated loopback origin.");
  }
}
export function isSyntheticDemo() {
  return import.meta.env.VITE_FORECAST_DEMO === "synthetic_local";
}
