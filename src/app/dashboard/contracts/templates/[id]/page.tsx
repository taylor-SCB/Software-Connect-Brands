import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, BackLink, PageHeader } from "@/components/ui";
import { IconTrash, IconPlus } from "@/components/icons";
import { TemplateForm } from "../template-form";
import { updateTemplate, deleteTemplate } from "../../actions";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const template = await prisma.contractTemplate.findFirst({
    where: { id, organizationId },
    include: { _count: { select: { contracts: true } } },
  });
  if (!template) notFound();

  return (
    <div className="max-w-3xl">
      <BackLink href="/dashboard/contracts/templates" label="Templates" />
      <PageHeader
        eyebrow="Agreements"
        title={template.name}
        subtitle={`${template._count.contracts} contract${template._count.contracts === 1 ? "" : "s"} generated from this template`}
        actions={
          <Link
            href={`/dashboard/contracts/new?templateId=${template.id}`}
            className="btn btn-ghost btn-sm"
          >
            <IconPlus size={13} />
            Use template
          </Link>
        }
      />

      <Card lit>
        <CardHeader title="Template" />
        <TemplateForm
          action={updateTemplate}
          submitLabel="Save changes"
          defaults={{
            id: template.id,
            name: template.name,
            type: template.type,
            description: template.description,
            body: template.body,
          }}
        />
      </Card>

      <Card className="mt-5 border-[rgb(251_113_133/0.25)]">
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
