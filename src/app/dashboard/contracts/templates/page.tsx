import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { PageHeader, Card, EmptyState, Badge, BackLink } from "@/components/ui";
import { IconPlus, IconFileText } from "@/components/icons";
import { CONTRACT_TYPE_LABELS, type ContractTypeValue } from "@/lib/constants";

export default async function TemplatesPage() {
  const { organizationId } = await requireSession();

  const templates = await prisma.contractTemplate.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { contracts: true } } },
  });

  return (
    <div>
      <BackLink href="/dashboard/contracts" label="Contracts" />
      <PageHeader
        eyebrow="Agreements"
        title="Contract templates"
        subtitle="Reusable wording with merge fields that fill in customer details."
        actions={
          <Link
            href="/dashboard/contracts/templates/new"
            className="btn btn-primary btn-sm"
          >
            <IconPlus size={14} />
            New template
          </Link>
        }
      />

      {templates.length === 0 ? (
        <Card lit>
          <EmptyState
            icon={<IconFileText size={20} />}
            title="No templates"
            body="Create a reusable agreement so your team isn't rewriting the same terms for every job."
            action={
              <Link
                href="/dashboard/contracts/templates/new"
                className="btn btn-primary btn-sm"
              >
                New template
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <Link
              key={template.id}
              href={`/dashboard/contracts/templates/${template.id}`}
              className="card card-lit card-hover block p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{template.name}</p>
                  <p className="faint mt-1 text-xs leading-relaxed">
                    {template.description || "No description"}
                  </p>
                </div>
                <Badge>
                  {CONTRACT_TYPE_LABELS[template.type as ContractTypeValue]}
                </Badge>
              </div>
              <div className="faint mt-4 flex items-center gap-3 text-xs">
                <span>
                  {template._count.contracts} contract
                  {template._count.contracts === 1 ? "" : "s"} generated
                </span>
                <span>·</span>
                <span>Updated {formatDate(template.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
