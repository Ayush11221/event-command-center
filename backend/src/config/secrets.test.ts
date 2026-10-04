import { afterAll, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSecrets } from "./secrets.js";
const folder = mkdtempSync(join(tmpdir(), "eoc-secrets-test-"));
afterAll(() => rmSync(folder, { recursive: true }));
it("loads mounted secrets, supports disabled SMTP and rejects ambiguous sources safely", () => {
  const file = join(folder, "key");
  writeFileSync(file, "a".repeat(64) + "\n");
  const env: NodeJS.ProcessEnv = { JWT_SECRET_FILE: file };
  loadSecrets(env);
  expect(env.JWT_SECRET).toBe("a".repeat(64));
  expect(() => loadSecrets(env)).toThrow("Ambiguous JWT_SECRET source");
  const blank = join(folder, "blank");
  writeFileSync(blank, "\n");
  const optional: NodeJS.ProcessEnv = { SMTP_URL_FILE: blank };
  loadSecrets(optional);
  expect(optional.SMTP_URL).toBeUndefined();
  expect(() =>
    loadSecrets({ CONTACT_KEY_FILE: join(folder, "secret-path-missing") }),
  ).toThrow("Cannot load CONTACT_KEY secret");
});
it("loads a synthetic Brevo file secret and rejects ambiguity, blank and multiline values safely", () => {
  const file = join(folder, "brevo-synthetic");
  writeFileSync(file, "synthetic-fixture-only\n");
  const env: NodeJS.ProcessEnv = { BREVO_API_KEY_FILE: file };
  loadSecrets(env);
  expect(Boolean(env.BREVO_API_KEY)).toBe(true);
  expect(() => loadSecrets(env)).toThrow("Ambiguous BREVO_API_KEY source");
  for (const value of ["\n", "synthetic\nmultiline"]) {
    writeFileSync(file, value);
    expect(() => loadSecrets({ BREVO_API_KEY_FILE: file })).toThrow(
      "Cannot load BREVO_API_KEY secret",
    );
  }
});
