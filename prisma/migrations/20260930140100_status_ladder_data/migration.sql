-- Existing records onto the ladder. Only ever moves a status forward from
-- where the rename left it; Won and Archived are never touched.

-- Anyone somebody has already logged a touch with has been Contacted.
UPDATE "Contact" c SET "status" = 'CONTACTED'
 WHERE c."status" = 'NOT_ACTIONED'
   AND EXISTS (SELECT 1 FROM "Activity" a WHERE a."contactId" = c.id AND a."occurredAt" <= now());

-- Paperwork out on an open deal: the person is at Quote Sent / Contract
-- Sent. A won deal makes them Won.
UPDATE "Contact" c SET "status" = 'CONTRACT_SENT'
 WHERE c."status" IN ('NOT_ACTIONED', 'CONTACTED')
   AND EXISTS (SELECT 1 FROM "Deal" d WHERE d."contactId" = c.id AND d."stage" = 'CONTRACT_SENT');
UPDATE "Contact" c SET "status" = 'QUOTE_SENT'
 WHERE c."status" IN ('NOT_ACTIONED', 'CONTACTED')
   AND EXISTS (SELECT 1 FROM "Deal" d WHERE d."contactId" = c.id AND d."stage" = 'QUOTE_SENT');
UPDATE "Contact" c SET "status" = 'WON'
 WHERE c."status" IN ('NOT_ACTIONED', 'CONTACTED', 'QUOTE_SENT', 'CONTRACT_SENT')
   AND EXISTS (SELECT 1 FROM "Deal" d WHERE d."contactId" = c.id AND d."stage" = 'WON');

-- A company touched directly, or through anyone at it, has been Contacted.
UPDATE "Company" co SET "status" = 'CONTACTED'
 WHERE co."status" = 'NOT_ACTIONED'
   AND (EXISTS (SELECT 1 FROM "Activity" a WHERE a."companyId" = co.id AND a."occurredAt" <= now())
     OR EXISTS (SELECT 1 FROM "Contact" c WHERE c."companyId" = co.id AND c."status" <> 'NOT_ACTIONED'));
-- ...and is as far along as the furthest of its people.
UPDATE "Company" co SET "status" = 'WON'
 WHERE co."status" IN ('NOT_ACTIONED', 'CONTACTED')
   AND EXISTS (SELECT 1 FROM "Contact" c WHERE c."companyId" = co.id AND c."status" = 'WON');
UPDATE "Company" co SET "status" = 'CONTRACT_SENT'
 WHERE co."status" IN ('NOT_ACTIONED', 'CONTACTED')
   AND EXISTS (SELECT 1 FROM "Contact" c WHERE c."companyId" = co.id AND c."status" = 'CONTRACT_SENT');
UPDATE "Company" co SET "status" = 'QUOTE_SENT'
 WHERE co."status" IN ('NOT_ACTIONED', 'CONTACTED')
   AND EXISTS (SELECT 1 FROM "Contact" c WHERE c."companyId" = co.id AND c."status" = 'QUOTE_SENT');
