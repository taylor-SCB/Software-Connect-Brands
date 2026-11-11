/* Label old calls that plainly say they reached nobody (approved decision
 * 10, Nov 11, 2026; for the demo workspace only).
 *
 * Calls logged before a workspace started recording outcomes
 * (Organization.outcomesSince) have no outcome, so they count as plain
 * tries. This finds the ones whose note plainly says "voicemail" / "VM" /
 * "left a message" (→ VOICEMAIL) or "no answer" / "didn't pick up" / "busy"
 * (→ NO_ANSWER), so their history shows the grey attempt tags. It never
 * writes TALKED, REPLIED or anything else, never touches a call that has an
 * outcome, a call dated on or after outcomesSince, a text, email or
 * meeting, or a note that also mentions talking, speaking, connecting,
 * interest or a meeting booked.
 *
 * Usage (DATABASE_URL in the environment):
 *   node scripts/label-old-attempts.cjs                 dry run: counts for every workspace
 *   node scripts/label-old-attempts.cjs --org demo-summit
 *                                                       dry run for that workspace
 *   node scripts/label-old-attempts.cjs --apply --org demo-summit
 *                                                       write it, for that workspace only
 *
 * --apply refuses without --org, and each named workspace is written in its
 * own transaction. A workspace not named is never touched. Run it only
 * where Taylor has said yes (the demo); never against the live site
 * without asking him first.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS, run with node */
const { Client } = require("pg");

const VOICEMAIL = String.raw`(voice ?mail|\yvm\y|\ylvm\y|left (a )?(message|msg)|mailbox (is )?full)`;
const NO_ANSWER = String.raw`(no answer|did ?n[o']?t answer|did not answer|didn'?t pick up|no pick ?up|\ybusy\y|rang out)`;
const NOT_PLAIN = String.raw`(talked|talk(ed)? to|spoke|spoken|speaking|connected|interested|meeting (booked|set)|booked a meeting|call(ed)? (me )?back)`;

function readArgs(argv) {
  const args = { apply: false, orgs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--org") {
      const slug = argv[i + 1];
      if (!slug || slug.startsWith("--")) throw new Error("--org needs a workspace slug after it");
      args.orgs.push(slug);
      i += 1;
    } else if (arg.startsWith("--org=")) args.orgs.push(arg.slice("--org=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

// The rows this would label, with the outcome each would get. $1 is the
// workspace id; the patterns go in as $2–$4 (they hold apostrophes).
const CANDIDATES = `
  SELECT a.id,
         CASE WHEN a.body ~* $2 THEN 'VOICEMAIL' ELSE 'NO_ANSWER' END AS outcome
    FROM "Activity" a
    JOIN "Organization" o ON o.id = a."organizationId"
   WHERE a."organizationId" = $1
     AND a.type = 'PHONE_CALL'
     AND a.outcome IS NULL
     AND a.marketing = false
     AND a."occurredAt" < COALESCE(o."outcomesSince", now())
     AND (a.body ~* $2 OR a.body ~* $3)
     AND a.body !~* $4`;
const PATTERNS = [VOICEMAIL, NO_ANSWER, NOT_PLAIN];

async function main() {
  let args;
  try {
    args = readArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (args.apply && args.orgs.length === 0) {
    console.error("Refused: --apply needs --org <workspace slug>. Nothing was written.");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL first.");
    process.exit(2);
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const orgs = args.orgs.length
      ? (await db.query(`SELECT id, slug, name FROM "Organization" WHERE slug = ANY($1) ORDER BY slug`, [args.orgs])).rows
      : (await db.query(`SELECT id, slug, name FROM "Organization" ORDER BY slug`)).rows;
    const missing = args.orgs.filter((slug) => !orgs.some((org) => org.slug === slug));
    if (missing.length) {
      console.error(`No workspace with the slug ${missing.join(", ")}. Nothing was written.`);
      process.exit(2);
    }

    console.log(args.apply ? "Labelling old calls (writing):" : "Dry run — nothing is written. Old calls that would be labelled:");
    let total = 0;
    for (const org of orgs) {
      if (args.apply) {
        await db.query("BEGIN");
        try {
          const { rows } = await db.query(
            `WITH c AS (${CANDIDATES})
             UPDATE "Activity" a SET outcome = c.outcome::"ActivityOutcome"
               FROM c
              WHERE a.id = c.id AND a."organizationId" = $1 AND a.outcome IS NULL
             RETURNING c.outcome`,
            [org.id, ...PATTERNS],
          );
          await db.query("COMMIT");
          const counts = tally(rows);
          total += rows.length;
          console.log(`  ${org.slug}: ${counts.VOICEMAIL} voicemail, ${counts.NO_ANSWER} no answer — written`);
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        }
      } else {
        const { rows } = await db.query(CANDIDATES, [org.id, ...PATTERNS]);
        const counts = tally(rows);
        total += rows.length;
        if (rows.length || args.orgs.length) console.log(`  ${org.slug}: ${counts.VOICEMAIL} voicemail, ${counts.NO_ANSWER} no answer`);
      }
    }
    console.log(`${args.apply ? "Labelled" : "Would label"} ${total} ${total === 1 ? "call" : "calls"} in all.`);
  } finally {
    await db.end();
  }
}

function tally(rows) {
  const counts = { VOICEMAIL: 0, NO_ANSWER: 0 };
  for (const row of rows) counts[row.outcome] += 1;
  return counts;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
