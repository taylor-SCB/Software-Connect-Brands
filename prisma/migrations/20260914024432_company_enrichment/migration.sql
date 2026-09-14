-- Company enrichment: the app tags imported companies and fills in
-- missing phones and websites from the spreadsheet and the company's
-- own people (src/lib/enrich.ts). `autoFilled` names the fields it
-- filled so they wear a small "auto" mark until a person confirms or
-- edits them; `enrichedAt` is when it last did so.
--
-- Safe for rows that already exist: both columns have a default (empty
-- list, null) and nothing here rewrites data. Existing companies are
-- only touched when someone presses "Fill in missing".
--
-- No index on autoFilled: the "Auto-filled" toggle filters on a non-empty
-- list (`<> '{}'`), which a GIN index cannot serve (checked with EXPLAIN;
-- it only helps &&, @>, <@), and the organizationId index already narrows
-- the query enough.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "autoFilled" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "enrichedAt" TIMESTAMP(3);
