import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 is engine-free and connects via a driver adapter. The connection string is
// provided here (not in the schema); prisma.config.ts carries it for the CLI/migrations.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Cached on globalThis so `ts-node-dev --respawn` reuses one client/pool instead of
// opening a new pool on every restart.
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
