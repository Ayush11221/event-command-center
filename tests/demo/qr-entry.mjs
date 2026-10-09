import assert from "node:assert/strict";
import { readFile, writeFile, readdir, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import https from "node:https";
import path from "node:path";
// Run: node tests/demo/qr-entry.mjs [--demo-root <another worktree of this repository>].
// Every write is scoped to fresh synthetic fixtures in the validated local demo.
const INTEGRATION = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 2 && args[0] === "--demo-root"),
  "Only --demo-root is accepted.",
);
const ROOT = args.length ? path.resolve(args[1]) : INTEGRATION;
const execute = promisify(execFile);
const common = async (root) =>
  path.resolve(
    root,
    (
      await execute("git", ["rev-parse", "--git-common-dir"], {
        cwd: root,
        windowsHide: true,
      })
    ).stdout.trim(),
  );
assert.equal(
  await common(ROOT),
  await common(INTEGRATION),
  "Demo root must be a worktree of this repository.",
);
const OUT = await mkdtemp(path.join(tmpdir(), "ecc-qr-entry-"));
const frontendCommit = (
  await execute("git", ["rev-parse", "HEAD"], {
    cwd: INTEGRATION,
    windowsHide: true,
  })
).stdout.trim();
const { loadState } = await import(
  pathToFileURL(path.join(ROOT, "tests/demo/forecast-demo.mjs"))
);
const { compose, validateStack, ORIGIN } = await import(
  pathToFileURL(path.join(ROOT, "tests/demo/isolation.mjs"))
);
const { chromium, expect } = await import(
  pathToFileURL(
    path.join(INTEGRATION, "node_modules/@playwright/test/index.mjs"),
  )
);
const QRCode = createRequire(path.join(INTEGRATION, "backend/package.json"))(
  "qrcode",
);
let stage = "isolation",
  browser,
  lastScanner,
  lastOwner,
  cameraDiagnostics;
const workerBase = String.raw`
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './backend/dist/config/database.js';
import {normalizeContact,encryptContact} from './backend/dist/modules/auth/contact.js';
import {signAccountToken,csrfToken} from './backend/dist/modules/auth/tokens.js';
import {recoverCredential} from './backend/dist/modules/registrations/credential.js';
import {isolation} from './tests/demo/ledger.mjs';
import {assertDatabaseUrl,ORIGIN} from './tests/demo/isolation.mjs';
const secret=async name=>(await readFile('/run/secrets/'+name,'utf8')).trim();
const url=await secret('migration_url');assertDatabaseUrl(url,'eoc_migrator');
const db=createDatabase(url),instance=await secret('instance');
await isolation(db,instance,false);
try {
`;
async function worker(state, code) {
  const output = await compose(state, [
    "run",
    "--rm",
    "-T",
    "--interactive=false",
    "--no-deps",
    "demo",
    "node",
    "--input-type=module",
    "-e",
    workerBase + code + "} finally {await db.$disconnect();}",
  ]);
  return JSON.parse(output);
}
const fingerprints = randomBytes(32),
  describe = (value) => ({
    type: /^qr1\.[A-Za-z0-9_-]{43}$/.test(value)
      ? "entry-credential"
      : /^https?:\/\//.test(value)
        ? "url"
        : "malformed",
    length: value.length,
    fingerprint: createHmac("sha256", fingerprints)
      .update(value)
      .digest("hex")
      .slice(0, 12),
  });
