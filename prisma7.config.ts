import "dotenv/config";
import { defineConfig } from "prisma/config";

// Hosting providers name the connection string differently — Vercel's
// Neon integration injects POSTGRES_* rather than DATABASE_URL — so the
// migration step accepts whichever one is present. This has to match the
// resolution order in src/lib/prisma.ts, otherwise migrations and the
// running app could point at different databases.
const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL ||
  "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url,
  },
});
