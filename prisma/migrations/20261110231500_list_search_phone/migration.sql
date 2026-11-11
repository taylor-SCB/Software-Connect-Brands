-- The Contacts and Companies search box (UX review, Nov 10, 2026).
-- Hand-made indexes, like Contact_mobile_trgm_idx: Prisma's schema can't
-- describe an index on an expression, so `prisma migrate dev` will offer
-- to drop these three; take those lines out of the migration it writes.

-- A search that is a phone number is compared digits-only, because phones
-- are stored however they were typed or imported: "(512) 555-0125" is
-- found by 512-555-0125, 5125550125 or 512.555.0125. One index over all
-- three of a contact's numbers, kept apart by "|" so a match can't run
-- from the end of one into the next. The expressions must stay exactly
-- the ones contactIdsByPhone / companyIdsByPhone in src/lib/list-query.ts
-- search, or Postgres won't use them.
CREATE INDEX "Contact_phone_digits_trgm_idx" ON "Contact" USING GIN (
  (regexp_replace(coalesce("phone", '') || '|' || coalesce("phone2", '') || '|' || coalesce("mobile", ''), '[^0-9|]', '', 'g')) gin_trgm_ops
);
CREATE INDEX "Company_phone_digits_trgm_idx" ON "Company" USING GIN (
  (regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')) gin_trgm_ops
);

-- The search now finds a job title too ("property manager"), and every
-- other column it reads has a trigram index; without this one the whole
-- search would fall back to reading every contact.
CREATE INDEX "Contact_title_trgm_idx" ON "Contact" USING GIN ("title" gin_trgm_ops);
