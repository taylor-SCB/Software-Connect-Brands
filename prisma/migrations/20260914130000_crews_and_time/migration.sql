-- Crews and time on a job.
--
-- Safe for rows that already exist: three brand-new tables, two new
-- nullable columns on ProjectScope (crewId) and four new defaulted
-- columns holding the crew-time part of Spent and Committed, which start
-- at 0 on every existing project and scope and are recomputed from the
-- time entries by refreshTotals (nothing is logged yet, so 0 is right).

-- CreateEnum
CREATE TYPE "CrewKind" AS ENUM ('OWN', 'SUBCONTRACTOR');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "laborCommittedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "laborSpentCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProjectScope" ADD COLUMN     "crewId" TEXT,
ADD COLUMN     "laborCommittedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "laborSpentCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CrewKind" NOT NULL DEFAULT 'OWN',
    "companyId" TEXT,
    "contactId" TEXT,
    "serviceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hourlyRateCents" INTEGER,
    "dailyRateCents" INTEGER,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "crewId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "hourlyRateCents" INTEGER,
    "dailyRateCents" INTEGER,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scopeId" TEXT,
    "crewId" TEXT,
    "workerId" TEXT,
    "workerName" TEXT NOT NULL,
    "workedOn" DATE NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hourlyRateCents" INTEGER NOT NULL DEFAULT 0,
    "dailyRateCents" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "countsAsCost" BOOLEAN NOT NULL DEFAULT true,
    "paidOn" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Crew_organizationId_active_idx" ON "Crew"("organizationId", "active");

-- CreateIndex
CREATE INDEX "Crew_companyId_idx" ON "Crew"("companyId");

-- CreateIndex
CREATE INDEX "Crew_contactId_idx" ON "Crew"("contactId");

-- CreateIndex
CREATE INDEX "Worker_organizationId_active_idx" ON "Worker"("organizationId", "active");

-- CreateIndex
CREATE INDEX "Worker_crewId_idx" ON "Worker"("crewId");

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_workedOn_idx" ON "TimeEntry"("organizationId", "workedOn");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_workedOn_idx" ON "TimeEntry"("projectId", "workedOn");

-- CreateIndex
CREATE INDEX "TimeEntry_scopeId_idx" ON "TimeEntry"("scopeId");

-- CreateIndex
CREATE INDEX "TimeEntry_crewId_workedOn_idx" ON "TimeEntry"("crewId", "workedOn");

-- CreateIndex
CREATE INDEX "TimeEntry_workerId_idx" ON "TimeEntry"("workerId");

-- CreateIndex
CREATE INDEX "ProjectScope_crewId_idx" ON "ProjectScope"("crewId");

-- AddForeignKey
ALTER TABLE "ProjectScope" ADD CONSTRAINT "ProjectScope_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "ProjectScope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

