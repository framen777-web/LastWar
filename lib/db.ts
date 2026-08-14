import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set (see .env.example)");

// Managed Postgres (Render, Neon, Supabase, etc.) requires SSL for external connections and
// serves certs `pg` won't validate against the default CA bundle - a local/self-hosted
// Postgres on localhost typically has no SSL listener at all. Branching on host, not just
// always enabling SSL, so local dev against a plain local Postgres keeps working.
const isLocalHost = /^(localhost|127\.0\.0\.1|::1)/i.test(new URL(connectionString).hostname);

const adapter = new PrismaPg({
  connectionString,
  ssl: isLocalHost ? undefined : { rejectUnauthorized: false },
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
