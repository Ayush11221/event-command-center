// Run: node tests/p1-c-mobile.mjs. Synthetic API/video only; no backend or device.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const { QRCodeWriter, BarcodeFormat } = createRequire(
  new URL("../frontend/package.json", import.meta.url),
)("@zxing/library");

const repo = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:5193",
  api = "http://127.0.0.1:3000";
const out = path.join(tmpdir(), "ecc-p1-c-browser");
await mkdir(out, { recursive: true });
const startServer = () =>
  spawn(
    process.execPath,
    [
      path.join(repo, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5193",
      "--strictPort",
    ],
    {
      cwd: path.join(repo, "frontend"),
      env: { ...process.env, VITE_API_ORIGIN: api },
      stdio: "pipe",
      windowsHide: true,
    },
  );
let startup = "",
  server,
  browser,
  lastPage;
const checks = [],
  errors = [],
  consoleErrors = [],
  requests = [];
const eventId = "11111111-1111-4111-8111-111111111111",
  gateId = "22222222-2222-4222-8222-222222222222";
const now = "2026-10-08T12:00:00.000Z";
const owner = {
  user_id: "owner",
  organizer_capable: true,
  csrf_token: "synthetic",
  assignments: [],
};
const scanner = {
  ...owner,
  organizer_capable: false,
  assignments: [
    {
      id: "assigned",
      event_id: eventId,
      gate_id: gateId,
      role: "GATE_SECURITY",
    },
  ],
};
const admin = {
  ...owner,
  organizer_capable: false,
  assignments: [
    { id: "admin", event_id: eventId, gate_id: null, role: "EVENT_ADMIN" },
  ],
};
const detail = {
  event_id: eventId,
  name: "TechFest 2026",
  state: "PUBLISHED",
  description: "Operations on a phone",
  visibility: "PUBLIC",
  public_location: "Community hall",
  image_url: null,
  category: "Technology",
  tags: [],
  start_at: "2026-10-20T04:30:00.000Z",
  end_at: "2026-10-20T12:30:00.000Z",
  time_zone: "Asia/Kolkata",
  registration_capacity: 200,
  registration_opens_at: null,
  registration_closes_at: null,
  registration_cancellation_cutoff_at: null,
  registration_manually_closed: false,
  checkout_enabled: false,
  gates: [{ gate_id: gateId, event_id: eventId }],
  readiness: {
    configured_gate_present: true,
    publish_blockers: [],
    live_blockers: [],
  },
  availability: {
    policy_status: "OPEN",
    reasons: [],
    opens_at: null,
    closes_at: null,
    as_of: now,
  },
  permitted_actions: ["EDIT_EVENT", "CREATE_GATE", "CANCEL"],
  revision: 3,
  as_of: now,
  correlation_id: "synthetic",
};
const staff = {
  allowed_roles: ["EVENT_ADMIN", "GATE_SECURITY", "VOLUNTEER"],
  assignments: [
    {
      id: "staff",
      userId: "sameer",
      email: "sameer.with.a.long.verified.account.address@example.test",
      role: "GATE_SECURITY",
      gateId,
      grantedAt: now,
    },
    {
      id: "volunteer",
      userId: "priya",
      email: "priya@example.test",
      role: "VOLUNTEER",
      gateId: null,
      grantedAt: now,
    },
  ],
};
const fixture = JSON.parse(
  await readFile(
    new URL("fixtures/slice8-forecast.json", import.meta.url),
    "utf8",
  ),
);
fixture.event_id = eventId;
fixture.forecast.event_id = eventId;
const snapshot = {
  event_id: eventId,
  event_name: detail.name,
  event_state: "LIVE",
  occupied: 270,
  registered: 300,
  capacity: 1,
  remaining: -269,
  utilization_percentage: 27000,
  attendance_state: "INSIDE",
  last_attendance_at: fixture.as_of,
  calculated_at: fixture.as_of,
  as_of: fixture.as_of,
  correlation_id: "synthetic",
  revision: fixture.observed.revision,
};
const qr = (value) => {
  const matrix = new QRCodeWriter().encode(
    value,
    BarcodeFormat.QR_CODE,
    320,
    320,
    new Map(),
  );
  return Array.from({ length: 320 }, (_, y) =>
    Array.from({ length: 320 }, (_, x) => matrix.get(x, y)),
  );
};
const matrices = [qr("qr1.first-synthetic"), qr("qr1.next-synthetic")];
async function setup(width, actor = owner) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    timezoneId: "America/Los_Angeles",
  });
  const page = await context.newPage();
  lastPage = page;
  const state = {
    actor,
    scans: [],
    failScan: false,
    reason: "ACCEPTED",
    socket: null,
    snapshot: { ...snapshot },
    reads: 0,
  };
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await page.route(api + "/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    requests.push({ path: p, method: req.method() });
    let body = {},
      status = 200;
    if (p.endsWith("/auth/me")) body = state.actor;
    else if (p === "/api/v1/events")
      body = {
        items: [
          {
            ...detail,
            relationship: url.searchParams.get("relationship") ?? "owned",
          },
        ],
        next_cursor: null,
        as_of: now,
        correlation_id: "synthetic",
      };
    else if (p.endsWith("/scope"))
      body = {
        authorized: true,
        event_id: eventId,
        gate_id: gateId,
        event_name: detail.name,
        gate_label: "Gate 1",
      };
    else if (p.endsWith("/account-lookup"))
      body = {
        account: { user_id: "new-staff", email: "new.staff@example.test" },
      };
    else if (p.endsWith("/assignments")) body = staff;
    else if (p.endsWith("/operations")) {
      body = state.snapshot;
      state.reads++;
    } else if (p.endsWith("/forecasts/current")) body = fixture;
    else if (p.endsWith("/scan-decisions")) {
      const command = req.postDataJSON();
      state.scans.push(command);
      if (state.failScan) {
        state.failScan = false;
        await route.abort("failed");
        return;
      }
      body = {
        ...command,
        credential: undefined,
        decision: state.reason === "ACCEPTED" ? "ACCEPTED" : "REJECTED",
        reason: state.reason,
        registration_status:
          state.reason === "CANCELLED_CREDENTIAL" ? "CANCELLED" : "REGISTERED",
        attendance_status: "INSIDE",
        decided_at: now,
        replayed: state.scans.some(
          (scan, index) =>
            index < state.scans.length - 1 && scan.scan_id === command.scan_id,
        ),
        correlation_id: "synthetic",
      };
    } else if (p.endsWith("/results"))
      body = {
        results: {
          event_id: eventId,
          event_state: "COMPLETED",
          total_registrations: 300,
          cancelled_registrations: 0,
          accepted_check_ins: 270,
          attendance_rate_percentage: 90,
          gate_check_ins: [{ gate_id: gateId, accepted_check_ins: 270 }],
          certificate_eligible_count: 270,
          certificate_issued_count: 0,
          certificate_revoked_count: 0,
          certificate_delivery_counts: {
            NOT_REQUIRED: 0,
            PENDING: 0,
            SENDING: 0,
            SENT: 0,
            UNKNOWN: 0,
            FAILED: 0,
          },
          data_limitations: ["NO_EXIT_OR_DWELL_DATA"],
          as_of: now,
        },
      };
    else if (p.endsWith("/audit-events"))
      body = {
        items: [
          {
            id: "activity",
            event_id: eventId,
            actor: { kind: "ACCOUNT", id: "sameer" },
            action: "SCAN_CHECK_IN",
            target_type: "SCAN_DECISION",
            target_id: "scan",
            outcome: "ACCEPTED",
            occurred_at: now,
            correlation_id: "synthetic",
          },
        ],
        next_cursor: null,
      };
    else if (p === `/api/v1/events/${eventId}`) body = detail;
    else {
      status = 404;
      body = { code: "NOT_FOUND" };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      },
    });
  });
  await page.routeWebSocket(
    api.replace("http", "ws") + "/api/v1/realtime/socket.io/**",
    (socket) => {
      state.socket = socket;
      socket.send(
        '0{"sid":"synthetic","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}',
      );
      socket.onMessage((message) => {
        if (message === "40") socket.send('40{"sid":"synthetic"}');
        const match = String(message).match(/^42(\d+)(\[.*)/);
        if (match && JSON.parse(match[2])[0] === "operations.subscribe")
          socket.send(
            `43${match[1]}[${JSON.stringify({ ok: true, event_id: eventId, revision: state.snapshot.revision, as_of: state.snapshot.as_of })}]`,
          );
      });
    },
  );
  await page.addInitScript(
    ({ matrices }) => {
      let canvas, stream;
      window.p1Camera = {
        error: null,
        starts: 0,
        stopped: 0,
        stream: null,
        prompt: false,
        resolve: null,
        draw(index) {
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, 320, 320);
          if (index !== null) {
            ctx.fillStyle = "black";
            matrices[index].forEach((row, y) =>
              row.forEach((black, x) => {
                if (black) ctx.fillRect(x, y, 1, 1);
              }),
            );
          }
          stream?.getVideoTracks()[0]?.requestFrame();
        },
      };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          async getUserMedia() {
            window.p1Camera.starts++;
            if (window.p1Camera.error)
              throw new DOMException(
                "private browser provider detail",
                window.p1Camera.error,
              );
            if (window.p1Camera.prompt)
              await new Promise((resolve) => {
                window.p1Camera.resolve = resolve;
              });
            canvas = document.createElement("canvas");
            canvas.width = canvas.height = 320;
            window.p1Camera.draw(null);
            stream = canvas.captureStream(10);
            window.p1Camera.stream = stream;
            stream.getTracks().forEach((track) => {
              const original = track.stop.bind(track);
              track.stop = () => {
                window.p1Camera.stopped++;
                original();
              };
            });
            return stream;
          },
        },
      });
    },
    { matrices },
  );
  return { context, page, state };
}
async function validate(page, label) {
  assert.match(await page.title(), /Event Command Center$/);
  assert.equal(new URL(page.url()).origin, origin);
  assert.ok((await page.locator("main:visible").innerText()).length > 30);
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    label + " page overflow",
  );
  const overflow = await page.locator("main:visible *").evaluateAll((els) =>
    els
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1);
      })
      .map((el) => el.tagName + "." + el.className),
  );
  assert.deepEqual(overflow, [], label + " clipped content");
  const small = await page
    .locator(
      "main:visible button, main:visible input:not([type=checkbox]), main:visible select, main:visible summary, .workspace-nav a",
    )
    .evaluateAll((els) =>
      els
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.height < 43.9;
        })
        .map((el) => el.textContent),
    );
  assert.deepEqual(small, [], label + " touch targets");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
    label + " accessibility",
  );
  checks.push(label);
}
async function section(page, name) {
  const toggle = page.getByRole("button", { name: /^Sections ·/ });
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute("aria-expanded")) === "false"
  )
    await toggle.click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name, exact: true })
    .click();
}
try {
  server = startServer();
  server.stdout.on("data", (chunk) => {
    startup += chunk;
  });
  server.stderr.on("data", (chunk) => {
    startup += chunk;
  });
  browser = await chromium.launch();
  await expect
    .poll(
      async () => {
        if (server.exitCode !== null) throw new Error(startup);
        try {
          return (await fetch(origin)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 20000 },
    )
    .toBe(true);
  for (const width of [320, 375, 390, 414, 768, 1024, 1280]) {
    const { context, page, state } = await setup(width);
    await page.goto(origin);
    await expect(
      page.getByRole("heading", { name: "Event workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Current event and role" }),
    ).toContainText("Role: Organizer");
    for (const name of [
      "Overview",
      "Setup",
      "Registrations",
      "Team & Staff",
      "Gates",
    ]) {
      await section(page, name);
      if (name === "Overview")
        await expect(
          page.getByRole("heading", { name: detail.name, exact: true }),
        ).toBeVisible();
      if (name === "Setup")
        await expect(
          page.getByLabel("Event name", { exact: true }),
        ).toBeVisible();
      if (name === "Team & Staff") {
        await expect(
          page.getByText("Gate: Gate 1", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: /^Remove assignment for sameer/ })
          .click();
        await expect(
          page.getByRole("button", { name: "Confirm removal" }),
        ).toBeVisible();
        await validate(page, `${width} staff confirmation`);
        await page.getByRole("button", { name: "Keep assignment" }).click();
        await page
          .getByLabel("Verified email", { exact: true })
          .fill("new.staff@example.test");
        await page
          .getByRole("button", { name: "Find verified account" })
          .click();
        await expect(page.getByLabel("Role", { exact: true })).toBeVisible();
        await page.getByLabel("Gate", { exact: true }).selectOption(gateId);
      }
      await validate(page, `${width} workspace ${name}`);
    }
    const toggle = page.getByRole("button", { name: /^Sections ·/ });
    if (await toggle.isVisible()) {
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("navigation", { name: "Workspace navigation" }),
      ).toBeVisible();
      await page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("button", { name: "My events" })
        .focus();
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      assert.match(
        await toggle.evaluate((el) => getComputedStyle(el).outlineStyle),
        /solid/,
      );
      await toggle.click();
    }
    for (const name of [
      "Live Operations",
      "Certificates",
      "Volunteer tasks",
      "Results",
      "Activity",
      "Create event",
    ])
      await expect(
        page
          .getByRole("navigation", { name: "Workspace navigation" })
          .getByRole("link", { name, exact: true }),
      ).toBeVisible();
    await section(page, "Setup");
    await page
      .getByLabel("Event name", { exact: true })
      .fill("Unsaved phone edit");
    const editsBefore = requests.filter((r) => r.method === "PATCH").length;
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++)
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(
      page.getByRole("button", { name: "Refresh workspace" }),
    ).toBeEnabled();
    await expect(page.getByLabel("Event name", { exact: true })).toHaveValue(
      "Unsaved phone edit",
    );
    assert.equal(
      requests.filter((r) => r.method === "PATCH").length,
      editsBefore,
    );
    await page.screenshot({
      path: path.join(out, `workspace-${width}.png`),
      fullPage: true,
    });
    await page.goto(`${origin}/operations/${eventId}`);
    await expect(page.getByText("27000%", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Role: Organizer", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("30-minute prediction", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("60-minute prediction", { exact: true }),
    ).toBeVisible();
    await validate(page, `${width} Live Operations`);
    await page.screenshot({
      path: path.join(out, `operations-${width}.png`),
      fullPage: true,
    });
    state.snapshot = {
      ...state.snapshot,
      revision: state.snapshot.revision + 3,
      occupied: 273,
      remaining: -272,
      utilization_percentage: 27300,
    };
    await expect.poll(() => Boolean(state.socket)).toBe(true);
    state.socket.send(
      "42" +
        JSON.stringify([
          "occupancy.updated",
          {
            schema_version: 1,
            event_id: eventId,
            revision: state.snapshot.revision,
            message_id: `operations:${eventId}:${state.snapshot.revision}`,
            as_of: now,
            occurred_at: now,
            correlation_id: "synthetic",
          },
        ]),
    );
    await expect(page.getByText("27300%", { exact: true })).toBeVisible();
    await expect(page.getByText(/Stale forecast\./)).toBeVisible();
    for (const theme of width === 390 ? ["Dark", "System", "Light"] : []) {
      await page.getByLabel("Appearance").selectOption({ label: theme });
      await validate(page, `390 Live Operations ${theme}`);
    }
    for (const [route, heading] of [
      ["results", "Results"],
      ["audit", "Activity"],
    ]) {
      await page.goto(`${origin}/${route}/${eventId}`);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: route === "results" ? "Refresh results" : "Search activity",
        }),
      ).toBeVisible();
      if (route === "audit")
        await expect(
          page.getByRole("cell", { name: /Scan Check In/ }),
        ).toBeVisible();
      await validate(page, `${width} ${heading}`);
    }
    state.actor = scanner;
    await page.goto(origin);
    await expect(
      page.getByText("Event: TechFest 2026 · Gate: Gate 1", { exact: true }),
    ).toBeVisible();
    await validate(page, `${width} Gate/Security workspace context`);
    await page.goto(`${origin}/scanner`);
    await expect(
      page.getByRole("button", { name: "Start camera" }),
    ).toBeEnabled();
    await validate(page, `${width} scanner idle`);
    const viewport = await page.locator(".camera-viewport").boundingBox();
    assert.ok(
      viewport.width >= Math.min(270, width - 40) && viewport.height >= 200,
      "practical camera viewport",
    );
    await page.getByRole("button", { name: "Start camera" }).click();
    await expect(
      page.getByText("Camera ready.", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.p1Camera.draw(0));
    await expect(
      page.getByRole("heading", { name: "Entry allowed", exact: true }),
    ).toBeVisible();
    const first = state.scans[0];
    assert.equal(first.credential, "qr1.first-synthetic");
    await page.getByRole("button", { name: "Scan next person" }).click();
    await expect(page.locator(".camera-capture")).toContainText(
      "Camera ready.",
    );
    // Real decoding continues; a stationary code must not generate a second POST.
    await page.waitForTimeout(1500);
    assert.equal(state.scans.length, 1);
    assert.equal(await page.evaluate(() => window.p1Camera.starts), 1);
    await page.evaluate(() => window.p1Camera.draw(1));
    await expect.poll(() => state.scans.length).toBe(2);
    assert.notEqual(state.scans[1].scan_id, first.scan_id);
    await validate(page, `${width} scanner accepted and next scan`);
    await page.screenshot({
      path: path.join(out, `scanner-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Stop camera" }).click();
    await expect(page.getByText(/Camera stopped\./)).toBeVisible();
    await context.close();
  }
  const { context, page, state } = await setup(390, scanner);
  await page.goto(`${origin}/scanner`);
  await expect(
    page.getByRole("button", { name: "Start camera" }),
  ).toBeEnabled();
  for (const [error, text] of [
    ["NotAllowedError", "Camera access was blocked"],
    ["NotFoundError", "No camera is available"],
    ["NotReadableError", "Camera couldn't be started"],
  ]) {
    await page.evaluate((error) => {
      window.p1Camera.error = error;
    }, error);
    await page
      .getByRole("button", { name: /Start camera|Try camera again/ })
      .click();
    await expect(page.getByRole("alert")).toContainText(text);
    await validate(page, `390 camera ${error}`);
  }
  await page.getByRole("button", { name: "Use manual entry" }).click();
  await expect(page.getByLabel("Entry QR code", { exact: true })).toBeFocused();
  for (const [reason, text] of [
    ["ALREADY_CHECKED_IN", "Already checked in"],
    ["INVALID_CREDENTIAL", "QR code not recognized"],
    ["CANCELLED_CREDENTIAL", "Registration cancelled"],
    ["REGISTRATION_UNAVAILABLE", "Entry is not currently open"],
    ["EXPIRED_CREDENTIAL", "QR code expired"],
  ]) {
    state.reason = reason;
    await page.getByLabel("Entry QR code", { exact: true }).fill("qr1.manual");
    await page.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: text, exact: true }),
    ).toBeVisible();
    await validate(page, `390 manual ${reason}`);
  }
  state.reason = "ACCEPTED";
  state.failScan = true;
  await page.getByLabel("Entry QR code", { exact: true }).fill("qr1.recovery");
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.locator('.scanner-result[role="alert"]')).toContainText(
    "Check your connection",
  );
  const unknown = state.scans.at(-1),
    count = state.scans.length;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  assert.equal(state.scans.length, count);
  await expect(
    page.getByRole("button", { name: "Scan next person" }),
  ).toHaveCount(0);
  await validate(page, "390 scanner network unknown");
  await page.getByRole("button", { name: "Retry same scan" }).click();
  await expect(
    page.getByRole("heading", { name: "Entry allowed" }),
  ).toBeVisible();
  assert.deepEqual(state.scans.at(-1), unknown);
  await page.evaluate(() => {
    window.p1Camera.error = null;
    window.p1Camera.prompt = true;
  });
  await page.getByRole("button", { name: "Try camera again" }).click();
  await expect(page.getByText(/Starting camera…/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => typeof window.p1Camera.resolve))
    .toBe("function");
  await page.evaluate(() => window.p1Camera.resolve());
  await expect(page.getByText("Camera ready.", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.p1Camera.stream.getVideoTracks()[0].dispatchEvent(new Event("mute")),
  );
  await expect(page.getByText(/Camera stopped or disconnected/)).toBeVisible();
  await validate(page, "390 camera interrupted recovery");
  state.actor = admin;
  await page.goto(`${origin}/operations/${eventId}`);
  await expect(
    page.getByText("Role: Event Admin", { exact: true }),
  ).toBeVisible();
  await validate(page, "390 Event Admin operations");
  await page.goto(`${origin}/scanner`);
  await expect(page.getByRole("alert")).toContainText(
    "Gate/Security assignment",
  );
  await expect(page.getByRole("button", { name: "Start camera" })).toHaveCount(
    0,
  );
  await context.close();
  assert.deepEqual(errors, [], "application runtime errors");
  const unexpected = consoleErrors.filter(
    (error) => !/net::ERR_FAILED/.test(error),
  );
  assert.deepEqual(unexpected, [], "application console errors");
  console.log(
    JSON.stringify(
      {
        groups: checks.length,
        checks,
        applicationRuntimeErrors: errors.length,
        applicationConsoleErrors: unexpected.length,
        expectedNetworkFailures: consoleErrors.length - unexpected.length,
        screenshots: out,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({
      path: path.join(out, "failure.png"),
      fullPage: true,
    });
    console.log(
      await lastPage.locator("video").evaluateAll((videos) =>
        videos.map((video) => ({
          readyState: video.readyState,
          width: video.videoWidth,
          height: video.videoHeight,
          paused: video.paused,
        })),
      ),
    );
  }
  throw error;
} finally {
  await browser?.close();
  server?.kill();
}
