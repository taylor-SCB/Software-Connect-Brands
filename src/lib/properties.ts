// A building, and the jobs done at it.
//
// The roll-up is a sum of the jobs' own stored numbers, which are
// themselves derived from paperwork — so a property's budget can never
// disagree with the jobs under it, and there is nothing new to keep in
// sync. Which stages count is chosen on the screen rather than stored:
// cancelled work is money that never happened, and whether delayed work
// belongs in a total is a judgement the person looking makes.

// Nothing here touches the database, so the stage chips can import it
// into the browser without dragging Prisma along with them.
import type { ProjectStage } from "@/generated/prisma/enums";

// What a property's bar reads, and what each job contributes to it.
export type Rollup = {
  awardedCents: number;
  spentCents: number;
  committedCents: number;
  receivedCents: number;
  billedCents: number;
  laborSpentCents: number;
  laborCommittedCents: number;
  leftCents: number;
  stillOwedCents: number;
  jobs: number;
};

type Totals = {
  stage: ProjectStage;
  awardedCents: number;
  spentCents: number;
  committedCents: number;
  receivedCents: number;
  billedCents: number;
  laborSpentCents: number;
  laborCommittedCents: number;
};

export function emptyRollup(): Rollup {
  return {
    awardedCents: 0,
    spentCents: 0,
    committedCents: 0,
    receivedCents: 0,
    billedCents: 0,
    laborSpentCents: 0,
    laborCommittedCents: 0,
    leftCents: 0,
    stillOwedCents: 0,
    jobs: 0,
  };
}

// The default: everything except the work that was called off. A
// cancelled job's awarded amount is money nobody ever agreed to pay, so
// leaving it in would overstate every building it touched.
export const DEFAULT_ROLLUP_STAGES: ProjectStage[] = ["AWARDED", "ACTIVE", "ON_HOLD", "COMPLETED"];

export function rollUp(projects: Totals[], stages: ProjectStage[]): Rollup {
  const counted = projects.filter((project) => stages.includes(project.stage));
  const total = emptyRollup();
  for (const project of counted) {
    total.awardedCents += project.awardedCents;
    total.spentCents += project.spentCents;
    total.committedCents += project.committedCents;
    total.receivedCents += project.receivedCents;
    total.billedCents += project.billedCents;
    total.laborSpentCents += project.laborSpentCents;
    total.laborCommittedCents += project.laborCommittedCents;
  }
  total.jobs = counted.length;
  // The same arithmetic as a single job's Left, spelled out rather than
  // imported, to keep this module free of anything server-side.
  total.leftCents = total.awardedCents - total.spentCents - total.committedCents;
  total.stillOwedCents = total.billedCents - total.receivedCents;
  return total;
}

// Reads a stage list out of a URL. Anything unrecognised is dropped, and
// an empty result falls back to the default rather than showing a blank
// page — a bookmarked link with a typo in it should still work.
const ALL_STAGES: ProjectStage[] = ["AWARDED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];

// Next hands back an array when a key appears twice in the URL
// (?stages=A&stages=B), which a bookmarked or hand-edited link does, so
// this takes either shape. Splitting a string it assumed was a string
// used to 500 the page before it could even check the property exists.
export function parseStages(value: string | string[] | undefined): ProjectStage[] {
  if (!value) return DEFAULT_ROLLUP_STAGES;
  const asked = (Array.isArray(value) ? value.join(",") : value)
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part): part is ProjectStage => (ALL_STAGES as string[]).includes(part));
  return asked.length > 0 ? asked : DEFAULT_ROLLUP_STAGES;
}

export function stagesToParam(stages: ProjectStage[]) {
  // The default is left out of the address bar, so a plain link is short.
  const same =
    stages.length === DEFAULT_ROLLUP_STAGES.length &&
    DEFAULT_ROLLUP_STAGES.every((stage) => stages.includes(stage));
  return same ? null : stages.join(",");
}

export { ALL_STAGES };
