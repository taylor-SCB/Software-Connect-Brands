import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { CompanyTiles } from "../company-tiles";
import { DocumentUploadForm } from "../document-upload-form";
import { DocumentList } from "../document-list";

export default async function MarketingPage() {
  const session = await requireSession();
  const timeZone = await getTimeZone();
  const canEdit = session.role === "OWNER" || session.role === "ADMIN";

  const documents = await prisma.upload.findMany({
    where: { organizationId: session.organizationId, kind: "MARKETING" },
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
        title="Marketing"
        subtitle="Brochures, one-pagers and anything else you send with a proposal."
      />

      <CompanyTiles current="marketing" />

      <div className="space-y-5">
        {canEdit && (
          <Card lit>
            <CardHeader title="Upload a file" subtitle="Files stay private to your workspace." />
            <DocumentUploadForm kind="MARKETING" />
          </Card>
        )}

        <Card lit>
          <CardHeader title="On file" subtitle={`${documents.length} ${documents.length === 1 ? "file" : "files"}`} />
          <DocumentList
            documents={documents}
            timeZone={timeZone}
            canEdit={canEdit}
            emptyTitle="No marketing materials yet"
            emptyBody="Upload brochures and one-pagers here so the whole team sends the same ones."
          />
        </Card>
      </div>
    </div>
  );
}
