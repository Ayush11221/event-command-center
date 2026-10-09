import type { PublicEventItem } from "../services/discovery";

export function publicEventTime(
  value: string | null,
  zone: string | null,
): string {
  if (!value) return "Not configured";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      ...(zone ? { timeZone: zone } : {}),
    }).format(new Date(value));
  } catch {
    return "Unavailable";
  }
}
const reasons = {
  NOT_OPEN_YET:
    "The configured registration opening time has not been reached.",
  SCHEDULED_CLOSE_REACHED:
    "The scheduled registration closing time has been reached.",
  MANUALLY_CLOSED: "Registration is manually closed.",
};
export function PublicPolicy({
  event,
  compact = false,
}: {
  event: PublicEventItem;
  compact?: boolean;
}) {
  const { availability } = event;
  return (
    <section className="public-policy" aria-label="Registration policy">
      <p className="policy-label">
        Registration policy:{" "}
        <strong
          className={`reg-chip ${availability.policy_status === "OPEN" ? "is-registered" : "is-neutral"}`}
        >
          {availability.policy_status}
        </strong>
      </p>
      {availability.reasons.length > 0 ? (
        <ul>
          {availability.reasons.map((reason) => (
            <li key={reason}>{reasons[reason]}</li>
          ))}
        </ul>
      ) : (
        <p>No policy closure reasons apply.</p>
      )}
      {!compact && (
        <>
          <dl className="event-detail-fields">
            <div>
              <dt>Policy opening time</dt>
              <dd>
                {availability.opens_at
                  ? publicEventTime(availability.opens_at, event.time_zone)
                  : "On publication"}
              </dd>
            </div>
            <div>
              <dt>Policy closing time</dt>
              <dd>
                {publicEventTime(availability.closes_at, event.time_zone)}
              </dd>
            </div>
          </dl>
          <p>
            Policy OPEN describes the configured registration window.
            Registration also requires a Published event, verified identity, and
            an available place.
          </p>
          <p className="freshness">
            Policy confirmed {new Date(availability.as_of).toLocaleString()}.
          </p>
        </>
      )}
    </section>
  );
}

export function PublicTags({
  event,
}: {
  event: Pick<PublicEventItem, "category" | "tags">;
}) {
  return (
    <>
      {event.category && <p className="event-category">{event.category}</p>}
      {event.tags.length > 0 && (
        <ul className="public-tags" aria-label="Event tags">
          {event.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}
    </>
  );
}
