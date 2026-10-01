import { randomUUID } from "node:crypto";
import { ContactType } from "@prisma/client";
import { createDatabase } from "./config/database.js";
import { parseFoundationConfig } from "./config/foundation.js";
import { provisionAccount } from "./modules/auth/provision.js";

async function main() {
  if (
    process.env.BOOTSTRAP_APPROVED !== "yes" ||
    !process.argv.includes("--confirm")
  ) {
    throw new Error("Explicit bootstrap approval and --confirm are required");
  }
  const type = process.env.BOOTSTRAP_CONTACT_TYPE;
  const value = process.env.BOOTSTRAP_CONTACT_VALUE;
  const organizer = process.env.BOOTSTRAP_ORGANIZER;
  if (
    (type !== "EMAIL" && type !== "PHONE") ||
    !value ||
    (organizer !== "yes" && organizer !== "no")
  ) {
    throw new Error(
      "Bootstrap contact type, value and organizer flag are required",
    );
  }
  const config = parseFoundationConfig(process.env);
  const db = createDatabase(config.databaseUrl);
  try {
    const id = await provisionAccount(
      db,
      config,
      type as ContactType,
      value,
      organizer === "yes",
      randomUUID(),
    );
    process.stdout.write(`Provisioned User ${id}\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write("Account bootstrap failed\n");
  process.exitCode = 1;
});
