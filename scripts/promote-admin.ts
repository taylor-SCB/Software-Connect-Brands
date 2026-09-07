/**
 * Grants or revokes operator access.
 *
 *   npx tsx scripts/promote-admin.ts you@example.com
 *   npx tsx scripts/promote-admin.ts you@example.com --revoke
 *   npx tsx scripts/promote-admin.ts --list
 *
 * This is deliberately the *only* way the flag can be set. Nothing in the
 * app writes isSuperAdmin, so no form, request or bug in the signup flow
 * can hand out operator access — it takes the database connection string,
 * which means it takes you.
 */
// Next loads .env for the app; a plain node script does not, so without
// this the script dies on "No database connection string found" even
// though the app beside it connects fine. Does not override a DATABASE_URL
// already exported, so running it against production still works.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    const admins = await prisma.user.findMany({
      where: { isSuperAdmin: true },
      select: { email: true, name: true },
      orderBy: { email: "asc" },
    });
    if (admins.length === 0) {
      console.log("No operators yet.");
      return;
    }
    console.log(`Operators (${admins.length}):`);
    for (const admin of admins) console.log(`  ${admin.email}  ${admin.name}`);
    return;
  }

  const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npx tsx scripts/promote-admin.ts <email> [--revoke]");
    process.exit(1);
  }

  const revoke = args.includes("--revoke");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account with the email ${email}.`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isSuperAdmin: !revoke },
  });

  console.log(
    revoke
      ? `Revoked operator access for ${email}.`
      : `${email} is now an operator. Log out and back in to pick it up.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
