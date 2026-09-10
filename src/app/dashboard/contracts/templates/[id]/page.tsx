import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { loadContractPickers } from "@/lib/contract-pickers";
import { Card, CardHeader, BackLink, PageHeader, Badge } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { TemplateWorkspace } from "../template-workspace";
import { updateTemplate, deleteTemplate } from "../../actions";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId, userId } = await requireSession();

  const [template, pickers] = await Promise.all([
    prisma.contractTemplate.findFirst({
      where: { id, organizationId },
      include: { _count: { select: { contracts: true } } },
    }),
    loadContractPickers(organizationId),
  ]);
  if (!template) notFound();

  return (
    <div>
      <BackLink href="/dashboard/contracts/templates" label="Templates" current={template.name} />
      <PageHeader
        eyebrow="Agreements"
        title={template.name}
        subtitle={`${template._count.contracts} contract${template._count.contracts === 1 ? "" : "s"} generated from this template`}
        actions={<Badge>{template.type}</Badge>}
      />

      <TemplateWorkspace
        action={updateTemplate}
        submitLabel="Save changes"
        currentUserId={userId}
        pickers={pickers}
        defaults={{
          id: template.id,
          name: template.name,
          type: template.type,
          description: template.description,
          body: template.body,
          allUsersCanSend: template.allUsersCanSend,
          senderUserIds: template.senderUserIds,
        }}
      />

      <Card className="mt-6 border-[rgb(251_113_133/0.25)]">
        <CardHeader
          title="Danger zone"
          subtitle="Contracts already generated keep their own copy of the text and are unaffected."
        />
        <form action={deleteTemplate} className="p-5">
          <input type="hidden" name="templateId" value={template.id} />
          <button type="submit" className="btn btn-danger btn-sm">
            <IconTrash size={13} />
            Delete template
          </button>
        </form>
      </Card>
    </div>
  );
}
