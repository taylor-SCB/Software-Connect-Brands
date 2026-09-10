import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatDate } from "@/lib/format";
import { PageHeader, Card, EmptyState, Badge, BackLink } from "@/components/ui";
import { IconPlus, IconFileText } from "@/components/icons";

export default async function TemplatesPage() {
  const { organizationId } = await requireSession();

  const timeZone = await getTimeZone();

  const templates = await prisma.contractTemplate.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { contracts: true } } },
  });

  // Names for "Only Alice can send" on a restricted template's card.
  const senderIds = [...new Set(templates.flatMap((template) => template.senderUserIds))];
  const senders = senderIds.length
    ? await prisma.user.findMany({
        where: { organizationId, id: { in: senderIds } },
        select: { id: true, name: true },
      })
    : [];
  const senderName = new Map(senders.map((user) => [user.id, user.name]));

  return (
    <div>
      <BackLink href="/dashboard/contracts" label="Contracts" />
      <PageHeader
        eyebrow="Agreements"
        title="Contract templates"
        subtitle="Reusable wording with fields that fill in each customer's details. Open one to edit it or generate a contract from it."
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
                <Badge>{template.type}</Badge>
              </div>
              <div className="faint mt-4 flex items-center gap-3 text-xs">
                <span>
                  {template._count.contracts} contract
                  {template._count.contracts === 1 ? "" : "s"} generated
                </span>
                <span>·</span>
                <span>Updated {formatDate(template.updatedAt, timeZone)}</span>
                <span>·</span>
                <span>
                  {template.allUsersCanSend
                    ? "Anyone can send"
                    : `Only ${template.senderUserIds
                        .map((id) => senderName.get(id))
                        .filter(Boolean)
                        .join(", ") || "nobody"} can send`}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
