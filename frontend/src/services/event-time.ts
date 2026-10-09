export const DEFAULT_EVENT_TIME_ZONE = "Asia/Kolkata";

const locationLabels: Record<string, string> = {
  "Asia/Kolkata": "India Standard Time (IST, UTC+05:30)",
  "Asia/Calcutta": "India Standard Time (IST, UTC+05:30)",
  "America/New_York": "New York / United States",
  "America/Los_Angeles": "Los Angeles / United States",
  "Europe/London": "London / United Kingdom",
  "Asia/Dubai": "Dubai / United Arab Emirates",
  "Asia/Singapore": "Singapore",
  "Asia/Tokyo": "Tokyo / Japan",
  "Australia/Sydney": "Sydney / Australia",
  UTC: "Coordinated Universal Time",
};

export function timeZoneLabel(zone: string | null): string {
  if (!zone) return "Not configured";
  if (zone === DEFAULT_EVENT_TIME_ZONE) return locationLabels[zone];
  return `${locationLabels[zone] ?? zone.split("/").reverse().join(" / ").replaceAll("_", " ")} (${zone})`;
}

export function timeZoneOptions(current = ""): string[] {
  // The India MVP keeps setup short without dropping an existing event's zone.
  return [...new Set([DEFAULT_EVENT_TIME_ZONE, ...(current ? [current] : [])])];
}

export function formatEventTime(
  timestamp: string | null,
  zone: string | null,
  purpose: "schedule" | "date" | "time" = "schedule",
): string {
  if (!timestamp) return "Not configured";
  if (!zone) return "Set the event time zone to view this time";
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      ...(purpose === "date"
        ? { dateStyle: "medium" as const }
        : purpose === "time"
          ? { timeStyle: "short" as const }
          : { dateStyle: "medium" as const, timeStyle: "short" as const }),
    }).format(new Date(timestamp));
  } catch {
    return "Time unavailable";
  }
}

function wallParts(timestamp: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.${get("fractionalSecond")}`;
}

export function eventTimeInput(
  timestamp: string | null,
  zone: string | null,
): string {
  if (!timestamp || !zone) return "";
  try {
    return wallParts(Date.parse(timestamp), zone)
      .replace(/:00\.000$/, "")
      .replace(/\.000$/, "");
  } catch {
    return "";
  }
}

// Match the entered wall time against actual offsets around that date. A gap
// has no match; an overlap has two. Neither may silently move an event schedule.
export function serializeEventTime(local: string, zone: string): string | null {
  if (!local) return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      local,
    );
  if (!match) throw new Error("Enter both a date and a time.");
  if (!zone)
    throw new Error("Choose a time zone before saving dates and times.");
  const wall = `${match[1]}T${match[2]}:${match[3] ?? "00"}.${(match[4] ?? "").padEnd(3, "0")}`;
  const epoch = Date.parse(`${wall}Z`);
  if (
    !Number.isFinite(epoch) ||
    new Date(epoch).toISOString().slice(0, -1) !== wall
  )
    throw new Error("Enter a valid date and time.");
  const offsets = new Set<number>();
  try {
    for (let hours = -48; hours <= 48; hours += 6) {
      const instant = epoch + hours * 3600000;
      offsets.add(Date.parse(`${wallParts(instant, zone)}Z`) - instant);
    }
  } catch {
    throw new Error("Choose a valid time zone.");
  }
  const candidates = [...offsets]
    .map((offset) => epoch - offset)
    .filter((instant) => wallParts(instant, zone) === wall);
  if (!candidates.length)
    throw new Error(
      "This time does not exist because the clocks change. Choose another time.",
    );
  if (candidates.length > 1)
    throw new Error(
      "This time occurs twice because the clocks change. Choose an unambiguous time.",
    );
  return new Date(candidates[0]).toISOString();
}
