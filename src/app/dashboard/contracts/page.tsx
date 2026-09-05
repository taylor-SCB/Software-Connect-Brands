import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { PageHeader, Card, EmptyState, StatusBadge, Badge } from "@/components/ui";
import { IconPlus, IconSignature, IconFileText } from "@/components/icons";
import { CONTRACT_TYPE_LABELS, type ContractTypeValue } from "@/lib/constants";

export default async function ContractsPage() {
  const { organizationId } = await requireSession();

  const [contracts, templateCount] = await Promise.all([
    prisma.contract.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { contact: { select: { id: true, name: true, company: true } } },
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
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Status</th>
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
                      <Link
                        href={`/dashboard/contacts/${contract.contact.id}`}
                        className="link"
                      >
                        {contract.contact.company || contract.contact.name}
                      </Link>
                    </td>
                    <td>
                      <Badge>
                        {CONTRACT_TYPE_LABELS[contract.type as ContractTypeValue]}
                      </Badge>
                    </td>
                    <td>
                      <StatusBadge status={contract.status} />
                    </td>
                    <td className="faint text-xs">{formatDate(contract.createdAt)}</td>
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
