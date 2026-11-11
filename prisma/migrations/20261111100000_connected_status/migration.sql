-- BDR redesign (Nov 11, 2026, approved decision 2): Connected sits between
-- Contacted and Interested. On its own, because Postgres can't use a new
-- enum value in the transaction that adds it. No row is moved.
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'CONNECTED' AFTER 'CONTACTED';
