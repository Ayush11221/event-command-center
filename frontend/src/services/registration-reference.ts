const registrationId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const registrationReferenceHelp =
  "Paste a registration page link or registration ID. Entry QR codes, event links and participant names cannot be used here.";

// This is a convenience for staff lookup, never a credential or authority check.
// Accept only our registration route; never fetch a supplied URL.
export function parseRegistrationReference(
  value: string,
  origin: string,
): string {
  const input = value.trim();
  if (registrationId.test(input)) return input.toLowerCase();
  try {
    const url = new URL(input, origin);
    const match = /^\/registrations\/([^/]+)\/?$/.exec(url.pathname);
    if (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      match &&
      registrationId.test(match[1])
    )
      return match[1].toLowerCase();
  } catch {
    /* Invalid input has the same safe explanation. */
  }
  throw new Error(registrationReferenceHelp);
}

export function parseRegistrationSelection(
  value: string,
  origin: string,
): string[] {
  const inputs = value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (inputs.length < 1 || inputs.length > 100)
    throw new Error("Select between 1 and 100 registrations.");
  const ids = inputs.map((input) => parseRegistrationReference(input, origin));
  if (new Set(ids).size !== ids.length)
    throw new Error("Each registration should appear only once.");
  return ids;
}
