import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatDate, formatCents } from "@/lib/format";
import { contractTotalCents } from "@/lib/contracts";
import { PageHeader, Card, EmptyState, StatusBadge, Badge } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { IconPlus, IconSignature, IconFileText, IconClock } from "@/components/icons";

export default async function ContractsPage() {
  const { organizationId } = await requireSession();

  const timeZone = await getTimeZone();

  const [contracts, templateCount] = await Promise.all([
    prisma.contract.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        contact: { select: { id: true, name: true, company: { select: { name: true, logoUrl: true } } } },
        company: { select: { id: true, name: true, logoUrl: true } },
        lineItems: { select: { quantity: true, unitPriceCents: true } },
      },
    }),
    prisma.contractTemplate.count({ where: { organizationId } }),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Agreements"
        title="Contracts"
        subtitle={`${templateCount} ${templateCount === 1 ? "template" : "templates"} available`}
        actions={
          <>
            <Link
              href="/dashboard/contracts/templates"
              className="btn btn-ghost btn-sm"
            >
              <IconFileText size={13} />
              Templates
            </Link>
            <Link href="/dashboard/contracts/tracker" className="btn btn-ghost btn-sm">
              <IconClock size={13} />
              Deal Tracker
            </Link>
            <Link href="/dashboard/contracts/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              New contract
            </Link>
          </>
        }
      />

      <Card lit>
        {contracts.length === 0 ? (
          <EmptyState
            icon={<IconSignature size={20} />}
            title="No contracts yet"
            body="Generate one from a template — your Service Agreement and Change Order are ready to go — then send it for signature."
            action={
              <Link href="/dashboard/contracts/new" className="btn btn-primary btn-sm">
                <IconPlus size={14} />
                New contract
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>To</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="text-right">Total</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((contract) => (
                  <tr key={contract.id}>
                    <td className="num faint text-xs">CON-{contract.number}</td>
                    <td>
                      <Link
                        href={`/dashboard/contracts/${contract.id}`}
                        className="font-medium hover:underline"
                      >
                        {contract.title}
                      </Link>
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <Avatar
                          url={(contract.company ?? contract.contact.company)?.logoUrl}
                          name={(contract.company ?? contract.contact.company)?.name ?? contract.contact.name}
                          size={22}
                        />
                        <Link
                          href={`/dashboard/contacts/${contract.contact.id}`}
                          className="link"
                        >
                          {(contract.company ?? contract.contact.company)?.name || contract.contact.name}
                        </Link>
                      </span>
                    </td>
                    <td>
                      <Badge>{contract.type}</Badge>
                    </td>
                    <td>
                      <StatusBadge status={contract.status} />
                    </td>
                    <td className="num text-right">
                      {contract.lineItems.length ? formatCents(contractTotalCents(contract.lineItems)) : <span className="faint">—</span>}
                    </td>
                    <td className="faint text-xs">{formatDate(contract.createdAt, timeZone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
