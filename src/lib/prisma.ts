import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Reuse a single PrismaClient across hot reloads in development so we
// don't open a new connection pool on every file save. The adapter is
// built inside the factory rather than at module scope, otherwise every
// reload opens a pool that the cached client never uses.
// Typed from the factory so the global omit config below is part of the
// client's type everywhere it is used.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

// Hosting providers name this variable differently — Vercel's Postgres
// integration injects POSTGRES_* rather than DATABASE_URL — so accept
// whichever one is present instead of failing with an empty connection
// string that's hard to diagnose from a build log.
function databaseUrl() {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL;

  if (!url) {
    throw new Error(
      "No database connection string found. Set DATABASE_URL (see .env.example).",
    );
  }
  return url;
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl() }),
    // Uploaded files (ratesheets, logos, W-9s) live in Bytes columns. Prisma returns every
    // scalar by default, which would pull each upload's whole file through
    // the server just to list its name. Opt out globally; the download
    // route selects `data` explicitly.
    omit: { linkedRatesheet: { data: true }, upload: { data: true } },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
