import { notFound, redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, BackLink } from "@/components/ui";
import { DeleteButton } from "@/components/delete-button";
import { MarketingTemplateForm } from "../template-form";
import { deleteMarketingTemplate, updateMarketingTemplate } from "../../actions";

export default async function EditMarketingTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAdminSession();
  if (!session.allowed) redirect("/dashboard/settings/marketing");

  const template = await prisma.marketingTemplate.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, name: true, subject: true, body: true },
  });
  if (!template) notFound();

  return (
    <div className="max-w-3xl">
      <BackLink href="/dashboard/settings/marketing" label="Marketing" current={template.name} />
      <PageHeader
        eyebrow="Settings · Company Information · Marketing"
        title={template.name}
        actions={
          <DeleteButton
            action={deleteMarketingTemplate}
            hiddenName="id"
            hiddenValue={template.id}
            label={`Delete ${template.name}`}
            question="Delete this template?"
            note="Emails already sent are not affected."
          />
        }
      />
      <Card lit className="p-5">
        <MarketingTemplateForm action={updateMarketingTemplate} defaults={template} submitLabel="Save changes" />
      </Card>
    </div>
  );
}
