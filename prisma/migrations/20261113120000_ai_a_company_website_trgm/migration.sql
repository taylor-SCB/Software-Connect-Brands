-- "Looks like the same business" (AI release A, Nov 13, 2026): a company
-- page looks for another company with the same website, so the website
-- gets a trigram index like the name and phone already have. Adds an
-- index only; nothing existing changes.
CREATE INDEX "Company_website_trgm_idx" ON "Company" USING GIN ("website" gin_trgm_ops);
