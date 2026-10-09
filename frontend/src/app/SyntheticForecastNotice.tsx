import { isSyntheticDemo } from "./demo-context";

export const SYNTHETIC_FORECAST_PROVENANCE =
  "Forecast computed from synthetic attendance when available. Demo only; not for live operational decisions.";

export function SyntheticForecastNotice() {
  return isSyntheticDemo() ? (
    <p className="notice" aria-label="Synthetic forecast provenance">
      {SYNTHETIC_FORECAST_PROVENANCE}
    </p>
  ) : null;
}
