-- "Looks like the same business" (AI release A, Nov 13, 2026): a company
-- page looks for another company with the same website, so the website
-- gets a trigram index like the name and phone already have. Adds an
-- index only; nothing existing changes.
CREATE INDEX "Company_website_trgm_idx" ON "Company" USING GIN ("website" gin_trgm_ops);

-- The company page's same-name check compares Find duplicates' name key
-- (letters and digits, lower case). Prisma's schema can't describe an
-- index on an expression, so `prisma migrate dev` will offer to drop this
-- one; take that line out of the migration it writes.
CREATE INDEX "Company_name_key_idx" ON "Company" ("organizationId", (lower(regexp_replace("name", '[^[:alnum:]]+', '', 'g'))));
