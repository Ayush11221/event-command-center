// Run against disposable migrated PostgreSQL and built Node/Vite applications.
// Reuses an existing Playwright installation; screenshots stay outside the repo.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../../backend/dist/config/database.js";
import { signAccountToken } from "../../backend/dist/modules/auth/tokens.js";
import {
  encryptContact,
  normalizeContact,
} from "../../backend/dist/modules/auth/contact.js";
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
assert.match(url.pathname, /test|verified/);
const secret = Buffer.from(process.env.SLICE11_TEST_JWT_SECRET ?? "", "hex"),
  key = Buffer.from(process.env.SLICE11_TEST_CONTACT_KEY ?? "", "hex");
assert.equal(secret.length, 32);
assert.equal(key.length, 32);
const base = process.env.SLICE11_FRONTEND_ORIGIN ?? "http://127.0.0.1:5181",
  api = process.env.SLICE11_API_ORIGIN ?? "http://127.0.0.1:3011";
assert.equal(new URL(base).hostname, "127.0.0.1");
assert.equal(new URL(api).hostname, "127.0.0.1");
const { chromium } = await import(
  process.env.SLICE11_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.SLICE11_PLAYWRIGHT_MODULE).href
    : "playwright"
);
const db = createDatabase(url.href),
  browser = await chromium.launch({ headless: true }),
  artifacts = await mkdtemp(join(tmpdir(), "slice11-browser-")),
  errors = [],
  expectedHttp = [];
