-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "docusignEnvelopeId" TEXT,
ADD COLUMN "docusignStatus" TEXT,
ADD COLUMN "docusignSignedPdfUrl" TEXT;
