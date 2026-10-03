import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { normalizeName, selection, issueDate } from "./contract.js";
import { renderDocument, type RenderInput } from "./pdf.js";
import { renderPdf } from "./renderer.js";

const input: RenderInput = {
  template_id: "classic",
  template_version: 1,
  font_id: "sans",
  recipientName: "Zoë O’Neil",
  eventName: "Attendance event",
  eventStartAt: "2026-10-03T12:00:00Z",
  eventTimeZone: "Asia/Kolkata",
  issuedAt: "2026-10-03T13:00:00Z",
  certificateNumber: "PREVIEW",
  preview: true,
};
describe("Slice 9 bounded PDF and recipient input", () => {
  it("normalizes without silently replacing unsupported characters", async () => {
    expect(
      await normalizeName({ recipient_name: "  Zoe\u0308 O’Neil  " }),
    ).toBe("Zoë O’Neil");
    for (const recipient_name of ["", "A", "A".repeat(101)])
      await expect(normalizeName({ recipient_name })).rejects.toMatchObject({
        status: 400,
        code: "VALIDATION",
      });
    for (const recipient_name of [
      "你好",
      "Alice\nSmith",
      "Alice 😀",
      "Łukasz",
      "--",
      "A<script>",
    ])
      await expect(normalizeName({ recipient_name })).rejects.toMatchObject({
        status: 422,
        code: "NAME_NOT_RENDERABLE",
      });
    await expect(
      normalizeName({ recipient_name: "Alice", staff: true }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("accepts only the exact code-defined selection", () => {
    expect(
      selection({
        template_id: "minimal",
        template_version: 1,
        font_id: "serif",
      }).font_id,
    ).toBe("serif");
    for (const body of [
      {},
      { template_id: "upload", template_version: 1, font_id: "sans" },
      { template_id: "classic", template_version: 2, font_id: "sans" },
      {
        template_id: "classic",
        template_version: 1,
        font_id: "sans",
        recipient_name: "Substitute",
      },
    ])
      expect(() => selection(body)).toThrow();
  });
  it.each(["classic", "modern", "minimal"] as const)(
    "renders %s with both fonts into one bounded PDF page",
    async (template_id) => {
      for (const font_id of ["sans", "serif"] as const) {
        const bytes = await renderDocument({ ...input, template_id, font_id });
        expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
        expect(bytes.length).toBeLessThan(1048576);
        const doc = await PDFDocument.load(bytes);
        expect(doc.getPageCount()).toBe(1);
        expect(doc.getPage(0).getWidth()).toBeGreaterThan(
          doc.getPage(0).getHeight(),
        );
      }
    },
  );
  it("returns safe permanent errors for unrenderable event and recipient text", async () => {
    await expect(
      renderDocument({ ...input, recipientName: "你好" }),
    ).rejects.toMatchObject({ code: "NAME_NOT_RENDERABLE" });
    await expect(
      renderDocument({ ...input, eventName: "你好" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      details: { field: "event_name" },
    });
  });
  it("wraps maximum-length supported names and event names without truncation or page growth", async () => {
    const bytes = await renderDocument({
      ...input,
      recipientName: "W".repeat(100),
      eventName: "W".repeat(200),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("uses the event time zone across day boundaries", () => {
    expect(issueDate("2026-10-03T23:00:00Z", "Asia/Kolkata")).toBe(
      "2026-10-04",
    );
  });
  it("keeps wrapped recipient and event text clear of adjoining printed fields", async () => {
    const drawing = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      await renderDocument({
        ...input,
        recipientName: "A".repeat(100),
        eventName: "B".repeat(200),
      });
      const names = drawing.mock.calls.filter(([text]) => /^A+$/.test(text));
      const events = drawing.mock.calls.filter(([text]) => /^B+$/.test(text));
      expect(names.map(([text]) => text).join("")).toBe("A".repeat(100));
      expect(events.map(([text]) => text).join("")).toBe("B".repeat(200));
      const attended = drawing.mock.calls.find(
        ([text]) => text === "attended",
      )![1]!;
      const date = drawing.mock.calls.find(([text]) =>
        text.startsWith("Event date:"),
      )![1]!;
      expect(
        Math.min(...names.map(([, options]) => options!.y!)),
      ).toBeGreaterThan(attended.y! + attended.size!);
      expect(
        Math.min(...events.map(([, options]) => options!.y!)),
      ).toBeGreaterThan(date.y! + date.size!);
    } finally {
      drawing.mockRestore();
    }
  });
  it("renders through the isolated production worker and enforces one active renderer", async () => {
    const first = renderPdf(input);
    await expect(renderPdf(input)).rejects.toMatchObject({ status: 503 });
    expect((await first).byteLength).toBeGreaterThan(0);
  });
});
