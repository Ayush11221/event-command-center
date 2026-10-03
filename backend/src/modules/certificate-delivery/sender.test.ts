import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createCertificateSender, smtpFailure } from "./sender.js";
const config = {
  databaseUrl: "synthetic",
  jwtSecret: Buffer.alloc(32),
  contactKey: Buffer.alloc(32),
  otpKey: Buffer.alloc(32),
  cookieSecure: false,
};
it.each([{ responseCode: 550 }, { responseCode: 451 }, { responseCode: 535 }])(
  "treats explicit SMTP rejection as definite %j",
  (error) => {
    expect(smtpFailure(error)).toBe("FAILED");
  },
);
it.each([{ code: "ETIMEDOUT" }, { code: "ECONNRESET" }, new Error("outage")])(
  "holds ambiguous SMTP outcomes %j",
  (error) => {
    expect(smtpFailure(error)).toBe("UNKNOWN");
  },
);
it("fails definitively when platform SMTP is unconfigured", async () => {
  expect(
    await createCertificateSender(config).send({
      attemptId: randomUUID(),
      recipient: "recipient@example.invalid",
      certificateNumber: randomUUID(),
      pdf: Buffer.from("PDF"),
    }),
  ).toBe("FAILED");
});
it.each(["SENT", "FAILED", "UNKNOWN"] as const)(
  "uses one recipient, platform From, stored attachment and bounded SMTP outcome %s",
  async (outcome) => {
    let transcript = "";
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.write("220 test SMTP\r\n");
      let buffer = "",
        data = false;
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes("\r\n")) {
          const index = buffer.indexOf("\r\n"),
            line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          transcript += line + "\n";
          if (data) {
            if (line === ".") {
              data = false;
              if (outcome === "UNKNOWN") socket.destroy();
              else
                socket.write(
                  outcome === "SENT" ? "250 accepted\r\n" : "550 rejected\r\n",
                );
            }
            continue;
          }
          if (line.startsWith("EHLO")) socket.write("250 test\r\n");
          else if (line === "DATA") {
            data = true;
            socket.write("354 send data\r\n");
          } else if (line === "QUIT") socket.end("221 bye\r\n");
          else socket.write("250 ok\r\n");
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    try {
      const sender = createCertificateSender({
          ...config,
          smtpUrl: `smtp://127.0.0.1:${address.port}`,
          smtpFrom: "platform@example.invalid",
        }),
        id = randomUUID();
      expect(
        await sender.send({
          attemptId: id,
          recipient: "recipient@example.invalid",
          certificateNumber: id,
          pdf: Buffer.from("stored-pdf"),
        }),
      ).toBe(outcome);
      expect(transcript.match(/RCPT TO:/g)).toHaveLength(1);
      expect(transcript).toContain("From: platform@example.invalid");
      expect(transcript).not.toContain("Reply-To:");
      expect(transcript).toContain(`certificate-${id}.pdf`);
      expect(transcript).toContain(
        Buffer.from("stored-pdf").toString("base64"),
      );
      expect(transcript).toContain(
        `certificate-${id}@event-command-center.invalid`,
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
