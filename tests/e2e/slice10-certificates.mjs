// Disposable migrated PostgreSQL + running production Node/Vite builds.
// Reuses an existing Playwright installation; no dependencies are installed.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../../backend/dist/config/database.js";
import { signAccountToken } from "../../backend/dist/modules/auth/tokens.js";
import {
  encryptContact,
  normalizeContact,
} from "../../backend/dist/modules/auth/contact.js";
import { issueCredential } from "../../backend/dist/modules/registrations/credential.js";
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
assert.match(url.pathname, /test/);
const secret = Buffer.from(process.env.SLICE10_TEST_JWT_SECRET ?? "", "hex"),
  key = Buffer.from(process.env.SLICE10_TEST_CONTACT_KEY ?? "", "hex");
assert.equal(secret.length, 32);
assert.equal(key.length, 32);
const base = process.env.SLICE10_FRONTEND_ORIGIN ?? "http://127.0.0.1:5180",
  api = process.env.SLICE10_API_ORIGIN ?? "http://127.0.0.1:3010";
assert.equal(new URL(base).hostname, "127.0.0.1");
assert.equal(new URL(api).hostname, "127.0.0.1");
const { chromium } = await import(
  process.env.SLICE10_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.SLICE10_PLAYWRIGHT_MODULE).href
    : "playwright"
);
const db = createDatabase(url.href),
  browser = await chromium.launch({ headless: true }),
  artifacts = await mkdtemp(join(tmpdir(), "slice10-browser-")),
  errors = [];
