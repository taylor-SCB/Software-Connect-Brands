import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { CompanyTiles } from "../company-tiles";
import { DocumentUploadForm } from "../document-upload-form";
import { DocumentList } from "../document-list";

export default async function CompliancePage() {
  const session = await requireSession();
  const timeZone = await getTimeZone();
  const canEdit = session.role === "OWNER" || session.role === "ADMIN";

  const documents = await prisma.upload.findMany({
    where: { organizationId: session.organizationId, kind: "COMPLIANCE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      fileName: true,
      category: true,
      sizeBytes: true,
      expiresOn: true,
      publicToken: true,
      createdAt: true,
    },
  });

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings · Company Information"
        title="Compliance"
        subtitle="W-9, certificate of insurance and licenses, ready to hand to a customer or a general contractor."
      />

      <CompanyTiles current="compliance" />

      <div className="space-y-5">
        {canEdit && (
          <Card lit>
            <CardHeader title="Upload a file" subtitle="Files stay private to your workspace." />
            <DocumentUploadForm kind="COMPLIANCE" />
          </Card>
        )}

        <Card lit>
          <CardHeader title="On file" subtitle={`${documents.length} ${documents.length === 1 ? "file" : "files"}`} />
          <DocumentList
            documents={documents}
            timeZone={timeZone}
            canEdit={canEdit}
            emptyTitle="No compliance files yet"
            emptyBody="Upload your W-9, COI and licenses so they are one click away when a customer asks."
          />
        </Card>
      </div>
    </div>
  );
}
