import { ContactType } from "@prisma/client";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FoundationConfig } from "../../config/foundation.js";
import { createOtpSender, loadSmsGateway } from "./sender.js";

const config: FoundationConfig = {
  databaseUrl: "postgresql://unused:unused@127.0.0.1:1/unused",
  jwtSecret: new Uint8Array(32),
  contactKey: Buffer.alloc(32),
  otpKey: Buffer.alloc(32),
  cookieSecure: false,
};

describe("replaceable OTP delivery boundary", () => {
  it("loads a configured local SMS adapter without defining a gateway protocol", async () => {
    const path = fileURLToPath(
      new URL("./sender.fixture.mjs", import.meta.url),
    );
    const gateway = await loadSmsGateway(path);
    await expect(
      gateway.sendSms("+15551234567", "code"),
    ).resolves.toBeUndefined();
    await expect(loadSmsGateway("relative-adapter.mjs")).rejects.toThrow(
      "absolute local path",
    );
  });
  it("passes the generated code only to an injected phone gateway", async () => {
    const calls: string[] = [];
    const sender = createOtpSender(config, {
      async sendSms(destination, message) {
        calls.push(`${destination}:${message}`);
      },
    });
    expect(sender.available(ContactType.PHONE)).toBe(true);
    expect(createOtpSender(config).available(ContactType.PHONE)).toBe(false);
    await sender.send(ContactType.PHONE, "+15551234567", "123456");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("123456");
    await expect(
      createOtpSender(config).send(ContactType.PHONE, "+15551234567", "123456"),
    ).rejects.toThrow("Sender unavailable");
  });
});
