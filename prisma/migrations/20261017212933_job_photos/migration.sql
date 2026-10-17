-- CreateEnum
CREATE TYPE "PhotoLinkKind" AS ENUM ('CREW', 'VIEW');

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "photoLinkId" TEXT,
ADD COLUMN     "storageDriver" TEXT,
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "uploadedById" TEXT,
ADD COLUMN     "uploadedByName" TEXT,
ALTER COLUMN "data" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ProjectPhotoLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "PhotoLinkKind" NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "companyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPhotoLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPhotoLink_token_key" ON "ProjectPhotoLink"("token");

-- CreateIndex
CREATE INDEX "ProjectPhotoLink_projectId_kind_idx" ON "ProjectPhotoLink"("projectId", "kind");

-- CreateIndex
CREATE INDEX "ProjectPhotoLink_organizationId_idx" ON "ProjectPhotoLink"("organizationId");

-- CreateIndex
CREATE INDEX "Upload_photoLinkId_idx" ON "Upload"("photoLinkId");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_photoLinkId_fkey" FOREIGN KEY ("photoLinkId") REFERENCES "ProjectPhotoLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhotoLink" ADD CONSTRAINT "ProjectPhotoLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhotoLink" ADD CONSTRAINT "ProjectPhotoLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhotoLink" ADD CONSTRAINT "ProjectPhotoLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhotoLink" ADD CONSTRAINT "ProjectPhotoLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
