import type { useEventInformation } from "./useEventInformation";
import { timeZoneLabel } from "../services/event-time";
export function EventInformation({
  information,
}: {
  information: ReturnType<typeof useEventInformation>;
}) {
  return information.detail ? (
    <p>
      Event: <strong>{information.detail.name}</strong> · Time zone:{" "}
      {timeZoneLabel(information.detail.time_zone)}
    </p>
  ) : information.error ? (
    <div role="status">
      <p>{information.error}</p>
      <button type="button" onClick={information.retry}>
        Retry event information
      </button>
    </div>
  ) : (
    <p role="status">Loading event information…</p>
  );
}
