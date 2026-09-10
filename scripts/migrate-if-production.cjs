/* Runs `prisma migrate deploy` only for the live site.
 *
 * Every Vercel build, for every branch, gets the same DATABASE_URL, so a
 * migration in the build script would change the live database the moment
 * a working branch was pushed, a day before the code that expects it went
 * live. That happened once (Sept 9, 2026). Now only a production build
 * (the live branch) touches the database; preview builds just compile.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS so the build step needs no bundling */
const { spawnSync } = require("node:child_process");

if (process.env.VERCEL_ENV !== "production") {
  console.log(
    `Skipping migrations: VERCEL_ENV is "${process.env.VERCEL_ENV ?? ""}", not "production".`,
  );
  process.exit(0);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
