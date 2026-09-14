// Recomputes every job's budget numbers from the paperwork, in case the
// stored ones are ever doubted. The app keeps them up to date itself, so
// this should always report that nothing changed.
//
//   npm run recompute-projects
//   npm run recompute-projects -- --check     (report drift, change nothing)

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { refreshTotals } from "../src/lib/projects";

const TOTALS = {
  awardedCents: true,
  spentCents: true,
  committedCents: true,
  receivedCents: true,
  billedCents: true,
  plannedCostCents: true,
  laborSpentCents: true,
  laborCommittedCents: true,
} as const;

type Totals = {
  awardedCents: number;
  spentCents: number;
  committedCents: number;
  receivedCents: number;
  billedCents: number;
  plannedCostCents: number;
  laborSpentCents: number;
  laborCommittedCents: number;
};

const FIELDS = Object.keys(TOTALS) as (keyof Totals)[];

async function main() {
  const checkOnly = process.argv.includes("--check");
  const projects = await prisma.project.findMany({
    select: { id: true, number: true, name: true, organizationId: true, ...TOTALS },
  });

  let drifted = 0;
  for (const project of projects) {
    const before: Totals = {
      awardedCents: project.awardedCents,
      spentCents: project.spentCents,
      committedCents: project.committedCents,
      receivedCents: project.receivedCents,
      billedCents: project.billedCents,
      plannedCostCents: project.plannedCostCents,
      laborSpentCents: project.laborSpentCents,
      laborCommittedCents: project.laborCommittedCents,
    };

    await prisma.$transaction((tx) => refreshTotals(tx, project.organizationId, project.id));
    const after = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: TOTALS,
    });

    const changed = FIELDS.filter((field) => before[field] !== after[field]);
    if (changed.length === 0) continue;

    drifted += 1;
    console.log(`PRJ-${project.number} ${project.name}`);
    for (const field of changed) {
      console.log(`  ${field}: ${before[field]} → ${after[field]}`);
    }
    // --check reports what would change and puts the stored numbers back.
    if (checkOnly) {
      await prisma.project.update({ where: { id: project.id }, data: before });
    }
  }

  console.log(
    drifted === 0
      ? `${projects.length} ${projects.length === 1 ? "job" : "jobs"} checked, every number already right.`
      : `${drifted} of ${projects.length} ${checkOnly ? "would change" : "brought back in line"}.`,
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
