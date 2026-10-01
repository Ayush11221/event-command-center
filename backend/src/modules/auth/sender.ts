import nodemailer from "nodemailer";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContactType } from "@prisma/client";
import type { FoundationConfig } from "../../config/foundation.js";

export interface OtpSender {
  available(type: ContactType): boolean;
  send(type: ContactType, destination: string, code: string): Promise<void>;
}

export interface SmsGateway {
  sendSms(destination: string, message: string): Promise<void>;
}

export async function loadSmsGateway(modulePath: string): Promise<SmsGateway> {
  if (!isAbsolute(modulePath)) {
    throw new Error("SMS_GATEWAY_MODULE must be an absolute local path");
  }
  const module: unknown = await import(pathToFileURL(modulePath).href);
  const candidate = (module as { default?: unknown }).default;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as SmsGateway).sendSms !== "function"
  ) {
    throw new Error("SMS_GATEWAY_MODULE must export a default SmsGateway");
  }
  return candidate as SmsGateway;
}

export function createOtpSender(
  config: FoundationConfig,
  smsGateway?: SmsGateway,
): OtpSender {
  const smtp = config.smtpUrl
    ? nodemailer.createTransport(config.smtpUrl)
    : undefined;
  return {
    available(type) {
      return type === "EMAIL"
        ? Boolean(smtp && config.smtpFrom)
        : Boolean(smsGateway);
    },
    async send(type, destination, code) {
      const message = `Your Event Command Center verification code is ${code}. It expires in 5 minutes.`;
      if (type === "EMAIL") {
        if (!smtp || !config.smtpFrom) throw new Error("Sender unavailable");
        await smtp.sendMail({
          from: config.smtpFrom,
          to: destination,
          subject: "Your verification code",
          text: message,
        });
      } else {
        if (!smsGateway) throw new Error("Sender unavailable");
        await smsGateway.sendSms(destination, message);
      }
    },
  };
}
