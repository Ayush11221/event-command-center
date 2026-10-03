// Run against disposable migrated PostgreSQL and locally running Node/Vite.
// Build backend first. Set TEST_DATABASE_URL, SLICE9_PLAYWRIGHT_MODULE (optional),
// and SLICE9_TEST_JWT_SECRET / SLICE9_TEST_CONTACT_KEY to the local server keys.
// Fixtures are retained in the disposable database; artifacts go outside the repo.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../../backend/dist/config/database.js";
import { signAccountToken } from "../../backend/dist/modules/auth/tokens.js";
import { issueCredential } from "../../backend/dist/modules/registrations/credential.js";

const databaseUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(databaseUrl.hostname));
assert.match(databaseUrl.pathname, /test/);
const secret = Buffer.from(process.env.SLICE9_TEST_JWT_SECRET ?? "", "hex");
const contactKey = Buffer.from(
  process.env.SLICE9_TEST_CONTACT_KEY ?? "",
  "hex",
);
assert.equal(secret.length, 32);
assert.equal(contactKey.length, 32);
const base = process.env.SLICE9_FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";
const api = process.env.SLICE9_API_ORIGIN ?? "http://127.0.0.1:3000";
assert.equal(new URL(base).hostname, "127.0.0.1");
assert.equal(new URL(api).hostname, "127.0.0.1");
const { chromium } = await import(
  process.env.SLICE9_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.SLICE9_PLAYWRIGHT_MODULE).href
    : "playwright"
);
const db = createDatabase(databaseUrl.href);
const artifacts = await mkdtemp(join(tmpdir(), "slice9-browser-"));
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  async function actor(organizerCapable = false) {
    const user = await db.user.create({ data: { organizerCapable } });
    await db.verifiedContact.create({
      data: {
        userId: user.id,
        type: "EMAIL",
        lookupHash: randomUUID().replaceAll("-", "").repeat(2),
        encrypted: "synthetic-browser-fixture",
        verifiedAt: new Date(),
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 900000) },
    });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
    });
    await context.addCookies([
      {
        name: "eoc_session",
        value: await signAccountToken(user.id, session.id, secret),
        domain: "127.0.0.1",
        path: "/api/v1",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    return { user, context, page };
  }
  const owner = await actor(),
    staff = await actor(true);
  const event = await db.event.create({
    data: {
      ownerUserId: staff.user.id,
      name: "Certificate browser verification",
      state: "LIVE",
      visibility: "PUBLIC",
      startAt: new Date(Date.now() + 3600000),
      endAt: new Date(Date.now() + 7200000),
      timeZone: "UTC",
      registrationCapacity: 1,
    },
  });
  const registration = await db.registration.create({
    data: { eventId: event.id, userId: owner.user.id },
  });
  const gate = await db.gate.create({ data: { eventId: event.id } });
  const credential = await db.qRCredential.create({
    data: {
      registrationId: registration.id,
      ...issueCredential(registration.id, contactKey),
    },
  });
  const acceptedAt = new Date();
  await db.$transaction(async (tx) => {
    const scan = await tx.scanDecision.create({
      data: {
        scanId: randomUUID(),
        eventId: event.id,
        gateId: gate.id,
        operatorUserId: staff.user.id,
        registrationId: registration.id,
        credentialId: credential.id,
        decision: "ACCEPTED",
        reason: "ACCEPTED",
        decidedAt: acceptedAt,
        correlationId: randomUUID(),
      },
    });
    await tx.attendanceTransition.create({
      data: {
        eventId: event.id,
        registrationId: registration.id,
        gateId: gate.id,
        operatorUserId: staff.user.id,
        scanDecisionId: scan.id,
        acceptedAt,
      },
    });
  });
  await owner.page.goto(`${base}/registrations/${registration.id}`);
  await owner.page
    .getByLabel("Certificate recipient name", { exact: true })
    .fill("Alice QA");
  const saved = owner.page.waitForResponse(
    (response) =>
      response.url().endsWith("/certificate/recipient-name") &&
      response.request().method() === "POST",
  );
  await owner.page
    .getByRole("button", { name: "Save recipient name", exact: true })
    .click();
  assert.equal((await saved).status(), 200);
  await owner.page
    .getByRole("button", { name: "Save recipient name", exact: true })
    .waitFor();
  await staff.page.goto(`${base}/certificates/${event.id}`);
  await staff.page
    .getByLabel("Registration ID", { exact: true })
    .fill(registration.id);
  await staff.page
    .getByRole("button", { name: "Read certificate status" })
    .click();
  await staff.page
    .getByRole("heading", { name: "Certificate status: ELIGIBLE" })
    .waitFor();
  assert.equal(
    await staff.page
      .getByLabel("Certificate recipient name", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await staff.page.getByText("Alice QA", { exact: true }).count(),
    0,
  );
  await staff.page
    .getByLabel("Template", { exact: true })
    .selectOption("modern");
  await staff.page.getByLabel("Font", { exact: true }).selectOption("serif");
  const previewed = staff.page.waitForResponse(
    (response) =>
      response.url().endsWith("/certificate/preview") &&
      response.request().method() === "POST",
  );
  await staff.page
    .getByRole("button", { name: "Preview certificate", exact: true })
    .click();
  const preview = await previewed;
  assert.equal(preview.status(), 200);
  assert.match(preview.headers()["cache-control"], /no-store/);
  await staff.page
    .getByRole("link", { name: "Open watermarked preview PDF" })
    .waitFor();
  const previewSignature = await staff.page
    .getByRole("link", { name: "Open watermarked preview PDF" })
    .evaluate(async (link) => {
      const blob = await (await fetch(link.href)).blob();
      return { size: blob.size, signature: await blob.slice(0, 8).text() };
    });
  assert.ok(previewSignature.size > 0 && previewSignature.size <= 1048576);
  assert.match(previewSignature.signature, /%PDF/);
  assert.equal(
    await db.certificate.count({ where: { registrationId: registration.id } }),
    0,
  );
  assert.equal(
    await db.certificateIssueWork.count({
      where: { registrationId: registration.id },
    }),
    0,
  );
  await staff.page
    .getByRole("button", { name: "Issue certificate", exact: true })
    .click();
  await staff.page
    .getByRole("heading", { name: "Certificate status: ISSUED" })
    .waitFor({ timeout: 15000 });
  const issued = await db.certificate.findUniqueOrThrow({
    where: { registrationId: registration.id },
  });
  assert.equal(issued.templateId, "modern");
  assert.equal(issued.fontId, "serif");
  assert.equal(
    await staff.page
      .getByRole("link", { name: "Download my certificate PDF" })
      .count(),
    0,
  );
  await owner.page.reload();
  await owner.page
    .getByRole("button", { name: "Prepare certificate download" })
    .click();
  assert.equal(
    await owner.page
      .getByLabel("Certificate recipient name", { exact: true })
      .isDisabled(),
    true,
  );
  const downloading = owner.page.waitForEvent("download");
  await owner.page
    .getByRole("link", { name: "Download my certificate PDF" })
    .click();
  const download = await downloading;
  const pdfPath = join(artifacts, "issued.pdf");
  await download.saveAs(pdfPath);
  const pdf = await readFile(pdfPath);
  assert.equal(
    createHash("sha256").update(pdf).digest("hex"),
    issued.pdfSha256,
  );

  // Visible controls retain native labels, keyboard focus, and bounded mobile layout.
  for (const { page } of [owner, staff]) {
    for (const mode of ["light", "dark", "system"]) {
      await page.emulateMedia({ colorScheme: "dark" });
      await page
        .getByRole("combobox", { name: "Appearance" })
        .selectOption(mode);
      await page.waitForFunction(
        (expected) => document.documentElement.dataset.theme === expected,
        mode === "light" ? "light" : "dark",
      );
      for (const width of [1366, 360]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
          `Overflow: ${mode}/${width}`,
        );
      }
    }
    await page.getByRole("combobox", { name: "Appearance" }).focus();
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() => document.activeElement !== document.body),
    );
    assert.equal(await page.getByRole("main").count(), 1);
    await page.screenshot({
      path: join(
        artifacts,
        page === owner.page ? "owner-mobile.png" : "staff-mobile.png",
      ),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.screenshot({
      path: join(
        artifacts,
        page === owner.page ? "owner-desktop.png" : "staff-desktop.png",
      ),
      fullPage: true,
    });
  }
  await staff.page
    .getByLabel("Revocation reason (optional, no personal data)")
    .fill("Verification run");
  await staff.page
    .getByRole("button", { name: "Revoke certificate", exact: true })
    .click();
  await staff.page
    .getByRole("button", { name: "Confirm revocation", exact: true })
    .click();
  await staff.page
    .getByRole("heading", { name: "Certificate status: REVOKED" })
    .waitFor();
  await owner.page.reload();
  await owner.page
    .getByText("This certificate has been revoked. Download is unavailable.")
    .waitFor();
  assert.equal(
    await owner.page
      .getByLabel("Certificate recipient name", { exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await owner.page
      .getByRole("link", { name: "Download my certificate PDF" })
      .count(),
    0,
  );
  const revoked = await owner.context.request.get(
    `${api}/api/v1/registrations/${registration.id}/certificate/artifact`,
  );
  assert.equal(revoked.status(), 404);
  const staffArtifact = await staff.context.request.get(
    `${api}/api/v1/registrations/${registration.id}/certificate/artifact`,
  );
  assert.equal(staffArtifact.status(), 404);
  assert.deepEqual(errors, []);
  console.log(
    `Slice 9 Chromium owner/staff workflow passed; artifacts: ${artifacts}`,
  );
} finally {
  await browser.close();
  await db.$disconnect();
}
