import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { ApiError } from "../auth/errors.js";
import { PDF_LIMIT, issueDate, type Selection } from "./contract.js";

export interface RenderInput extends Selection {
  recipientName: string;
  eventName: string;
  eventStartAt: string;
  eventTimeZone: string;
  issuedAt: string;
  certificateNumber: string;
  preview: boolean;
}
export async function renderDocument(input: RenderInput) {
  const doc = await PDFDocument.create();
  const font = doc.embedStandardFont(
    input.font_id === "sans"
      ? StandardFonts.Helvetica
      : StandardFonts.TimesRoman,
  );
  for (const [field, text] of [
    ["recipient_name", input.recipientName],
    ["event_name", input.eventName],
  ]) {
    try {
      font.encodeText(text);
    } catch {
      throw new ApiError(
        422,
        field === "recipient_name" ? "NAME_NOT_RENDERABLE" : "VALIDATION",
        "Certificate text cannot be rendered",
        { details: { field } },
      );
    }
  }
  const page = doc.addPage([841.89, 595.28]);
  const ink = rgb(0.12, 0.18, 0.22);
  if (input.template_id === "classic") {
    page.drawRectangle({
      x: 25,
      y: 25,
      width: 792,
      height: 545,
      borderWidth: 2,
      borderColor: ink,
    });
    page.drawRectangle({
      x: 32,
      y: 32,
      width: 778,
      height: 531,
      borderWidth: 0.5,
      borderColor: ink,
    });
  } else if (input.template_id === "modern") {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 24,
      height: 595,
      color: rgb(0.1, 0.34, 0.4),
    });
    page.drawLine({
      start: { x: 65, y: 465 },
      end: { x: 777, y: 465 },
      color: ink,
      thickness: 2,
    });
  } else
    page.drawLine({
      start: { x: 65, y: 100 },
      end: { x: 777, y: 100 },
      color: ink,
      thickness: 0.7,
    });
  const centered = (
    text: string,
    y: number,
    initial: number,
    maximumLines = 1,
    minimumY = 0,
  ) => {
    const wrap = (size: number) => {
      const lines: string[] = [];
      let line = "";
      for (const character of text) {
        if (line && font.widthOfTextAtSize(line + character, size) > 710) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
      lines.push(line);
      return lines;
    };
    let size = initial,
      lines = wrap(size);
    const fits = () =>
      lines.length <= maximumLines &&
      y - (lines.length - 1) * (size + 4) >= minimumY;
    while (!fits() && size > 10) {
      size--;
      lines = wrap(size);
    }
    if (!fits())
      throw new ApiError(
        422,
        "VALIDATION",
        "Certificate text exceeds the template bounds",
      );
    lines.forEach((line, index) =>
      page.drawText(line, {
        x: (842 - font.widthOfTextAtSize(line, size)) / 2,
        y: y - index * (size + 4),
        size,
        font,
        color: ink,
      }),
    );
  };
  centered("Certificate of attendance", 490, 30);
  centered(input.recipientName, 380, 36, 3, 326);
  centered("attended", 300, 16);
  centered(input.eventName, 255, 24, 3, 214);
  centered(
    `Event date: ${issueDate(input.eventStartAt, input.eventTimeZone)}`,
    190,
    14,
  );
  centered(`Certificate number: ${input.certificateNumber}`, 135, 11);
  centered(
    `Issue date: ${issueDate(input.issuedAt, input.eventTimeZone)}`,
    110,
    11,
  );
  if (input.preview)
    page.drawText("PREVIEW", {
      x: 210,
      y: 150,
      size: 80,
      font,
      rotate: degrees(25),
      opacity: 0.2,
      color: ink,
    });
  doc.setTitle(
    input.preview ? "Certificate preview" : "Certificate of attendance",
  );
  const bytes = await doc.save();
  if (bytes.byteLength > PDF_LIMIT)
    throw new ApiError(422, "VALIDATION", "PDF exceeds the size limit");
  return bytes;
}
