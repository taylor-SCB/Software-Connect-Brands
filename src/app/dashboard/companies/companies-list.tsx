import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { locationLabel } from "@/lib/companies";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { OPEN_DEAL_STAGES } from "@/lib/constants";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import { IconPlus, IconBuilding, IconGlobe, IconUsers } from "@/components/icons";
import { parseListParams, listHref, pageWindow, type ListLock } from "@/lib/list-params";
import { companyWhere, getFilterOptions } from "@/lib/list-query";
import { ListFilters } from "@/components/list-filters";
import { Pagination } from "@/components/pagination";
import { StarButton } from "@/components/star-button";
import { ImportCsvButton } from "@/components/import-csv-button";
import { TagCell } from "../contacts/contacts-list";
import { setCompanyFavorite } from "./actions";

// The Companies table, shared by /companies, /companies/favorites and
// /companies/with-deals. See ContactsList for the shape.
export async function CompaniesList({
  searchParams,
  basePath,
  lock = {},
  title,
  subtitle,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
  lock?: ListLock;
  title: string;
  subtitle?: string;
}) {
  const { organizationId } = await requireSession();
  const params = parseListParams(searchParams, lock);
  const where = companyWhere(organizationId, params);

  const [total, options, unfiltered] = await Promise.all([
    prisma.company.count({ where }),
    getFilterOptions(organizationId),
    prisma.company.count({
      where: {
        organizationId,
        ...(lock.fav ? { favorite: true } : {}),
        ...(lock.deals ? { contacts: { some: { deals: { some: {} } } } } : {}),
      },
    }),
  ]);
  const window = pageWindow(total, params.per, params.page);

  const companies = await prisma.company.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: window.skip,
    take: params.per,
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
  const filtered = Boolean(params.q) || total !== unfiltered;

  return (
    <div>
      <PageHeader
        eyebrow="Relationships"
        title={title}
        subtitle={subtitle ?? `${total.toLocaleString()} ${total === 1 ? "record" : "records"}${params.q ? ` matching “${params.q}”` : ""}`}
        actions={
          <>
            <ImportCsvButton kind="companies" />
            <Link href="/dashboard/companies/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              Add company
            </Link>
          </>
        }
      />

      <ListFilters
        basePath={basePath}
        params={params}
        lock={lock}
        options={options}
        kind="companies"
        placeholder="Search companies…"
      />

      <Card lit>
        {companies.length === 0 ? (
          <EmptyState
            icon={<IconBuilding size={20} />}
            title={filtered ? "No companies match" : lock.fav ? "No favorite companies yet" : lock.deals ? "No companies with deals yet" : "No companies yet"}
            body={
              filtered
                ? "Try a different search, or clear a filter."
                : lock.fav
                  ? "Click the star on any company and it shows up here."
                  : lock.deals
                    ? "A company appears here once one of its people has a deal or quote."
                    : "A company is a business you sell to. Add one here, type a company name on any contact, or import a spreadsheet."
            }
            action={
              !filtered &&
              !lock.fav &&
              !lock.deals && (
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
                  <th className="w-8"></th>
                  <th>Company</th>
                  <th>Industry · Type</th>
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
                    <tr key={company.id} data-testid="company-row">
                      <td className="pr-0">
                        <StarButton id={company.id} favorite={company.favorite} action={setCompanyFavorite} label={company.name} />
                      </td>
                      <td className="font-medium">
                        <Link href={`/dashboard/companies/${company.id}`} className="link">
                          {company.name}
                        </Link>
                      </td>
                      <td className="text-xs">
                        <TagCell industries={company.industries} types={company.companyTypes} />
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
        <Pagination
          total={total}
          from={window.from}
          to={window.to}
          page={window.current}
          pages={window.pages}
          hrefFor={(page) => listHref(basePath, params, { page }, lock)}
          noun="companies"
        />
      </Card>
    </div>
  );
}
