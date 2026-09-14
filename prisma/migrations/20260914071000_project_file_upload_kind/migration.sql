-- Files can belong to a job: a photo from site, a receipt, or the other
-- party's own contract when theirs was the paper that got signed.
--
-- On its own in this file because Postgres will not let a value added to
-- an enum be used in the same transaction that adds it. Safe for rows
-- that already exist: adding a value changes no row.

-- AlterEnum
ALTER TYPE "UploadKind" ADD VALUE 'PROJECT_FILE';
