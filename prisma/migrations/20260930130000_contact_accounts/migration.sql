-- "+ Additional Account": a contact linked to more companies than their
-- main one. A new table, so nothing existing changes.
CREATE TABLE "ContactAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactAccount_contactId_companyId_key" ON "ContactAccount"("contactId", "companyId");
CREATE INDEX "ContactAccount_organizationId_idx" ON "ContactAccount"("organizationId");
CREATE INDEX "ContactAccount_companyId_idx" ON "ContactAccount"("companyId");

ALTER TABLE "ContactAccount" ADD CONSTRAINT "ContactAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactAccount" ADD CONSTRAINT "ContactAccount_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactAccount" ADD CONSTRAINT "ContactAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
