import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import Link from "next/link";
import { PageHeader, Card, CardHeader, EmptyState } from "@/components/ui";
import { IconPlus, IconMail, IconEdit } from "@/components/icons";
import { EmailButton } from "@/components/email-composer";
import { formatDate } from "@/lib/format";
import { CompanyTiles } from "../company-tiles";
import { DocumentUploadForm } from "../document-upload-form";
import { DocumentList } from "../document-list";

export default async function MarketingPage() {
  const session = await requireSession();
  const timeZone = await getTimeZone();
  const canEdit = session.role === "OWNER" || session.role === "ADMIN";

  const templates = await prisma.marketingTemplate.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, subject: true, updatedAt: true },
  });

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
        subtitle="Brochures, one-pagers and email templates. Press Email on any of them to send it to your contacts."
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
            emailable
            emptyTitle="No marketing materials yet"
            emptyBody="Upload brochures and one-pagers here so the whole team sends the same ones."
          />
        </Card>

        <Card lit id="templates">
          <CardHeader
            title="Email templates"
            subtitle="Saved emails with fields that fill in for each person."
            actions={
              canEdit ? (
                <Link href="/dashboard/settings/marketing/templates/new" className="btn btn-primary btn-sm">
                  <IconPlus size={13} />
                  New template
                </Link>
              ) : undefined
            }
          />
          {templates.length === 0 ? (
            <EmptyState
              icon={<IconMail size={20} />}
              title="No email templates yet"
              body={canEdit ? "Write the emails your team sends most, once, so everybody sends them the same way." : "An owner or admin can write templates here."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Subject</th>
                    <th>Updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {templates.map((template) => (
                    <tr key={template.id} data-testid="marketing-template-row">
                      <td className="font-medium">{template.name}</td>
                      <td className="muted">{template.subject}</td>
                      <td className="faint text-xs">{formatDate(template.updatedAt, timeZone)}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <EmailButton templateId={template.id} title={`Email ${template.name}`} />
                          {canEdit && (
                            <Link
                              href={`/dashboard/settings/marketing/templates/${template.id}`}
                              className="btn btn-ghost btn-sm"
                              title={`Edit ${template.name}`}
                              aria-label={`Edit ${template.name}`}
                            >
                              <IconEdit size={13} />
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
