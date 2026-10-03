import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture, api, origin } from "./fixture.mjs";
const f = await fixture(),
  browser = await chromium.launch(),
  checks = [],
  errors = [];
await mkdir(".artifacts/release/browser", { recursive: true });
try {
  const participant = await f.actor(),
    volunteer = await f.actor();
  await f.db.eventRoleAssignment.create({
    data: {
      eventId: f.event.id,
      scopeKey: "EVENT",
      userId: volunteer.id,
      role: "VOLUNTEER",
      grantedByUserId: f.staff.id,
    },
  });
  const registration = await api(
    `/events/${f.event.id}/registrations`,
    participant,
    { method: "POST", body: "{}" },
  );
  assert.equal(registration.status, 201);
  const row = await f.db.registration.findFirstOrThrow({
    where: { eventId: f.event.id, userId: participant.id },
  });
  const completed = await f.db.event.create({
    data: {
      ownerUserId: f.staff.id,
      name: "Completed synthetic release event",
      state: "COMPLETED",
      startAt: new Date(Date.now() - 7200000),
      endAt: new Date(Date.now() - 3600000),
      timeZone: "UTC",
      registrationCapacity: 10,
    },
  });
  const surfaces = [
    ["authentication-otp", "/", null],
    ["discovery", "/events", null],
    ["registration", `/events/${f.event.id}`, participant],
    ["qr-credential", `/registrations/${row.id}`, participant],
    ["scanner", "/scanner", f.scanner],
    ["command-center-forecast", `/operations/${f.event.id}`, f.staff],
    ["certificates-batch", `/certificates/${f.event.id}`, f.staff],
    ["volunteer-tasks", `/volunteer/${f.event.id}/tasks`, volunteer],
    ["staff-tasks", `/tasks/${f.event.id}`, f.staff],
    ["results", `/results/${completed.id}`, f.staff],
    ["audit-search", `/audit/${f.event.id}`, f.staff],
  ];
  for (const [width, height] of [
    [1366, 900],
    [360, 800],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      ignoreHTTPSErrors: true,
    });
    // The disposable Caddy CA is verified separately with Node's explicit trust.
    // Browser certificate bypass is test-context-only, never deployment config.
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [name, path, actor] of surfaces) {
      await context.clearCookies();
      if (actor)
        await context.addCookies([
          {
            name: "eoc_session",
            value: actor.token,
            url: origin + "/api/v1",
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ]);
      await page.goto(origin + path);
      await page.waitForLoadState("networkidle");
      if (name === "qr-credential") {
        await page
          .getByRole("button", { name: "View my QR credential" })
          .click();
        await page.getByRole("img").waitFor();
      }
      assert.ok(await page.title());
      assert.ok((await page.locator("main").innerText()).trim());
      assert.equal(await page.locator("vite-error-overlay").count(), 0);
      for (const theme of ["Light", "Dark"]) {
        const themeSelector = page.getByLabel("Appearance", { exact: true });
        if (await themeSelector.count())
          await themeSelector.selectOption(theme.toLowerCase());
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        checks.push({
          surface: name,
          width,
          theme,
          violations: result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => n.target),
          })),
        });
      }
      await page.getByRole("button", { name: "Skip to main content" }).focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await page
          .locator("main")
          .evaluate((element) => document.activeElement === element),
        true,
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(
          () =>
            ![document.body, document.documentElement].includes(
              document.activeElement,
            ),
        ),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: `.artifacts/release/browser/${name}-${width}.png`,
        fullPage: true,
      });
    }
    await context.close();
  }
  const report = {
    status:
      checks.some((c) => c.violations.length) || errors.length
        ? "NOT MET"
        : "PASS",
    tool: "Playwright + axe; Browser plugin not available",
    checks,
    runtime_errors: errors,
    manual_scope:
      "skip-link and following Tab focus, QR reveal, mobile reflow, desktop/mobile visual screenshots; screen reader speech and universal WCAG compliance NOT MEASURED",
  };
  await writeFile(
    ".artifacts/release/accessibility.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await f.db.$disconnect();
}
