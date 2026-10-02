-- A second email and phone on a contact, each labelled Personal or Work.
-- Every new column is nullable or has a default, so existing rows are
-- valid as they stand.
CREATE TYPE "ChannelLabel" AS ENUM ('WORK', 'PERSONAL');

ALTER TABLE "Contact"
  ADD COLUMN "emailLabel" "ChannelLabel" NOT NULL DEFAULT 'WORK',
  ADD COLUMN "email2" TEXT,
  ADD COLUMN "email2Label" "ChannelLabel" NOT NULL DEFAULT 'PERSONAL',
  ADD COLUMN "phoneLabel" "ChannelLabel" NOT NULL DEFAULT 'WORK',
  ADD COLUMN "phone2" TEXT,
  ADD COLUMN "phone2Label" "ChannelLabel" NOT NULL DEFAULT 'PERSONAL';

-- The list search matches these the same way it matches the first pair.
CREATE INDEX "Contact_email2_trgm_idx" ON "Contact" USING GIN ("email2" gin_trgm_ops);
CREATE INDEX "Contact_phone2_trgm_idx" ON "Contact" USING GIN ("phone2" gin_trgm_ops);
