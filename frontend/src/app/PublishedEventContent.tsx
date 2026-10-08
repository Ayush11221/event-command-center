import { useState, type RefObject } from "react";
import type { PublicDetail } from "../services/discovery";
import { publicEventTime, PublicPolicy, PublicTags } from "./PublicEventInfo";
import { RegistrationPanel } from "./RegistrationPanel";

function EventBanner({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="freshness">Event image unavailable.</p>
  ) : (
    <img
      className="public-event-banner"
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
export function PublishedEventContent({
  detail,
  heading,
  onRefresh,
  accessLabel = "PUBLISHED EVENT",
  refreshLabel = "Refresh event detail",
  privateProof,
}: {
  detail: PublicDetail;
  heading: RefObject<HTMLHeadingElement | null>;
  onRefresh: () => void;
  accessLabel?: string;
  refreshLabel?: string;
  privateProof?: () => string | null;
}) {
  return (
    <article>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{accessLabel}</p>
          <h1 ref={heading} tabIndex={-1}>
            {detail.name}
          </h1>
          <PublicTags event={detail} />
        </div>
        <button type="button" className="secondary-button" onClick={onRefresh}>
          {refreshLabel}
        </button>
      </div>
      {detail.image_url && (
        <EventBanner key={detail.image_url} url={detail.image_url} />
      )}
      <p className="public-description">
        {detail.description ?? "No description provided."}
      </p>
      <dl className="event-detail-fields">
        <div>
          <dt>Starts</dt>
          <dd>{publicEventTime(detail.start_at, detail.time_zone)}</dd>
        </div>
        <div>
          <dt>Ends</dt>
          <dd>{publicEventTime(detail.end_at, detail.time_zone)}</dd>
        </div>
        <div>
          <dt>Event time zone</dt>
          <dd>{detail.time_zone ?? "Not configured"}</dd>
        </div>
        <div>
          <dt>Public location</dt>
          <dd>{detail.public_location ?? "Location not provided"}</dd>
        </div>
      </dl>
      <h2>Registration policy</h2>
      <PublicPolicy event={detail} />
      <RegistrationPanel
        key={detail.event_id}
        eventId={detail.event_id}
        event={detail}
        privateProof={privateProof}
      />
      <p className="freshness">
        Event confirmed {new Date(detail.as_of).toLocaleString()}.
      </p>
    </article>
  );
}
