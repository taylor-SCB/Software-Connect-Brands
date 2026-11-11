import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDate } from "@/lib/format";
import { locationLabel } from "@/lib/companies";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { OPEN_DEAL_STAGES } from "@/lib/constants";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import { IconPlus, IconBuilding, IconGlobe, IconUsers } from "@/components/icons";
import { parseListParams, listHref, pageWindow, PRESET_LABELS, type ListLock } from "@/lib/list-params";
import { companyWhere, getFilterOptions, pageIds as listPageIds } from "@/lib/list-query";
import { resolveListView } from "@/lib/list-prefs";
import { ListFilters } from "@/components/list-filters";
import { Pagination } from "@/components/pagination";
import { StarButton } from "@/components/star-button";
import { AutoPill } from "@/components/auto-pill";
import { todayIso } from "@/lib/payments";
import { owedBy } from "@/lib/money";
import { OwesLine } from "@/components/owes-line";
import { TagCell } from "../contacts/contacts-list";
import { marketingCompanies } from "@/lib/last-contacted";
import { MarketingCell, RepCell } from "@/components/crm-cells";
import { BulkAssign, CardCheck, PageCheck, RowCheck, SelectToggle } from "@/components/bulk-assign";
import { loadRepChoices } from "@/lib/reps";
import { loadLeadLabelChoices } from "@/lib/crm-labels";
import { healthSettings, loadCompanyHealth, loadContactHealth } from "@/lib/health-load";
import { warmth } from "@/lib/health";
import { CardActions, CardTitle, NextStepCell, PhoneLink, PulseCell, bestPhone, lastTouchText } from "@/components/list-cells";
import { CleanUpMenu, ListLogProvider, LogButton, RowExpand } from "@/components/list-parts";
import { LifecycleMeter } from "@/components/lifecycle-meter";
import { setCompanyFavorite } from "./actions";

