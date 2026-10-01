import { randomUUID } from "node:crypto";
import { createDatabase } from "./config/database.js";
import { parseFoundationConfig } from "./config/foundation.js";
import { setOrganizerCapability } from "./modules/auth/provision.js";

async function main() {
  const userId = process.env.CAPABILITY_USER_ID;
  const action = process.env.CAPABILITY_ENABLED;
  if (
    process.env.CAPABILITY_APPROVED !== "yes" ||
    !process.argv.includes("--confirm") ||
    !userId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    ) ||
    (action !== "yes" && action !== "no")
  ) {
    throw new Error(
      "Explicit capability approval, valid user, and --confirm are required",
    );
  }
  const config = parseFoundationConfig(process.env);
  const db = createDatabase(config.databaseUrl);
  try {
    await setOrganizerCapability(db, userId, action === "yes", randomUUID());
    process.stdout.write("Organizer capability updated\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write("Capability update failed\n");
  process.exitCode = 1;
});