try {
  async function actor(organizerCapable = false) {
    const user = await db.user.create({ data: { organizerCapable } }),
      session = await db.session.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + 900000) },
      });
    const contact = normalizeContact(
      "EMAIL",
      `${randomUUID()}@example.invalid`,
      key,
    );
    await db.verifiedContact.create({
      data: {
        userId: user.id,
        type: "EMAIL",
        lookupHash: contact.lookupHash,
        encrypted: encryptContact(contact.value, key),
        verifiedAt: new Date(),
      },
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
  const staff = await actor(true),
    owner = await actor();
  const event = await db.event.create({
    data: {
      ownerUserId: staff.user.id,
      name: "Slice 10 browser event",
      state: "LIVE",
      visibility: "PUBLIC",
      startAt: new Date(Date.now() + 3600000),
      endAt: new Date(Date.now() + 7200000),
      timeZone: "UTC",
      registrationCapacity: 100,
    },
  });
  const row = await db.registration.create({
      data: { eventId: event.id, userId: owner.user.id },
    }),
    gate = await db.gate.create({ data: { eventId: event.id } }),
    credential = await db.qRCredential.create({
      data: { registrationId: row.id, ...issueCredential(row.id, key) },
    });
  await db.$transaction(async (tx) => {
    const at = new Date(),
      scan = await tx.scanDecision.create({
        data: {
          scanId: randomUUID(),
          eventId: event.id,
          gateId: gate.id,
          operatorUserId: staff.user.id,
          registrationId: row.id,
          credentialId: credential.id,
          decision: "ACCEPTED",
          reason: "ACCEPTED",
          decidedAt: at,
          correlationId: randomUUID(),
        },
      });
    await tx.attendanceTransition.create({
      data: {
        eventId: event.id,
        gateId: gate.id,
        operatorUserId: staff.user.id,
        registrationId: row.id,
        scanDecisionId: scan.id,
        acceptedAt: at,
      },
    });
  });
  await owner.page.goto(`${base}/registrations/${row.id}`);
  await owner.page
    .getByLabel("Certificate recipient name", { exact: true })
    .fill("Browser Recipient");
  const saved = owner.page.waitForResponse(
    (response) =>
      response.url().endsWith("/certificate/recipient-name") &&
      response.request().method() === "POST",
  );
  await owner.page.getByRole("button", { name: "Save recipient name" }).click();
  assert.equal((await saved).status(), 200);
  await staff.page.goto(`${base}/certificates/${event.id}`);
  assert.match(await staff.page.title(), /Certificates/);
  await staff.page
    .getByRole("heading", { name: "Batch certificate issuance" })
    .waitFor();
  const selection = [row.id, ...Array.from({ length: 25 }, () => randomUUID())];
  const ids = staff.page.getByLabel(
    "Registration IDs (1–100, separated by spaces or commas)",
  );
  await ids.fill(selection.join("\n"));
  await ids.focus();
  assert.equal(
    await ids.evaluate((element) => document.activeElement === element),
    true,
  );
  await staff.page
    .getByRole("button", { name: "Review batch selection" })
    .click();
  await staff.page.getByText(/Confirm issuance for 26/).waitFor();
  const accepted = staff.page.waitForResponse(
    (response) =>
      response.url().endsWith("/certificate-batches") &&
      response.request().method() === "POST",
  );
  await staff.page
    .getByRole("button", { name: "Confirm batch issuance" })
    .click();
  const response = await accepted;
  assert.equal(response.status(), 202);
  const batch = (await response.json()).batch;
  for (let i = 0; i < 45; i++) {
    const status = await staff.context.request.get(
      `${api}/api/v1/events/${event.id}/certificate-batches/${batch.batch_id}`,
    );
    const progress = (await status.json()).batch;
    if (progress.status === "PARTIAL_FAILED") break;
    if (i === 44) throw new Error("Batch did not complete");
    await staff.page.waitForTimeout(1000);
  }
  await staff.page
    .getByRole("button", { name: "Refresh batch progress" })
    .click();
  await staff.page
    .getByText(/PARTIAL_FAILED: 1 successful, 25 failed, 0 pending/)
    .waitFor();
  await staff.page.getByRole("button", { name: "Next item page" }).click();
  await staff.page
    .getByRole("button", { name: "First item page" })
    .waitFor({ state: "visible" });
  await staff.page.waitForFunction(
    () =>
      document.querySelectorAll("ul.certificate-identifiers li").length === 1,
  );
  await staff.page.getByRole("button", { name: "First item page" }).click();
  await staff.page.waitForFunction(
    () =>
      document.querySelectorAll("ul.certificate-identifiers li").length === 25,
  );
  await staff.page.getByLabel("Registration ID", { exact: true }).fill(row.id);
  await staff.page
    .getByRole("button", { name: "Read certificate status" })
    .click();
  await staff.page
    .getByRole("heading", { name: "Certificate status: ISSUED" })
    .waitFor();
  for (let i = 0; i < 10; i++) {
    const delivery = await db.certificateDelivery.findFirst({
      where: { eventId: event.id },
    });
    if (delivery?.status === "FAILED") break;
    await staff.page.waitForTimeout(500);
  }
  await staff.page
    .getByRole("button", { name: "Refresh delivery status" })
    .click();
  await staff.page.getByText("FAILED", { exact: true }).waitFor();
  const retry = staff.page.waitForResponse(
    (r) =>
      r.url().endsWith("/delivery/retry") && r.request().method() === "POST",
  );
  await staff.page
    .getByRole("button", { name: "Retry failed delivery" })
    .click();
  assert.equal((await retry).status(), 202);
  await owner.page.reload();
  await owner.page.getByRole("heading", { name: "Email delivery" }).waitFor();
  assert.equal(
    await owner.page
      .getByRole("button", { name: "Retry failed delivery" })
      .count(),
    0,
  );
  for (const [width, mode] of [
    [1366, "light"],
    [360, "dark"],
    [360, "system"],
  ]) {
    await staff.page.setViewportSize({ width, height: 900 });
    await staff.page.getByLabel("Appearance").selectOption(mode);
    assert.equal(
      await staff.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await staff.page.screenshot({
      path: join(artifacts, `staff-${width}-${mode}.png`),
      fullPage: true,
    });
  }
  await owner.page.setViewportSize({ width: 360, height: 800 });
  await owner.page.getByLabel("Appearance").selectOption("dark");
  assert.equal(
    await owner.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await owner.page.screenshot({
    path: join(artifacts, "owner-360-dark.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    `Slice 10 Chromium batch/confirmation/progress/pagination/staff retry/owner isolation passed; artifacts: ${artifacts}`,
  );
} finally {
  await browser.close();
  await db.$disconnect();
}