try {
  const state = await loadState();
  await validateStack(state, true);
  stage = "build integrated frontend for isolated loopback";
  const outputDir = path.join(OUT, "dist");
  assert(outputDir.startsWith(OUT + path.sep));
  await execute(
    process.execPath,
    [
      path.join(INTEGRATION, "node_modules/vite/bin/vite.js"),
      "build",
      "frontend",
      "--outDir",
      outputDir,
      "--emptyOutDir",
    ],
    {
      cwd: INTEGRATION,
      env: {
        ...process.env,
        VITE_API_ORIGIN: ORIGIN,
        VITE_FORECAST_DEMO: "synthetic_local",
      },
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  stage = "create dedicated synthetic fixtures through normal API";
  const fixture = await worker(
    state,
    String.raw`
 const contactKey=Buffer.from(await secret('contact_key'),'hex'),jwt=Buffer.from(await secret('jwt_secret'),'hex'),actors={};
 for(const role of ['owner','scanner','attendee','expired']){
  const user=await db.user.create({data:{organizerCapable:role==='owner'}});
  const contact=normalizeContact('EMAIL',user.id+'@example.invalid',contactKey);
  await db.verifiedContact.create({data:{userId:user.id,type:'EMAIL',lookupHash:contact.lookupHash,encrypted:encryptContact(contact.value,contactKey),verifiedAt:new Date()}});
  const session=await db.session.create({data:{userId:user.id,expiresAt:new Date(Date.now()+3600000)}});
  actors[role]={id:user.id,token:await signAccountToken(user.id,session.id,jwt),csrf:csrfToken(session.id,jwt)};
 }
 async function api(p,who,method='GET',body,revision){
  const r=await fetch('http://api:3000/api/v1'+p,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Cookie:'eoc_session='+who.token,Origin:ORIGIN,'X-CSRF-Token':who.csrf,'Content-Type':'application/json','Idempotency-Key':randomUUID(),...(revision!==undefined?{'If-Match':'"'+revision+'"'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const b=await r.json();assert(r.ok,'Synthetic fixture API failed: '+r.status+' '+b.code);return b;
 }
 async function event(label){
  const e=await api('/events',actors.owner,'POST',{name:'QR contract synthetic '+label+' '+randomUUID().slice(0,6)});
  const future=Date.now()+86400000;
  await api('/events/'+e.event_id,actors.owner,'PATCH',{visibility:'PUBLIC',start_at:new Date(future).toISOString(),end_at:new Date(future+3600000).toISOString(),time_zone:'Asia/Kolkata',registration_capacity:10},e.revision);
  let d=await api('/events/'+e.event_id,actors.owner);
  await api('/events/'+e.event_id+'/gates',actors.owner,'POST',{},d.revision);
  d=await api('/events/'+e.event_id,actors.owner);
  await api('/events/'+e.event_id+'/transitions',actors.owner,'POST',{target_state:'PUBLISHED'},d.revision);
  return {eventId:e.event_id,name:e.name,gateId:d.gates[0].gate_id};
 }
 const a=await event('A'),b=await event('B');
 await api('/events/'+a.eventId+'/assignments',actors.owner,'POST',{user_id:actors.scanner.id,role:'GATE_SECURITY',gate_id:a.gateId});
 async function register(event,role){
  const result=await api('/events/'+event.eventId+'/registrations',actors[role],'POST',{}),id=result.registration.registration_id;
  const credential=await db.qRCredential.findFirstOrThrow({where:{registrationId:id,revokedAt:null}});
  return {id,token:recoverCredential(id,credential.protectedRepresentation,contactKey)};
 }
 const valid=await register(a,'attendee'),other=await register(b,'attendee'),expired=await register(a,'expired');
 assert.equal(await db.attendanceTransition.count({where:{eventId:{in:[a.eventId,b.eventId]}}}),0);
 process.stdout.write(JSON.stringify({actors,a,b,valid,other,expired}));
 `,
  );
  const caPath = path.join(OUT, "local-ca.crt");
  await compose(state, [
    "cp",
    "frontend:/data/caddy/pki/authorities/local/root.crt",
    caPath,
  ]);
  const ca = await readFile(caPath);
  await new Promise((resolve, reject) => {
    const r = https.get(
      ORIGIN + "/health/ready",
      { ca, rejectUnauthorized: true },
      (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else reject(new Error("Local readiness failed"));
      },
    );
    r.setTimeout(10000, () => r.destroy(new Error("Local TLS timeout")));
    r.on("error", reject);
  });
  const dist = path.join(OUT, "dist"),
    files = new Map();
  for (const file of await readdir(dist, {
    recursive: true,
    withFileTypes: true,
  }))
    if (file.isFile()) {
      const full = path.join(file.parentPath, file.name);
      files.set(
        "/" + path.relative(dist, full).replaceAll("\\", "/"),
        await readFile(full),
      );
    }
  assert(files.has("/index.html"));
  const media = {
    js: "application/javascript",
    css: "text/css",
    html: "text/html",
    svg: "image/svg+xml",
    png: "image/png",
    woff2: "font/woff2",
  };
  stage = "browser with latest integrated frontend and real isolated API";
  browser = await chromium.launch({ headless: true });
  const pages = {},
    errors = [],
    commands = [],
    responses = [];
  for (const role of ["owner", "scanner", "attendee", "expired"]) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== ORIGIN) return route.abort();
      if (
        u.pathname.startsWith("/api/") ||
        u.pathname.startsWith("/health/") ||
        u.pathname.startsWith("/socket.io/")
      )
        return route.continue();
      const file = files.has(u.pathname) ? u.pathname : "/index.html";
      await route.fulfill({
        status: 200,
        contentType:
          media[file.split(".").at(-1)] ?? "application/octet-stream",
        body: files.get(file),
      });
    });
    await context.addCookies([
      {
        name: "eoc_session",
        value: fixture.actors[role].token,
        url: ORIGIN + "/api/v1",
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
    ]);
    pages[role] = await context.newPage();
    pages[role].setDefaultTimeout(15000);
    pages[role].on("pageerror", () => errors.push("runtime-error"));
  }
  async function entrySource(page, registrationId) {
    await page.goto(ORIGIN + "/registrations/" + registrationId);
    await page
      .getByRole("button", { name: "Show entry QR", exact: true })
      .click();
    const img = page.getByAltText("Your entry QR", { exact: true });
    await expect(img).toBeVisible();
    await img.evaluate((image) => image.decode());
    return img.getAttribute("src");
  }
  stage = "actual participant rendered entry QR sources";
  const validSource = await entrySource(pages.attendee, fixture.valid.id);
  const otherSource = await entrySource(pages.attendee, fixture.other.id);
  const expiredSource = await entrySource(pages.expired, fixture.expired.id);
  await worker(
    state,
    `const id=${JSON.stringify(fixture.expired.id)},eventId=${JSON.stringify(fixture.a.eventId)};assert.equal((await db.registration.findUniqueOrThrow({where:{id}})).eventId,eventId);await db.qRCredential.updateMany({where:{registrationId:id,revokedAt:null},data:{expiresAt:new Date(Date.now()-1000)}});process.stdout.write(JSON.stringify({synthetic_expired_fixture:true}));`,
  );
  const scanner = pages.scanner,
    owner = pages.owner;
  lastScanner = scanner;
  lastOwner = owner;
  let expected;
  await scanner.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        async getUserMedia() {
          const img = new Image();
          img.src = window.__qrCameraSource;
          // Render SVG modules at an integer pixel size. Fractional rasterization
          // of a generated QR can make a synthetic video frame unreadable.
          const svg = decodeURIComponent(
            img.src.slice(img.src.indexOf(",") + 1),
          );
          const modules = Number(svg.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
          const size = modules ? modules * Math.floor(640 / modules) : 512;
          img.width = img.height = size;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = c.height = size;
          const ctx = c.getContext("2d");
          ctx.imageSmoothingEnabled = false;
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
          const stream = c.captureStream(10);
          setInterval(() => ctx.drawImage(img, 0, 0, size, size), 80);
          return stream;
        },
      },
    });
  });
  scanner.on("request", (req) => {
    if (
      new URL(req.url()).pathname === "/api/v1/scan-decisions" &&
      req.method() === "POST"
    ) {
      const c = req.postDataJSON();
      assert(
        c.credential === expected,
        "Decoded credential differs from the actual entry QR",
      );
      assert.equal(c.event_id, fixture.a.eventId);
      assert.equal(c.gate_id, fixture.a.gateId);
      assert.equal(req.headers()["idempotency-key"], c.scan_id);
      assert(req.headers()["x-csrf-token"]);
      commands.push(c);
    }
  });
  await scanner.goto(ORIGIN + "/scanner");
  await expect(
    scanner.getByText(fixture.a.name, { exact: true }),
  ).toBeVisible();
  const cases = [];
  async function scan(label, source, value, reason) {
    stage = label;
    expected = value;
    const next = scanner.getByRole("button", {
      name: "Scan next person",
      exact: true,
    });
    if (await next.isVisible()) await next.click();
    await scanner.evaluate((source) => {
      window.__qrCameraSource = source;
    }, source);
    const response = scanner.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/scan-decisions" &&
        r.request().method() === "POST",
    );
    await scanner
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    const r = await response.catch(async (error) => {
        cameraDiagnostics = await scanner
          .evaluate(
            async ({ decoderUrl, expected, source }) => {
              const { BrowserQRCodeReader } = await import(decoderUrl);
              const reader = new BrowserQRCodeReader();
              const image = new Image();
              image.src = source;
              await image.decode();
              const video = document.querySelector("video");
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = video.videoWidth;
              const ctx = canvas.getContext("2d");
              const decode = (target) => {
                ctx.fillStyle = "white";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(target, 0, 0, canvas.width, canvas.height);
                try {
                  return {
                    matches:
                      reader.decodeFromCanvas(canvas).getText() === expected,
                  };
                } catch (error) {
                  return { matches: false, error_type: error.name };
                }
              };
              return { image: decode(image), video: decode(video) };
            },
            {
              decoderUrl:
                ORIGIN +
                [...files.keys()].find((file) =>
                  /^\/assets\/esm-.*\.js$/.test(file),
                ),
              expected: value,
              source,
            },
          )
          .catch(() => ({ diagnostic_failed: true }));
        throw error;
      }),
      b = await r.json();
    assert.equal(r.status(), 200);
    assert.equal(b.reason, reason);
    const headings = {
      INVALID_CREDENTIAL: "QR code not recognized",
      EXPIRED_CREDENTIAL: "QR code expired",
      REGISTRATION_UNAVAILABLE: "Entry is not currently open",
      ACCEPTED: "Entry allowed",
      ALREADY_CHECKED_IN: "Already checked in",
    };
    await expect(
      scanner.getByRole("heading", { name: headings[reason], exact: true }),
    ).toBeVisible();
    await scanner
      .getByRole("button", { name: "Stop camera", exact: true })
      .click();
    cases.push({
      case: label,
      payload: describe(value),
      decoded_and_submitted: true,
      http: r.status(),
      decision: b.decision,
      reason: b.reason,
      attendance: b.attendance_status,
    });
    responses.push(b);
    if (reason === "ACCEPTED" || reason === "INVALID_CREDENTIAL")
      await scanner
        .locator(".scanner-result")
        .screenshot({ path: path.join(OUT, reason.toLowerCase() + ".png") });
  }
  await scan(
    "valid entry / PUBLISHED",
    validSource,
    fixture.valid.token,
    "REGISTRATION_UNAVAILABLE",
  );
  await scan(
    "entry from another event",
    otherSource,
    fixture.other.token,
    "INVALID_CREDENTIAL",
  );
  const url = "https://example.invalid/not-an-entry-qr",
    malformed = "qr1.malformed";
  const negativeSource = async (value) =>
    "data:image/svg+xml," +
    encodeURIComponent(
      await QRCode.toString(value, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 4,
      }),
    );
  await scan(
    "non-entry URL",
    await negativeSource(url),
    url,
    "INVALID_CREDENTIAL",
  );
  await scan(
    "malformed credential",
    await negativeSource(malformed),
    malformed,
    "INVALID_CREDENTIAL",
  );
  await scan(
    "expired actual entry QR",
    expiredSource,
    fixture.expired.token,
    "EXPIRED_CREDENTIAL",
  );
  stage = "normal Organizer Start live event";
  await owner.goto(ORIGIN + "/");
  await expect(owner.locator(".event-row").first()).toBeVisible();
  const selection = owner.locator(".context-switcher select");
  await expect(selection).toBeVisible();
  await selection.selectOption("owned:" + fixture.a.eventId);
  await expect(owner.locator(".active-context")).toContainText(
    "Event: " + fixture.a.name,
  );
  await expect(owner.locator(".event-row").first()).toBeVisible();
  stage = "Organizer overview";
  await owner.getByRole("button", { name: "Overview", exact: true }).click();
  stage = "Organizer start action";
  await owner
    .getByRole("button", { name: "Start live event", exact: true })
    .click();
  const live = owner.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        "/api/v1/events/" + fixture.a.eventId + "/transitions" &&
      r.request().method() === "POST",
  );
  stage = "Organizer confirmation";
  await owner
    .getByRole("button", { name: "Confirm start live event", exact: true })
    .click();
  const response = await live;
  assert.equal(response.status(), 200);
  assert.equal((await response.json()).state, "LIVE");
  stage = "participant public LIVE discovery and registration recovery";
  const attendee = pages.attendee;
  await attendee.setViewportSize({ width: 390, height: 844 });
  await attendee.goto(ORIGIN + "/events");
  const liveEvents = attendee.getByRole("region", {
    name: "Live events",
    exact: true,
  });
  await expect(liveEvents).toBeVisible();
  let eventLink = liveEvents.getByRole("link", {
    name: fixture.a.name,
    exact: true,
  });
  while (!(await eventLink.count())) {
    const more = attendee.getByRole("button", {
      name: "Load more events",
      exact: true,
    });
    assert(
      await more.isVisible(),
      "LIVE synthetic event is missing from public discovery",
    );
    const page = attendee.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/discovery/events",
    );
    await more.click();
    await page;
    await expect(
      attendee.getByText("More public events loaded.", { exact: true }),
    ).toBeVisible();
  }
  await eventLink.click();
  await expect(attendee.getByText("LIVE EVENT", { exact: true })).toBeVisible();
  await attendee
    .getByRole("button", { name: "View my registration", exact: true })
    .click();
  await attendee
    .getByRole("button", { name: "Show entry QR", exact: true })
    .click();
  const recovered = attendee.getByAltText("Your entry QR", { exact: true });
  await expect(recovered).toBeVisible();
  await recovered.evaluate((image) => image.decode());
  const recoveredSource = await recovered.getAttribute("src");
  assert.equal(
    recoveredSource,
    validSource,
    "Live public recovery must retain the actual participant entry QR",
  );
  assert(
    !(await attendee
      .getByRole("button", { name: /Confirm registration|Register again/ })
      .count()),
  );
  assert(
    await attendee.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Participant live event overflows on mobile",
  );
  await scan(
    "valid actual entry / LIVE",
    recoveredSource,
    fixture.valid.token,
    "ACCEPTED",
  );
  await scan(
    "repeated actual entry",
    validSource,
    fixture.valid.token,
    "ALREADY_CHECKED_IN",
  );
  assert.equal(
    responses.find((r) => r.reason === "ACCEPTED").attendance_status,
    "INSIDE",
  );
  assert.equal(new Set(commands.map((c) => c.scan_id)).size, cases.length);
  stage = "owner entry code and manual duplicate";
  await attendee
    .getByRole("button", { name: "Show entry code", exact: true })
    .click();
  assert.equal(
    (await attendee.getByLabel("Entry code", { exact: true }).inputValue()) ===
      fixture.valid.token,
    true,
    "The owner's text code must match the credential encoded by the actual entry QR",
  );
  await attendee
    .getByRole("button", { name: "Hide entry code", exact: true })
    .click();
  await expect(attendee.getByLabel("Entry code", { exact: true })).toHaveCount(
    0,
  );
  await scanner
    .getByRole("button", { name: "Scan next person", exact: true })
    .click();
  await scanner.locator(".scanner-manual summary").click();
  expected = fixture.valid.token;
  const manualResponse = scanner.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/scan-decisions" &&
      r.request().method() === "POST",
  );
  await scanner
    .getByLabel("Entry QR code", { exact: true })
    .fill(fixture.valid.token);
  await scanner.getByRole("button", { name: "Check in", exact: true }).click();
  const manual = await manualResponse;
  assert.equal(manual.status(), 200);
  assert.equal((await manual.json()).reason, "ALREADY_CHECKED_IN");
  const persisted = await worker(
    state,
    `const eventId=${JSON.stringify(fixture.a.eventId)},otherId=${JSON.stringify(fixture.b.eventId)},registrationId=${JSON.stringify(fixture.valid.id)};const transitions=await db.attendanceTransition.count({where:{eventId}});const wrongEventAttendance=await db.attendanceTransition.count({where:{eventId:otherId}});const reg=await db.registration.findUniqueOrThrow({where:{id:registrationId}});assert.equal(transitions,1);assert.equal(wrongEventAttendance,0);assert(reg.firstAcceptedCheckInAt);process.stdout.write(JSON.stringify({attendance_transitions:transitions,wrong_event_attendance:wrongEventAttendance,registration_status:reg.state,event_state:(await db.event.findUniqueOrThrow({where:{id:eventId}})).state}));`,
  );
  assert.equal(errors.length, 0);
  const evidence = {
    ok: true,
    frontend_commit: frontendCommit,
    origin: ORIGIN,
    actual_participant_qr: true,
    actual_decoder: true,
    actual_api: true,
    synthetic_camera: true,
    physical_camera: false,
    manual_code_matches_qr: true,
    manual_duplicate_rejected: true,
    production_records_changed: false,
    cases,
    ...persisted,
    runtime_errors: errors.length,
  };
  await writeFile(
    path.join(OUT, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify({ ...evidence, evidence_directory: OUT }));
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      stage,
      error_type: error.name,
      detail: "Secret values and participant data omitted.",
      camera_state: lastScanner
        ? await lastScanner
            .locator(".camera-capture")
            .innerText()
            .catch(() => null)
        : null,
      owner_state: lastOwner ? "Synthetic organizer flow incomplete" : null,
      camera_diagnostics: cameraDiagnostics,
      video: lastScanner
        ? await lastScanner
            .locator("video")
            .evaluate((video) => ({
              width: video.videoWidth,
              height: video.videoHeight,
              ready: video.readyState,
              paused: video.paused,
              time: video.currentTime,
              visibility: document.visibilityState,
            }))
            .catch(() => null)
        : null,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
}