try {
  async function actor(organizerCapable = false) {
    const user = await db.user.create({ data: { organizerCapable } }),
      session = await db.session.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + 900000) },
      }),
      contact = normalizeContact(
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
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        !/Failed to load resource: the server responded with a status of (404|409)/.test(
          m.text(),
        )
      )
        errors.push(m.text());
    });
    page.on("response", (r) => {
      if (r.status() >= 400)
        expectedHttp.push({ url: r.url(), status: r.status() });
    });
    return { user, context, page };
  }
  const staff = await actor(true),
    vol = await actor(),
    other = await actor();
  const event = await db.event.create({
    data: {
      ownerUserId: staff.user.id,
      name: "Slice 11 browser event",
      state: "LIVE",
      visibility: "PUBLIC",
      startAt: new Date(Date.now() + 3600000),
      endAt: new Date(Date.now() + 7200000),
      timeZone: "UTC",
      registrationCapacity: 100,
    },
  });
  for (const who of [vol, other])
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: who.user.id,
        role: "VOLUNTEER",
        scopeKey: "EVENT",
        grantedByUserId: staff.user.id,
      },
    });
  const taskBase = `${api}/api/v1/events/${event.id}/volunteer-tasks`;
  const csrf = (
    await (await staff.context.request.get(`${api}/api/v1/auth/me`)).json()
  ).csrf_token;
  async function command(path, body, etag, method = "PATCH") {
    const r = await staff.context.request.fetch(path, {
      method,
      headers: {
        Origin: base,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": randomUUID(),
        ...(etag ? { "If-Match": etag } : {}),
      },
      data: body,
    });
    assert.equal(
      r.status(),
      method === "POST" && path === taskBase ? 201 : 200,
    );
    return r;
  }
  const page = staff.page;
  await page.goto(`${base}/tasks/${event.id}`);
  assert.match(await page.title(), /Volunteer tasks/);
  await page.getByRole("heading", { name: event.name }).waitFor();
  const create = page.getByRole("region", { name: "Create task" });
  await create.getByLabel("Title", { exact: true }).fill("Arrival desk");
  await create
    .getByLabel("Instructions", { exact: true })
    .fill("Welcome arriving participants");
  await create.getByLabel("Volunteer account ID").fill(vol.user.id);
  const accepted = page.waitForResponse(
    (r) => r.url() === taskBase && r.request().method() === "POST",
  );
  await create.getByRole("button", { name: "Create task" }).click();
  const response = await accepted;
  assert.equal(response.status(), 201);
  const task = (await response.json()).task;
  const detail = page.getByRole("region", { name: "Task details" });
  await detail
    .getByLabel("Title", { exact: true })
    .fill("Arrival desk updated");
  await detail.getByRole("button", { name: "Save details" }).click();
  await detail.getByRole("heading", { name: "Arrival desk updated" }).waitFor();
  await detail.getByLabel("New volunteer account ID").fill(other.user.id);
  await detail.getByRole("button", { name: "Reassign task" }).click();
  await detail
    .getByText(`Assigned account: ${other.user.id}`, { exact: true })
    .waitFor();
  await detail.getByLabel("New volunteer account ID").fill(vol.user.id);
  await detail.getByRole("button", { name: "Reassign task" }).click();
  await detail
    .getByText(`Assigned account: ${vol.user.id}`, { exact: true })
    .waitFor();
  await vol.page.goto(`${base}/volunteer`);
  await vol.page.getByRole("link", { name: /View assigned event/ }).click();
  await vol.page.getByRole("link", { name: /Arrival desk updated/ }).click();
  await vol.page.getByRole("button", { name: "Start task" }).waitFor();
  assert.equal(
    await vol.page.getByRole("link", { name: "Event workspace" }).count(),
    0,
  );
  assert.equal(
    await vol.page.getByRole("button", { name: "Cancel task" }).count(),
    0,
  );
  await vol.page.getByRole("button", { name: "Start task" }).click();
  await vol.page.getByRole("button", { name: "Complete task" }).waitFor();
  await vol.page.getByRole("button", { name: "Complete task" }).click();
  await vol.page.getByText("This task is read-only.").waitFor();
  const stale = (
    await (
      await command(
        taskBase,
        {
          assigned_volunteer_id: vol.user.id,
          title: "Stale task",
          instructions: "Check schedule",
          location: null,
          starts_at: null,
          ends_at: null,
        },
        null,
        "POST",
      )
    ).json()
  ).task;
  await page.getByRole("button", { name: "Refresh tasks" }).click();
  await page.getByRole("button", { name: /Stale task/ }).click();
  await detail.getByRole("heading", { name: "Stale task" }).waitFor();
  await command(
    `${taskBase}/${stale.id}`,
    { title: "Changed externally" },
    '"1"',
  );
  await detail.getByLabel("Title", { exact: true }).fill("Old revision edit");
  await detail.getByRole("button", { name: "Save details" }).click();
  await page.getByText(/The task changed/).waitFor();
  assert.equal(
    await detail.getByRole("button", { name: "Save details" }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Refresh tasks" }).click();
  await page.getByRole("button", { name: /Changed externally/ }).click();
  await detail.getByLabel("Cancellation reason").fill("Shift removed");
  await detail.getByRole("button", { name: "Cancel task" }).click();
  await detail.getByText("Cancellation reason: Shift removed").waitFor();
  assert.equal(
    await detail.getByRole("button", { name: "Save details" }).count(),
    0,
  );
  await vol.page.goto(`${base}/volunteer/${event.id}/tasks`);
  await vol.page.getByRole("heading", { name: event.name }).waitFor();
  assert.equal(
    await vol.page.getByRole("link", { name: /Changed externally/ }).count(),
    0,
  );
  const active = (
    await (
      await command(
        taskBase,
        {
          assigned_volunteer_id: vol.user.id,
          title: "Revoked task",
          instructions: "Private assigned instructions",
          location: null,
          starts_at: null,
          ends_at: null,
        },
        null,
        "POST",
      )
    ).json()
  ).task;
  await vol.page.goto(`${base}/volunteer/${event.id}/tasks/${active.id}`);
  await vol.page.getByRole("button", { name: "Start task" }).waitFor();
  await db.eventRoleAssignment.updateMany({
    where: {
      eventId: event.id,
      userId: vol.user.id,
      role: "VOLUNTEER",
      revokedAt: null,
    },
    data: { revokedAt: new Date(), revokedByUserId: staff.user.id },
  });
  await vol.page.getByRole("button", { name: "Refresh tasks" }).click();
  await vol.page.getByRole("alert").waitFor();
  assert.equal(
    await vol.page
      .getByText("Private assigned instructions", { exact: true })
      .count(),
    0,
  );
  await page.goto(`${base}/results/${event.id}`);
  await page.getByText(/Results are available after/).waitFor();
  await db.event.update({
    where: { id: event.id },
    data: { state: "COMPLETED" },
  });
  await db.gate.create({ data: { eventId: event.id } });
  await page.getByRole("button", { name: "Refresh results" }).click();
  await page.getByText("Attendance percentage", { exact: true }).waitFor();
  await page.getByText(/As of/).waitFor();
  await page
    .getByText("No persisted historical occupancy series is available.")
    .waitFor();
  await page.goto(`${base}/audit/${event.id}`);
  await page.getByRole("region", { name: "Audit records" }).waitFor();
  await page.getByLabel("Action (exact)").fill("VOLUNTEER_TASK_CANCELLED");
  await page.getByRole("button", { name: "Search audit" }).click();
  await page
    .getByRole("cell", { name: "VOLUNTEER_TASK_CANCELLED", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Shift removed", { exact: true }).count(),
    0,
  );
  for (let i = 0; i < 27; i++)
    await db.auditEvent.create({
      data: {
        eventId: event.id,
        actorKind: "SYSTEM",
        action: "SLICE11_BROWSER_EVIDENCE",
        outcome: "SUCCESS",
        correlationId: randomUUID(),
      },
    });
  await page.getByLabel("Action (exact)").fill("SLICE11_BROWSER_EVIDENCE");
  await page.getByRole("button", { name: "Search audit" }).click();
  await page.getByRole("button", { name: "Next audit records" }).click();
  await page
    .getByRole("cell", { name: "SLICE11_BROWSER_EVIDENCE", exact: true })
    .first()
    .waitFor();
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("td")).filter(
        (cell) => cell.textContent === "SLICE11_BROWSER_EVIDENCE",
      ).length === 2,
  );
  assert.equal(
    await page
      .getByRole("cell", { name: "SLICE11_BROWSER_EVIDENCE", exact: true })
      .count(),
    2,
  );
  for (const [surface, path, heading] of [
    ["tasks", `/tasks/${event.id}`, "Volunteer tasks"],
    ["results", `/results/${event.id}`, "Completed event results"],
    ["audit", `/audit/${event.id}`, "Event audit evidence"],
  ]) {
    await page.goto(base + path);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    await page
      .getByRole("button", {
        name:
          surface === "tasks"
            ? "Refresh tasks"
            : surface === "results"
              ? "Refresh results"
              : "Search audit",
      })
      .waitFor();
    for (const [size, viewport] of [
      ["desktop", { width: 1366, height: 900 }],
      ["mobile", { width: 360, height: 800 }],
    ]) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark", "system"]) {
        await page
          .getByLabel("Appearance", { exact: true })
          .selectOption(theme);
        if (theme === "system") {
          await page.emulateMedia({ colorScheme: "dark" });
          await page.waitForFunction(
            () => document.documentElement.dataset.theme === "dark",
          );
          assert.equal(
            await page.locator("html").getAttribute("data-theme"),
            "dark",
          );
          await page.emulateMedia({ colorScheme: "light" });
          await page.waitForFunction(
            () => document.documentElement.dataset.theme === "light",
          );
          assert.equal(
            await page.locator("html").getAttribute("data-theme"),
            "light",
          );
        }
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: join(artifacts, `${surface}-${size}-${theme}.png`),
          fullPage: true,
        });
      }
    }
  }
  await page.getByRole("button", { name: "Skip to main content" }).focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator("main").evaluate((el) => document.activeElement === el),
    true,
  );
  assert.deepEqual(errors, []);
  assert.ok(
    expectedHttp.every((r) => [404, 409].includes(r.status)),
    JSON.stringify(expectedHttp),
  );
  const report = {
    status: "PASS",
    browser: "Playwright fallback: Browser plugin unavailable",
    viewports: ["1366x900", "360x800"],
    themes: ["Light", "Dark", "System with OS changes"],
    journeys: [
      "staff create/edit/reassign",
      "volunteer start/complete",
      "cancel/history",
      "stale revision",
      "revoked grant clears data",
      "completed-only results",
      "audit filters/pagination/redaction",
      "keyboard focus",
    ],
    runtimeErrors: errors,
    expectedDenials: expectedHttp.map((r) => ({
      status: r.status,
      path: new URL(r.url).pathname,
    })),
    artifacts,
  };
  await writeFile(
    join(artifacts, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await db.$disconnect();
}
