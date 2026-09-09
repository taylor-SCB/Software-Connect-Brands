import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { locationLabel } from "@/lib/companies";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { OPEN_DEAL_STAGES } from "@/lib/constants";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import { IconPlus, IconBuilding, IconSearch, IconGlobe, IconUsers } from "@/components/icons";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { organizationId } = await requireSession();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const companies = await prisma.company.findMany({
    where: {
      organizationId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { city: { contains: query, mode: "insensitive" } },
              { state: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { contacts: true } },
      contacts: {
        select: {
          deals: {
            where: { stage: { in: [...OPEN_DEAL_STAGES] } },
            select: { valueCents: true, quotes: QUOTES_FOR_VALUE },
          },
        },
      },
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Relationships"
        title="Companies"
        subtitle={`${companies.length} ${companies.length === 1 ? "record" : "records"}${query ? ` matching “${query}”` : ""}`}
        actions={
          <>
            <form method="get" className="relative">
              <IconSearch
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
              />
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Search companies…"
                aria-label="Search companies"
                className="input input-sm w-52 pl-8"
              />
            </form>
            <Link href="/dashboard/companies/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              Add company
            </Link>
          </>
        }
      />

      <Card lit>
        {companies.length === 0 ? (
          <EmptyState
            icon={<IconBuilding size={20} />}
            title={query ? "No companies match that search" : "No companies yet"}
            body={
              query
                ? "Try a different name, city or state."
                : "A company is a business you sell to. Add one here, or type a company name on any contact and it appears automatically."
            }
            action={
              !query && (
                <Link href="/dashboard/companies/new" className="btn btn-primary btn-sm">
                  <IconPlus size={14} />
                  Add company
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Phone</th>
                  <th>Website</th>
                  <th>People</th>
                  <th className="text-right">Open pipeline</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => {
                  const openDeals = company.contacts.flatMap((contact) => contact.deals);
                  const open = openDeals.reduce((sum, deal) => sum + dealValueCents(deal), 0);
                  const location = locationLabel(company);
                  return (
                    <tr key={company.id}>
                      <td className="font-medium">
                        <Link href={`/dashboard/companies/${company.id}`} className="link">
                          {company.name}
                        </Link>
                      </td>
                      <td className="muted">{location || <span className="faint">—</span>}</td>
                      <td className="muted num">
                        {company.phone ? (
                          <a href={`tel:${company.phone}`} className="hover:underline">
                            {company.phone}
                          </a>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="muted">
                        {company.website ? (
                          <a
                            href={company.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            <IconGlobe size={13} />
                            {company.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </a>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/dashboard/companies/${company.id}#people`}
                          className="btn btn-ghost btn-sm"
                          title={`${company._count.contacts} people`}
                        >
                          <IconUsers size={13} />
                          {company._count.contacts}
                        </Link>
                      </td>
                      <td className="num text-right">
                        {open > 0 ? (
                          <span className="font-medium">{formatCents(open)}</span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={company.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
