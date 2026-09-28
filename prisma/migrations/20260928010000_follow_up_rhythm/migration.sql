-- The follow-up rhythm: how many days after a quote or contract goes out
-- each follow-up lands on the calendar (Settings → General).
--
-- Safe for rows that already exist: both columns default to [3], which
-- is exactly what the app did before this setting existed.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "contractFollowUpDays" INTEGER[] DEFAULT ARRAY[3]::INTEGER[],
ADD COLUMN     "quoteFollowUpDays" INTEGER[] DEFAULT ARRAY[3]::INTEGER[];
