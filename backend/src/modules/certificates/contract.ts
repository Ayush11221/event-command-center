import { PDFDocument, StandardFonts } from "pdf-lib";
import { ApiError } from "../auth/errors.js";

export const RULE = "CERT_ELIGIBILITY_V1";
export const PDF_LIMIT = 1024 * 1024;
export const templates = ["classic", "modern", "minimal"] as const;
export const fonts = ["sans", "serif"] as const;
export interface Selection {
  template_id: (typeof templates)[number];
  template_version: 1;
  font_id: (typeof fonts)[number];
}
export function objectBody(value: unknown, allowed: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new ApiError(400, "VALIDATION", "Invalid command body");
  return value as Record<string, unknown>;
}
export function selection(value: unknown): Selection {
  const body = objectBody(value, [
    "template_id",
    "template_version",
    "font_id",
  ]);
  if (
    !templates.includes(body.template_id as Selection["template_id"]) ||
    body.template_version !== 1 ||
    !fonts.includes(body.font_id as Selection["font_id"])
  )
    throw new ApiError(
      400,
      "VALIDATION",
      "Select a supported template, version and font",
    );
  return body as unknown as Selection;
}
let characterSet: Promise<Set<number>> | undefined;
export async function normalizeName(value: unknown) {
  const body = objectBody(value, ["recipient_name"]);
  if (typeof body.recipient_name !== "string")
    throw new ApiError(400, "VALIDATION", "Recipient name is required");
  const name = body.recipient_name.normalize("NFC").trim();
  if ([...name].length < 2 || [...name].length > 100)
    throw new ApiError(
      400,
      "VALIDATION",
      "Recipient name must contain 2–100 characters",
    );
  if (
    !/^[\p{Script=Latin} '\u2018\u2019.\-]+$/u.test(name) ||
    !/\p{L}/u.test(name)
  )
    throw new ApiError(
      422,
      "NAME_NOT_RENDERABLE",
      "Use supported Latin letters and name punctuation",
    );
  characterSet ??= PDFDocument.create().then((doc) => {
    const sans = doc
      .embedStandardFont(StandardFonts.Helvetica)
      .getCharacterSet();
    const serif = new Set(
      doc.embedStandardFont(StandardFonts.TimesRoman).getCharacterSet(),
    );
    return new Set(sans.filter((point) => serif.has(point)));
  });
  const supported = await characterSet;
  if ([...name].some((character) => !supported.has(character.codePointAt(0)!)))
    throw new ApiError(
      422,
      "NAME_NOT_RENDERABLE",
      "Name cannot be rendered with the supported fonts",
    );
  return name;
}
export function revokeReason(value: unknown) {
  const body = objectBody(value, ["reason"]);
  if (body.reason === undefined) return null;
  if (
    typeof body.reason !== "string" ||
    [...body.reason.trim()].length > 200 ||
    /[\p{Cc}\p{Cf}]/u.test(body.reason)
  )
    throw new ApiError(400, "VALIDATION", "Invalid revocation reason");
  return body.reason.trim() || null;
}
export function issueDate(time: Date | string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(time));
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
