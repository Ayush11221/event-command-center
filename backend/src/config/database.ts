import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export function createDatabase(databaseUrl: string): PrismaClient {
  const max = Number(process.env.DB_POOL_MAX ?? "10");
  if (!Number.isInteger(max) || max < 1 || max > 50)
    throw new Error("DB_POOL_MAX must be an integer between 1 and 50");
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 3000,
    max,
  });
  return new PrismaClient({ adapter });
}
