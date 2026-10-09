import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import https from "node:https";
import { chromium } from "@playwright/test";
import {
  ARTIFACT_DIR,
  ORIGIN,
  EVENT_NAME,
  PROVENANCE,
  compose,
} from "./isolation.mjs";
import { worker } from "./forecast-demo.mjs";

async function trustLocalEdge(state) {
  const path = resolve(ARTIFACT_DIR, "demo-ca.crt");
  await compose(state, [
    "cp",
    "frontend:/data/caddy/pki/authorities/local/root.crt",
    path,
  ]);
  const ca = await readFile(path);
  await new Promise((resolve, reject) => {
    const request = https.get(
      `${ORIGIN}/health/ready`,
      { ca, rejectUnauthorized: true },
      (response) => {
        response.resume();
        response.statusCode === 200
          ? resolve()
          : reject(new Error("Local edge not ready."));
      },
    );
    request.setTimeout(10000, () =>
      request.destroy(new Error("Local edge timeout.")),
    );
    request.on("error", reject);
  });
}
export async function demonstrate(state, present = false) {
  await trustLocalEdge(state);
  const { sessions } = await worker(state, "sessions");
  const browser = await chromium.launch({ headless: !present });
  try {
    const roles = ["owner", "scanner", "arrival"];
    const pages = {};
    for (const role of roles) {
      // Exception belongs only to this isolated browser, after Node validates the actual CA.
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 1000 },
      });
      await context.route("**/*", (route) => {
        if (new URL(route.request().url()).origin === ORIGIN)
          return route.continue();
        return route.abort();
      });
      await context.addCookies([
        {
          name: "eoc_session",
          value: sessions[role].token,
          url: `${ORIGIN}/api/v1`,
          httpOnly: true,
          secure: true,
          sameSite: "None",
        },
      ]);
      const page = await context.newPage();
      const path =
        role === "owner"
          ? `/operations/${state.fixture.event_id}`
          : role === "scanner"
            ? "/scanner"
            : `/registrations/${sessions.registrations.arrival}`;
      await page.goto(ORIGIN + path);
      await page.getByLabel("Synthetic demo environment").waitFor();
      pages[role] = page;
    }
    const owner = pages.owner;
    await owner.getByText("Current demo forecast.", { exact: true }).waitFor();
    assert(await owner.getByLabel("Synthetic forecast provenance").isVisible());
    assert((await owner.locator("body").innerText()).includes(EVENT_NAME));
    await owner.screenshot({
      path: resolve(ARTIFACT_DIR, "forecast-demo.png"),
      fullPage: true,
    });
    // Prepare the existing manual QR path without submitting the reserved arrival.
    await pages.scanner
      .getByText("Enter QR code manually", { exact: true })
      .click();
    const input = pages.scanner.getByLabel("Entry QR code", { exact: true });
    await input.fill(sessions.arrival_credential);
    assert.equal(await input.inputValue(), sessions.arrival_credential);
    assert(
      await pages.scanner
        .getByRole("button", { name: "Check in", exact: true })
        .isEnabled(),
    );
    await pages.arrival
      .getByRole("button", { name: "Show entry QR", exact: true })
      .click();
    await pages.arrival
      .getByAltText("Your entry QR", { exact: true })
      .waitFor();
    for (const page of Object.values(pages))
      assert(await page.getByLabel("Synthetic demo environment").isVisible());
    if (present) {
      console.log(
        "Isolated demo browser open: organizer, gate scanner and fictitious attendee. Close the browser to finish. Fixture sessions last 15 minutes.",
      );
      await new Promise((resolve) => browser.on("disconnected", resolve));
    } else
      console.log(
        JSON.stringify({
          provenance: PROVENANCE,
          real_browser_forecast: "AVAILABLE",
          persistent_banner: true,
          forecast_provenance_visible: true,
          local_ca_verified: true,
          scanner_manual_qr_ready: true,
          fictitious_attendee_qr_visible: true,
        }),
      );
  } finally {
    await browser.close();
  }
}
