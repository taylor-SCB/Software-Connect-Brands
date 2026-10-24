-- CreateEnum
CREATE TYPE "PhotoTagKind" AS ENUM ('TYPE', 'LOCATION');

-- CreateEnum
CREATE TYPE "PhotoGrantRole" AS ENUM ('VIEW', 'EDIT');

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "photoFolderId" TEXT,
ADD COLUMN     "photoGrantId" TEXT;

-- CreateTable
CREATE TABLE "PhotoTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "PhotoTagKind" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadTag" (
    "uploadId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "UploadTag_pkey" PRIMARY KEY ("uploadId","tagId")
);

-- CreateTable
CREATE TABLE "PhotoFolder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "folderId" TEXT,
    "contactId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" "PhotoGrantRole" NOT NULL DEFAULT 'VIEW',
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhotoTag_organizationId_kind_name_key" ON "PhotoTag"("organizationId", "kind", "name");

-- CreateIndex
CREATE INDEX "UploadTag_tagId_idx" ON "UploadTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoFolder_projectId_name_key" ON "PhotoFolder"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoGrant_token_key" ON "PhotoGrant"("token");

-- CreateIndex
CREATE INDEX "PhotoGrant_projectId_folderId_idx" ON "PhotoGrant"("projectId", "folderId");

-- CreateIndex
CREATE INDEX "PhotoGrant_organizationId_idx" ON "PhotoGrant"("organizationId");

-- CreateIndex
CREATE INDEX "PhotoGrant_contactId_idx" ON "PhotoGrant"("contactId");

-- CreateIndex
CREATE INDEX "Upload_photoFolderId_idx" ON "Upload"("photoFolderId");

-- CreateIndex
CREATE INDEX "Upload_storageKey_idx" ON "Upload"("storageKey");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_photoGrantId_fkey" FOREIGN KEY ("photoGrantId") REFERENCES "PhotoGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_photoFolderId_fkey" FOREIGN KEY ("photoFolderId") REFERENCES "PhotoFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadTag" ADD CONSTRAINT "UploadTag_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadTag" ADD CONSTRAINT "UploadTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "PhotoTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoFolder" ADD CONSTRAINT "PhotoFolder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoFolder" ADD CONSTRAINT "PhotoFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoFolder" ADD CONSTRAINT "PhotoFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoGrant" ADD CONSTRAINT "PhotoGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoGrant" ADD CONSTRAINT "PhotoGrant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoGrant" ADD CONSTRAINT "PhotoGrant_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "PhotoFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoGrant" ADD CONSTRAINT "PhotoGrant_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoGrant" ADD CONSTRAINT "PhotoGrant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Photos already sent (Oct 17-21, 2026) carry one category. It becomes
-- the matching Photo Type tag, creating that tag for the workspace if it
-- doesn't have it yet; "Photo" was the catch-all and is General Project.
INSERT INTO "PhotoTag" ("id", "organizationId", "kind", "name", "position")
SELECT DISTINCT ON (u."organizationId", m.name)
  'pt_' || md5(u."organizationId" || m.name), u."organizationId", 'TYPE', m.name, m.position
FROM "Upload" u
JOIN (VALUES ('Photo', 'General Project', 0), ('Site walk', 'Site Walk', 1), ('Finished install', 'Finished Install', 3))
  AS m(category, name, position) ON m.category = u.category
WHERE u."kind" = 'PROJECT_FILE' AND (u."mimeType" LIKE 'image/%' OR u."mimeType" LIKE 'video/%')
ON CONFLICT ("organizationId", "kind", "name") DO NOTHING;

INSERT INTO "UploadTag" ("uploadId", "tagId")
SELECT u."id", t."id"
FROM "Upload" u
JOIN (VALUES ('Photo', 'General Project'), ('Site walk', 'Site Walk'), ('Finished install', 'Finished Install'))
  AS m(category, name) ON m.category = u.category
JOIN "PhotoTag" t ON t."organizationId" = u."organizationId" AND t."kind" = 'TYPE' AND t."name" = m.name
WHERE u."kind" = 'PROJECT_FILE' AND (u."mimeType" LIKE 'image/%' OR u."mimeType" LIKE 'video/%')
ON CONFLICT DO NOTHING;

UPDATE "Upload" SET "category" = NULL
WHERE "kind" = 'PROJECT_FILE' AND ("mimeType" LIKE 'image/%' OR "mimeType" LIKE 'video/%');

-- A look-only link made before Grant Access becomes a grant on the job's
-- main folder with the same address, so a link already sent keeps working.
INSERT INTO "PhotoGrant" ("id", "organizationId", "projectId", "name", "role", "token", "active", "revokedAt", "lastUsedAt", "createdById", "createdAt")
SELECT "id", "organizationId", "projectId", "label", 'VIEW', "token", "active", "revokedAt", "lastUsedAt", "createdById", "createdAt"
FROM "ProjectPhotoLink" WHERE "kind" = 'VIEW';

DELETE FROM "ProjectPhotoLink" WHERE "kind" = 'VIEW';
