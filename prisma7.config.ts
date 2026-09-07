import "dotenv/config";
import { defineConfig } from "prisma/config";

// Hosting providers name the connection string differently — Vercel's
// Neon integration injects POSTGRES_* rather than DATABASE_URL — so the
// migration step accepts whichever one is present. This has to match the
// resolution order in src/lib/prisma.ts, otherwise migrations and the
// running app could point at different databases.
const CANDIDATES = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"] as const;

const url = CANDIDATES.map((name) => process.env[name]).find(Boolean) ?? "";

// Prisma's own message for a missing URL is "Connection url is empty",
// which doesn't say which variable it wanted or what the environment
// actually had. Name both — keys only, never values, since the value is a
// database password.
if (!url) {
  const postgresish = Object.keys(process.env)
    .filter((key) => /(DATABASE|POSTGRES|NEON|PG)/i.test(key))
    .sort();

  throw new Error(
    [
      "No database connection string found.",
      `Looked for: ${CANDIDATES.join(", ")}`,
      postgresish.length
        ? `Database-ish variables this environment does have: ${postgresish.join(", ")}`
        : "This environment has no database-related variables at all.",
      "Set DATABASE_URL in your host's environment variable settings.",
    ].join("\n"),
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url,
  },
});
