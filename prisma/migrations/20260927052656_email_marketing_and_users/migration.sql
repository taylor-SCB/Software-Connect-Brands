-- CreateEnum
CREATE TYPE "EmailSendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "emailOptOutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PasswordReset" ADD COLUMN     "isInvite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "removedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MarketingTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "contactId" TEXT,
    "templateId" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "attachmentNames" TEXT[],
    "status" "EmailSendStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "providerId" TEXT,
    "unsubscribeToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingTemplate_organizationId_idx" ON "MarketingTemplate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSend_unsubscribeToken_key" ON "EmailSend"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "EmailSend_organizationId_userId_createdAt_idx" ON "EmailSend"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailSend_contactId_idx" ON "EmailSend"("contactId");

-- AddForeignKey
ALTER TABLE "MarketingTemplate" ADD CONSTRAINT "MarketingTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MarketingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