// The Companies list, shared by /companies, /companies/favorites,
// /companies/with-deals and /companies/interested. See ContactsList for
// the shape. BDR redesign (Nov 11, 2026): Company (pinned; "City ·
// Industry" and what it owes), Pulse, Reached ("2 of 7 talked to"), Last
// touch ("3d · Marcus"), Next step and Rep; Phone, Website, Industry ·
// Type, People, Marketing, Open pipeline, Status and Added come back from
// Columns. A row opens to its top three people with their meters and Call,
// a call list without leaving the list.
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
  const { organizationId, userId, role } = await requireSession();
  const view = await resolveListView("companies", searchParams, parseListParams(searchParams, lock), { userId, role }, lock);
  const { params, columns } = view;
  const show = new Set(columns);
  const where = await companyWhere(organizationId, params);

  const [total, options, settings, unfiltered, reps, leadLabels] = await Promise.all([
    prisma.company.count({ where }),
    getFilterOptions(organizationId),
    healthSettings(organizationId),
    prisma.company.count({
      where: {
        organizationId,
        ...(lock.fav ? { favorite: true } : {}),
        ...(lock.deals ? { contacts: { some: { deals: { some: {} } } } } : {}),
        ...(lock.interested ? { status: "INTERESTED" as const } : {}),
      },
    }),
    loadRepChoices(organizationId),
    loadLeadLabelChoices(organizationId),
  ]);
  const timeZone = settings.timeZone;
  const window = pageWindow(total, params.per, params.page);

  const ids = await listPageIds("companies", organizationId, where, params, window);
  const found = await prisma.company.findMany({
    where: { organizationId, id: { in: ids } },
    include: {
      _count: { select: { contacts: true } },
      owner: { select: { name: true, removedAt: true } },
      ...(show.has("pipeline")
        ? {
            contacts: {
              select: {
                deals: {
                  where: { stage: { in: [...OPEN_DEAL_STAGES] } },
                  select: { valueCents: true, quotes: QUOTES_FOR_VALUE },
                },
              },
            },
          }
        : {}),
    },
  });
  const byId = new Map(found.map((company) => [company.id, company]));
  const companies = ids.map((id) => byId.get(id)).filter((company): company is (typeof found)[number] => Boolean(company));

  // Health, what's owed, marketing (when shown) and each company's top
  // three people, for just this page, in a handful of grouped statements.
  const pageIds = companies.map((company) => company.id);
  const [health, owed, marketing, top] = await Promise.all([
    loadCompanyHealth(organizationId, pageIds, { settings }),
    owedBy(organizationId, "company", pageIds, todayIso(timeZone)),
    show.has("marketing") ? marketingCompanies(organizationId, pageIds) : Promise.resolve(new Map()),
    topPeople(organizationId, pageIds),
  ]);
  const peopleHealth = await loadContactHealth(organizationId, top.people.map((person) => person.id), { settings });
  const filtered = Boolean(params.q) || total !== unfiltered;
  const showRep = params.scope !== "mine";
  const repName = (owner: { name: string; removedAt: Date | null } | null) =>
    owner ? (owner.removedAt ? `${owner.name} (removed)` : owner.name) : null;
  const presetName = params.preset ? PRESET_LABELS.companies[params.preset] : null;
  const columnCount = 6 + (showRep ? 1 : 0) + columns.length;

  const peopleOf = (companyId: string) =>
    top.people
      .filter((person) => person.companyId === companyId)
      .sort((a, b) => warmthOf(peopleHealth.get(b.id)) - warmthOf(peopleHealth.get(a.id)));

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Relationships"
        title={title}
        subtitle={
          subtitle ??
          `${total.toLocaleString()} ${total === 1 ? "record" : "records"}${params.q ? ` matching “${params.q}”` : ""}${presetName ? ` · ${presetName}` : ""}`
        }
        actions={
          <>
            <CleanUpMenu kind="companies" reps={reps} />
            <Link href="/dashboard/companies/new" className="btn btn-primary btn-sm min-h-[44px] md:min-h-0">
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
        reps={reps}
        leadLabels={leadLabels}
        total={total}
        columns={columns}
      />

      <ListLogProvider>
        <BulkAssign
          kind="companies"
          pageIds={pageIds}
          total={total}
          query={listHref("", params).replace(/^\?/, "")}
          interested={Boolean(lock.interested)}
          reps={reps}
        >
          <Card lit>
            {companies.length === 0 ? (
              <EmptyState
                icon={<IconBuilding size={20} />}
                title={
                  filtered || params.scope !== "all" || params.preset
                    ? "No companies match"
                    : lock.fav
                      ? "No favorite companies yet"
                      : lock.deals
                        ? "No companies with deals yet"
                        : lock.interested
                          ? "No company marked Interested yet"
                          : "No companies yet"
                }
                body={
                  params.scope === "mine" && !filtered
                    ? "No company here is yours yet. Switch to Everyone or Unowned, and assign companies to yourself from there."
                    : filtered || params.scope !== "all" || params.preset
                      ? "Try a different search, or clear a filter."
                      : lock.fav
                        ? "Click the star on any company and it shows up here."
                        : lock.interested
                          ? "Set a company's status to Interested from its page and it shows up here."
                          : lock.deals
                            ? "A company appears here once one of its people has a deal or quote."
                            : "A company is a business you sell to. Add one here, type a company name on any contact, or import a spreadsheet."
                }
                action={
                  !filtered &&
                  params.scope === "all" &&
                  !params.preset &&
                  !lock.fav &&
                  !lock.deals &&
                  !lock.interested && (
                    <Link href="/dashboard/companies/new" className="btn btn-primary btn-sm">
                      <IconPlus size={14} />
                      Add company
                    </Link>
                  )
                }
              />
            ) : (
              <>
                {/* Phone: a card list. */}
                <div className="md:hidden">
                  <div className="mb-2 flex justify-end">
                    <SelectToggle />
                  </div>
                  <ul className="divide-y divide-[var(--hairline-3)]">
                    {companies.map((company) => {
                      const h = health.get(company.id);
                      const touch = lastTouchText(h);
                      const line = [company.city, `${company._count.contacts} ${company._count.contacts === 1 ? "person" : "people"}`].filter(Boolean).join(" · ");
                      return (
                        <li key={company.id} className="flex gap-3 py-3" data-testid="company-card">
                          <CardCheck id={company.id} label={company.name} />
                          <div className="min-w-0 flex-1">
                            <CardTitle href={`/dashboard/companies/${company.id}`} name={company.name} health={h} />
                            <p className="muted truncate text-sm">{line}</p>
                            {h && (
                              <div className="mt-1 flex items-center gap-2">
                                <LifecycleMeter health={h} size="mini" showCaption={false} />
                              </div>
                            )}
                            <p className="faint text-xs">{touch ? `Last touch ${touch}` : "No touches yet"}</p>
                            <CardActions number={company.phone} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Desktop: the table. */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th className="w-8 whitespace-nowrap">
                          <PageCheck />
                        </th>
                        <th className={STICKY}>Company</th>
                        <th>Pulse</th>
                        <th>Reached</th>
                        <th>Last touch</th>
                        <th>Next step</th>
                        {showRep && <th>Rep</th>}
                        {show.has("phone") && <th>Phone</th>}
                        {show.has("website") && <th>Website</th>}
                        {show.has("industry") && <th>Industry · Type</th>}
                        {show.has("people") && <th>People</th>}
                        {show.has("marketing") && <th>Marketing</th>}
                        {show.has("pipeline") && <th className="text-right">Open pipeline</th>}
                        {show.has("status") && <th>Status</th>}
                        {show.has("added") && <th>Added</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {companies.map((company) => {
                        const h = health.get(company.id);
                        const location = locationLabel(company);
                        const sub = [company.city || location, company.industries[0]].filter(Boolean).join(" · ");
                        const people = peopleOf(company.id);
                        const expandId = `people-${company.id}`;
                        const open =
                          "contacts" in company
                            ? (company.contacts as unknown as { deals: Parameters<typeof dealValueCents>[0][] }[])
                                .flatMap((contact) => contact.deals)
                                .reduce((sum, deal) => sum + dealValueCents(deal), 0)
                            : 0;
                        return [
                          <tr key={company.id} data-testid="company-row">
                            <td className="whitespace-nowrap pr-0">
                              <RowCheck id={company.id} label={company.name} />
                              <StarButton id={company.id} favorite={company.favorite} action={setCompanyFavorite} label={company.name} />
                              {people.length > 0 && <RowExpand target={expandId} label={company.name} />}
                            </td>
                            <td className={`${STICKY} min-w-[12rem] max-w-[18rem]`}>
                              <Link href={`/dashboard/companies/${company.id}`} className="link font-semibold">
                                {company.name}
                              </Link>
                              {sub && <p className="faint truncate text-xs">{sub}</p>}
                              <OwesLine balance={owed.get(company.id)} timeZone={timeZone} />
                            </td>
                            <td>
                              <PulseCell health={h} repId={company.ownerId} />
                            </td>
                            <td className="whitespace-nowrap text-xs" data-testid="reached">
                              {h ? `${h.reached} of ${h.people} talked to` : "—"}
                            </td>
                            <td className="whitespace-nowrap text-xs" data-testid="last-touch">
                              {lastTouchText(h) ?? <span className="faint">Not yet</span>}
                            </td>
                            <td>
                              <NextStepCell health={h} />
                            </td>
                            {showRep && (
                              <td>
                                <RepCell name={repName(company.owner)} />
                              </td>
                            )}
                            {show.has("phone") && (
                              <td className="muted" data-testid="company-row-phone">
                                {company.phone ? <PhoneLink number={company.phone} /> : <span className="faint">—</span>}
                                <AutoPill field="phone" autoFilled={company.autoFilled} enrichedAt={company.enrichedAt} timeZone={timeZone} />
                              </td>
                            )}
                            {show.has("website") && (
                              <td className="muted">
                                {company.website ? (
                                  <a href={company.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                                    <IconGlobe size={13} />
                                    {company.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                                  </a>
                                ) : (
                                  <span className="faint">—</span>
                                )}
                                <AutoPill field="website" autoFilled={company.autoFilled} enrichedAt={company.enrichedAt} timeZone={timeZone} />
                              </td>
                            )}
                            {show.has("industry") && (
                              <td className="text-xs">
                                <div className="flex flex-wrap items-center gap-1">
                                  <TagCell industries={company.industries} types={company.companyTypes} />
                                  <AutoPill field="industries" autoFilled={company.autoFilled} enrichedAt={company.enrichedAt} timeZone={timeZone} />
                                </div>
                              </td>
                            )}
                            {show.has("people") && (
                              <td>
                                <Link href={`/dashboard/companies/${company.id}#people`} className="btn btn-ghost btn-sm" title={`${company._count.contacts} people`}>
                                  <IconUsers size={13} />
                                  {company._count.contacts}
                                </Link>
                              </td>
                            )}
                            {show.has("marketing") && (
                              <td>
                                <MarketingCell tally={marketing.get(company.id)} timeZone={timeZone} />
                              </td>
                            )}
                            {show.has("pipeline") && (
                              <td className="num text-right">{open > 0 ? <span className="font-medium">{formatCents(open)}</span> : <span className="faint">—</span>}</td>
                            )}
                            {show.has("status") && (
                              <td>
                                <StatusBadge status={company.status} />
                              </td>
                            )}
                            {show.has("added") && <td className="faint whitespace-nowrap text-xs">{formatDate(company.createdAt, timeZone)}</td>}
                          </tr>,
                          people.length > 0 && (
                            <tr key={`${company.id}-people`} id={expandId} hidden data-testid="company-people">
                              <td />
                              <td colSpan={columnCount - 1} className="!pt-0">
                                <ul className="space-y-1.5">
                                  {people.map((person) => {
                                    const ph = peopleHealth.get(person.id);
                                    const best = bestPhone(person);
                                    return (
                                      <li key={person.id} className="flex flex-wrap items-center gap-3 text-sm" data-testid="company-person">
                                        <Link href={`/dashboard/contacts/${person.id}`} className="link w-48 min-w-0 truncate">
                                          {person.name}
                                          {person.title && <span className="faint text-xs"> · {person.title}</span>}
                                        </Link>
                                        {ph && <PulseCell health={ph} repId={person.ownerId} />}
                                        {best ? (
                                          <PhoneLink number={best.number} contactId={person.id} testId="person-call" />
                                        ) : (
                                          <span className="faint text-xs">No number</span>
                                        )}
                                        <LogButton contactId={person.id} name={person.name} />
                                      </li>
                                    );
                                  })}
                                </ul>
                              </td>
                            </tr>
                          ),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              </>
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
        </BulkAssign>
      </ListLogProvider>
    </div>
  );
}

// The pinned first column: an opaque background (the card's look over the
// page), so the columns scrolling under it don't read through.
const STICKY = "sticky left-0 z-[1] [background:linear-gradient(var(--surface),var(--surface)),var(--bg)]";

function warmthOf(health: Parameters<typeof warmth>[0] | undefined) {
  return health ? warmth(health) : -1;
}

// Each company's three most recently reached (then touched) people, in one
// statement.
async function topPeople(organizationId: string, companyIds: string[]) {
  if (companyIds.length === 0) return { people: [] };
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM (
      SELECT c.id, ROW_NUMBER() OVER (
               PARTITION BY c."companyId"
               ORDER BY c."lastConnectAt" DESC NULLS LAST, c."lastTouchAt" DESC NULLS LAST, c."createdAt", c.id
             ) AS rn
        FROM "Contact" c
       WHERE c."organizationId" = ${organizationId} AND c."companyId" = ANY(${companyIds})
    ) x WHERE rn <= 3`);
  const people = rows.length
    ? await prisma.contact.findMany({
        where: { organizationId, id: { in: rows.map((row) => row.id) } },
        select: { id: true, name: true, title: true, companyId: true, ownerId: true, mobile: true, phone: true, phone2: true },
      })
    : [];
  return { people };
}
