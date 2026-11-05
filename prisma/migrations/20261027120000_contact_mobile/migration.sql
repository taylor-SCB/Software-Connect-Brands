-- A Mobile number on a contact, its own field beside Phone. Nullable, so
-- existing rows are valid as they stand.
ALTER TABLE "Contact" ADD COLUMN "mobile" TEXT;

-- The list search matches it the same way it matches the two phones.
CREATE INDEX "Contact_mobile_trgm_idx" ON "Contact" USING GIN ("mobile" gin_trgm_ops);

-- One-time clean-up (Taylor, Oct 27, 2026): earlier imports saved
-- placeholder numbers such as 111-111-1111 and 123-456-7890 as a
-- contact's Phone. Blank the ones that are plainly not a number, by the
-- same rule the import now uses (realPhone in src/lib/contacts-csv.ts):
-- an extension aside and a leading US 1 dropped, fewer than 10 digits,
-- every digit the same, or a straight count up or down.
WITH checked AS (
  SELECT id,
         regexp_replace(
           regexp_replace(phone, '\s*(x|ext\.?|extension)\s*\d+\s*$', '', 'i'),
           '\D', '', 'g'
         ) AS digits
  FROM "Contact"
  WHERE phone IS NOT NULL
), national AS (
  SELECT id,
         CASE WHEN length(digits) = 11 AND left(digits, 1) = '1' THEN substr(digits, 2) ELSE digits END AS digits
  FROM checked
)
UPDATE "Contact" c
SET phone = NULL
FROM national n
WHERE c.id = n.id
  AND (
    length(n.digits) < 10
    OR n.digits ~ '^(\d)\1*$'
    OR n.digits IN ('1234567890', '0123456789', '9876543210', '0987654321')
  );

-- A company phone the app copied up from those people on its own (marked
-- "phone" in autoFilled) goes with them. A phone a person typed on a
-- company is left alone.
WITH checked AS (
  SELECT id,
         regexp_replace(
           regexp_replace(phone, '\s*(x|ext\.?|extension)\s*\d+\s*$', '', 'i'),
           '\D', '', 'g'
         ) AS digits
  FROM "Company"
  WHERE phone IS NOT NULL AND 'phone' = ANY ("autoFilled")
), national AS (
  SELECT id,
         CASE WHEN length(digits) = 11 AND left(digits, 1) = '1' THEN substr(digits, 2) ELSE digits END AS digits
  FROM checked
)
UPDATE "Company" c
SET phone = NULL,
    "autoFilled" = array_remove(c."autoFilled", 'phone')
FROM national n
WHERE c.id = n.id
  AND (
    length(n.digits) < 10
    OR n.digits ~ '^(\d)\1*$'
    OR n.digits IN ('1234567890', '0123456789', '9876543210', '0987654321')
  );
