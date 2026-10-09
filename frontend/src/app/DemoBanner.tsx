import { isSyntheticDemo } from "./demo-context";

export function DemoBanner() {
  return isSyntheticDemo() ? (
    <aside
      className="notice page-shell"
      aria-label="Synthetic demo environment"
    >
      <strong>Local demo — synthetic attendance.</strong> This isolated dataset
      represents no real event or participants. Do not use these forecasts for
      live operational decisions.
    </aside>
  ) : null;
}
