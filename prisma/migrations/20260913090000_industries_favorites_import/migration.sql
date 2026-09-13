-- Industry + Company Type pick lists, favorites, and the indexes that keep
-- the Contacts and Companies lists fast once a workspace holds hundreds
-- of thousands of rows.
--
-- Safe for rows that already exist: every new column has a default (empty
-- list, false), the pick lists are seeded lazily by the app the first time
-- a workspace opens a form, and nothing here rewrites data.

-- Trigram matching so "contains" searches on names, emails and phones use
-- an index instead of scanning every row. Neon and local Postgres both
-- ship pg_trgm.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "companyTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "favorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "industries" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "favorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "IndustryOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyTypeOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyTypeOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IndustryOption_organizationId_idx" ON "IndustryOption"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IndustryOption_organizationId_name_key" ON "IndustryOption"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CompanyTypeOption_organizationId_idx" ON "CompanyTypeOption"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTypeOption_industryId_name_key" ON "CompanyTypeOption"("industryId", "name");

-- CreateIndex
CREATE INDEX "Company_organizationId_updatedAt_idx" ON "Company"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Company_organizationId_state_idx" ON "Company"("organizationId", "state");

-- CreateIndex
CREATE INDEX "Company_organizationId_favorite_idx" ON "Company"("organizationId", "favorite");

-- CreateIndex
CREATE INDEX "Company_industries_idx" ON "Company" USING GIN ("industries");

-- CreateIndex
CREATE INDEX "Company_companyTypes_idx" ON "Company" USING GIN ("companyTypes");

-- CreateIndex
CREATE INDEX "Contact_organizationId_updatedAt_idx" ON "Contact"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Contact_organizationId_state_idx" ON "Contact"("organizationId", "state");

-- CreateIndex
CREATE INDEX "Contact_organizationId_favorite_idx" ON "Contact"("organizationId", "favorite");

-- CreateIndex
CREATE INDEX "Contact_organizationId_email_idx" ON "Contact"("organizationId", "email");

-- AddForeignKey
ALTER TABLE "IndustryOption" ADD CONSTRAINT "IndustryOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTypeOption" ADD CONSTRAINT "CompanyTypeOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTypeOption" ADD CONSTRAINT "CompanyTypeOption_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "IndustryOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Search indexes (see src/lib/list-query.ts): ILIKE '%text%' on these
-- columns is answered from the trigram index.
CREATE INDEX "Contact_name_trgm_idx" ON "Contact" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Contact_email_trgm_idx" ON "Contact" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "Contact_phone_trgm_idx" ON "Contact" USING GIN ("phone" gin_trgm_ops);
CREATE INDEX "Company_name_trgm_idx" ON "Company" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Company_phone_trgm_idx" ON "Company" USING GIN ("phone" gin_trgm_ops);
