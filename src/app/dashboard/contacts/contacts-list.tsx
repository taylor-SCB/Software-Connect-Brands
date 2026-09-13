import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import {
  IconPlus,
  IconUsers,
  IconNote,
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
  IconGlobe,
} from "@/components/icons";
import { ACTIVITY_TYPES, INDIVIDUAL_COMPANY_TYPE, type ActivityTypeValue } from "@/lib/constants";
import { parseListParams, listHref, pageWindow, type ListLock } from "@/lib/list-params";
import { contactWhere, companyIdsMatching, getFilterOptions, namesForCompanies } from "@/lib/list-query";
import { ListFilters } from "@/components/list-filters";
import { Pagination } from "@/components/pagination";
import { StarButton } from "@/components/star-button";
import { ImportCsvButton } from "@/components/import-csv-button";
import { setContactFavorite } from "./actions";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

const ACTIVITY_TITLES = {
  TEXT: "Texts logged",
  EMAIL: "Emails logged",
  PHONE_CALL: "Phone calls logged",
  MEETING: "Meetings logged",
} as const;

// The Contacts table, shared by /contacts, /contacts/favorites and
// /contacts/with-deals: one page of rows at a time, filtered and searched
// in the database, so it is the same speed at fifty contacts or two
// hundred thousand.
export async function ContactsList({
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
  const where = contactWhere(organizationId, params, await companyIdsMatching(organizationId, params.q));

  const [total, options, selectedCompanies, unfiltered] = await Promise.all([
    prisma.contact.count({ where }),
    getFilterOptions(organizationId),
    namesForCompanies(organizationId, params.companies),
    totalInWorkspace(organizationId, lock),
  ]);
  const window = pageWindow(total, params.per, params.page);

  const contacts = await prisma.contact.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: window.skip,
    take: params.per,
    include: {
      _count: { select: { notes: true, deals: true } },
      company: { select: { id: true, name: true, industries: true, companyTypes: true } },
    },
  });

  // Activity counts for just the rows on this page.
  const activityCounts = contacts.length
    ? await prisma.activity.groupBy({
        by: ["contactId", "type"],
        where: { organizationId, contactId: { in: contacts.map((contact) => contact.id) } },
        _count: { _all: true },
      })
    : [];
  const counts = new Map<string, Partial<Record<ActivityTypeValue, number>>>();
  for (const row of activityCounts) {
    if (!row.contactId) continue;
    const existing = counts.get(row.contactId) ?? {};
    existing[row.type as ActivityTypeValue] = row._count._all;
    counts.set(row.contactId, existing);
  }

  const filtered = Boolean(params.q) || total !== unfiltered;

  return (
    <div>
      <PageHeader
        eyebrow="Relationships"
        title={title}
        subtitle={subtitle ?? `${total.toLocaleString()} ${total === 1 ? "record" : "records"}${params.q ? ` matching “${params.q}”` : ""}`}
        actions={
          <>
            <ImportCsvButton kind="contacts" />
            <Link href="/dashboard/contacts/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              Add contact
            </Link>
          </>
        }
      />

      <ListFilters
        basePath={basePath}
        params={params}
        lock={lock}
        options={options}
        kind="contacts"
        selectedCompanies={selectedCompanies}
        placeholder="Search contacts…"
      />

      <Card lit>
        {contacts.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={20} />}
            title={filtered ? "No contacts match" : lock.fav ? "No favorite contacts yet" : lock.deals ? "No contacts with deals yet" : "No contacts yet"}
            body={
              filtered
                ? "Try a different search, or clear a filter."
                : lock.fav
                  ? "Click the star on any contact and they show up here."
                  : lock.deals
                    ? "A contact appears here once a deal or quote carries their name."
                    : "Add your first customer or lead to start tracking notes, quotes and contracts, or import a spreadsheet."
            }
            action={
              !filtered &&
              !lock.fav &&
              !lock.deals && (
                <Link href="/dashboard/contacts/new" className="btn btn-primary btn-sm">
                  <IconPlus size={14} />
                  Add contact
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
                  <th>Contact</th>
                  <th>Industry · Type</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Location</th>
                  <th>Notes</th>
                  <th>Activity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const activity = counts.get(contact.id) ?? {};
                  const location = [contact.city, contact.state].filter(Boolean).join(", ");
                  return (
                    <tr key={contact.id} data-testid="contact-row">
                      <td className="pr-0">
                        <StarButton id={contact.id} favorite={contact.favorite} action={setContactFavorite} label={contact.name} />
                      </td>
                      <td className="font-medium">
                        {contact.company ? (
                          <Link href={`/dashboard/companies/${contact.company.id}`} className="hover:underline">
                            {contact.company.name}
                          </Link>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        <Link href={`/dashboard/contacts/${contact.id}`} className="link">
                          {contact.name}
                        </Link>
                        {contact.title && <p className="faint text-xs">{contact.title}</p>}
                        {contact._count.deals > 0 && (
                          <p className="faint text-[0.68rem]">
                            {contact._count.deals} {contact._count.deals === 1 ? "deal" : "deals"}
                          </p>
                        )}
                      </td>
                      <td className="text-xs">
                        <TagCell
                          industries={contact.company?.industries ?? []}
                          types={contact.company ? contact.company.companyTypes : [INDIVIDUAL_COMPANY_TYPE]}
                        />
                      </td>
                      <td className="muted">
                        {contact.email ? (
                          <a href={`mailto:${contact.email}`} className="hover:underline">
                            {contact.email}
                          </a>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="muted num">
                        {contact.phone ? (
                          <a href={`tel:${contact.phone}`} className="hover:underline">
                            {contact.phone}
                          </a>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="muted">
                        {location || <span className="faint">—</span>}
                        {contact.website && (
                          <a
                            href={contact.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="faint ml-1 inline-flex items-center align-middle hover:underline"
                            title={contact.website}
                          >
                            <IconGlobe size={12} />
                          </a>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/dashboard/contacts/${contact.id}#notes`}
                          className="btn btn-ghost btn-sm"
                          title={`${contact._count.notes} notes`}
                        >
                          <IconNote size={13} />
                          {contact._count.notes}
                        </Link>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          {ACTIVITY_TYPES.map((type) => {
                            const Icon = ACTIVITY_ICONS[type];
                            const count = activity[type] ?? 0;
                            return (
                              <Link
                                key={type}
                                href={`/dashboard/contacts/${contact.id}#activity`}
                                title={`${count} ${ACTIVITY_TITLES[type]}`}
                                className={`num inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] transition-colors ${
                                  count > 0
                                    ? "border-[var(--border-strong)] text-[var(--text)]"
                                    : "border-[var(--border)] text-[var(--text-faint)]"
                                } hover:border-[var(--brand)]`}
                              >
                                <Icon size={12} />
                                {count}
                              </Link>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={contact.status} />
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
          noun="contacts"
        />
      </Card>
    </div>
  );
}

// Only used to tell "the workspace is empty" from "the filters hide
// everything", so the empty state can say the right thing.
async function totalInWorkspace(organizationId: string, lock: ListLock) {
  return prisma.contact.count({
    where: { organizationId, ...(lock.fav ? { favorite: true } : {}), ...(lock.deals ? { deals: { some: {} } } : {}) },
  });
}

export function TagCell({ industries, types }: { industries: string[]; types: string[] }) {
  if (industries.length === 0 && types.length === 0) return <span className="faint">—</span>;
  return (
    <div className="flex max-w-[16rem] flex-wrap gap-1">
      {industries.map((industry) => (
        <span key={`i-${industry}`} className="badge border-[var(--border-strong)]">
          {industry}
        </span>
      ))}
      {types.map((type) => (
        <span key={`t-${type}`} className="badge border-[var(--border)] text-[var(--text-faint)]">
          {type}
        </span>
      ))}
    </div>
  );
}
