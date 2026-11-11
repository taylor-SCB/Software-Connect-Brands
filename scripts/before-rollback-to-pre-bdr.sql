-- Run this BEFORE an Instant Rollback to a build from before the BDR
-- release (final audit, Nov 11, 2026).
--
-- Why: the BDR release added CONNECTED to the ContactStatus list. A build
-- from before it doesn't know that word, and Prisma refuses to read any
-- contact or company whose status is CONNECTED — the Contacts and Companies
-- lists, their pages, the Pipeline and Stats would all fail to open.
--
-- What it does: everyone at Connected goes back to Contacted (shown
-- "Attempted"), the step before it. Nothing is deleted: the StatusChange
-- history still says when each person connected (its columns are plain
-- text the old build reads fine), and the BDR build reads both words, so
-- rolling forward again needs nothing. Safe to run twice.
--
-- How: in the Neon console's SQL editor, on the live database, paste and
-- run it, then use Instant Rollback in Vercel.
BEGIN;
UPDATE "Contact" SET status = 'CONTACTED' WHERE status = 'CONNECTED';
UPDATE "Company" SET status = 'CONTACTED' WHERE status = 'CONNECTED';
COMMIT;
