import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, EmptyState, StatusBadge } from "@/components/ui";
import { IconPlus, IconUsers, IconNote, IconGlobe } from "@/components/icons";
import { INDIVIDUAL_COMPANY_TYPE } from "@/lib/constants";
import { parseListParams, listHref, pageWindow, PRESET_LABELS, type ListLock } from "@/lib/list-params";
import { contactWhere, companyIdsMatching, getFilterOptions, namesForCompanies, pageIds as listPageIds } from "@/lib/list-query";
import { resolveListView } from "@/lib/list-prefs";
import { ListFilters } from "@/components/list-filters";
import { Pagination } from "@/components/pagination";
import { StarButton } from "@/components/star-button";
import { EmailButton } from "@/components/email-composer";
import { AutoPill } from "@/components/auto-pill";
import { todayIso } from "@/lib/payments";
import { owedBy } from "@/lib/money";
import { OwesLine } from "@/components/owes-line";
import { marketingContacts } from "@/lib/last-contacted";
import { MarketingCell, RepCell } from "@/components/crm-cells";
import { BulkAssign, CardCheck, PageCheck, RowCheck } from "@/components/bulk-assign";
import { loadRepChoices } from "@/lib/reps";
import { loadLeadLabelChoices } from "@/lib/crm-labels";
import { healthSettings, loadContactHealth } from "@/lib/health-load";
import { formatDate } from "@/lib/format";
import { CardActions, CardTitle, NextStepCell, PhoneLink, PulseCell, bestPhone, cardCaption, otherPhones } from "@/components/list-cells";
import { CleanUpMenu, ListLogProvider, LogButton } from "@/components/list-parts";
import { LifecycleMeter } from "@/components/lifecycle-meter";
import { setContactFavorite } from "./actions";

// The Contacts list, shared by /contacts, /contacts/favorites,
// /contacts/with-deals and /contacts/interested: one page of rows at a
// time, filtered and searched in the database, so it is the same speed at
// fifty contacts or two hundred thousand.
//
// BDR redesign (Nov 11, 2026): it reads like a call list. Six columns by
// default — the tick and star, the person (pinned while the table scrolls
// sideways), Pulse (the mini meter and "4 tries · 1 talk · 6d"), Next step,
// the best number to call, and the Rep (left off on Mine, where it's
// always you). Everything the old fourteen columns showed is one tap away
// in Columns, and the Status, Activity, Last Contacted By and Notes columns
// are folded into Pulse. Below 768px it is a card list with 44px Call ·
// Text · Log.
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
  const { organizationId, userId, role } = await requireSession();
  // The Auto-filled toggle is a companies-only filter; a pasted ?auto=1
  // is dropped here so the bar never claims a filter this list lacks.
  const view = await resolveListView("contacts", searchParams, { ...parseListParams(searchParams, lock), auto: false }, { userId, role }, lock);
  const { params, columns } = view;
  const show = new Set(columns);
  const where = await contactWhere(organizationId, params, await companyIdsMatching(organizationId, params.q));

  const [total, options, selectedCompanies, unfiltered, settings, reps, leadLabels] = await Promise.all([
    prisma.contact.count({ where }),
    getFilterOptions(organizationId),
    namesForCompanies(organizationId, params.companies),
    totalInWorkspace(organizationId, lock),
    healthSettings(organizationId),
    loadRepChoices(organizationId),
    loadLeadLabelChoices(organizationId),
  ]);
  const timeZone = settings.timeZone;
  const window = pageWindow(total, params.per, params.page);

  const ids = await listPageIds("contacts", organizationId, where, params, window);
  const found = await prisma.contact.findMany({
    where: { organizationId, id: { in: ids } },
    include: {
      _count: { select: { notes: true, deals: true } },
      company: { select: { id: true, name: true, industries: true, companyTypes: true, autoFilled: true, enrichedAt: true } },
      owner: { select: { name: true, removedAt: true } },
      createdBy: { select: { name: true } },
    },
  });
  const byId = new Map(found.map((contact) => [contact.id, contact]));
  const contacts = ids.map((id) => byId.get(id)).filter((contact): contact is (typeof found)[number] => Boolean(contact));

  // Health, what's owed and (when shown) marketing, for just this page: a
  // few grouped statements, never one per row.
  const pageIds = contacts.map((contact) => contact.id);
  const [health, owed, marketing] = await Promise.all([
    loadContactHealth(organizationId, pageIds, { settings }),
    owedBy(organizationId, "contact", pageIds, todayIso(timeZone)),
    show.has("marketing") ? marketingContacts(organizationId, pageIds) : Promise.resolve(new Map()),
  ]);
  const filtered = Boolean(params.q) || total !== unfiltered;
  const showRep = params.scope !== "mine";
  const repName = (owner: { name: string; removedAt: Date | null } | null) =>
    owner ? (owner.removedAt ? `${owner.name} (removed)` : owner.name) : null;
  const presetName = params.preset ? PRESET_LABELS.contacts[params.preset] : null;

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
            <span className="hidden md:contents">
              <EmailButton />
            </span>
            <CleanUpMenu kind="contacts" reps={reps} />
            <Link href="/dashboard/contacts/new" className="btn btn-primary btn-sm min-h-[44px] md:min-h-0">
              <IconPlus size={14} />
              Add contact
            </Link>
          </>
        }
      />


      <ListLogProvider>
        <BulkAssign
          kind="contacts"
          pageIds={pageIds}
          total={total}
          query={listHref("", params).replace(/^\?/, "")}
          interested={Boolean(lock.interested)}
          reps={reps}
        >
          <ListFilters
            basePath={basePath}
            params={params}
            lock={lock}
            options={options}
            kind="contacts"
            selectedCompanies={selectedCompanies}
            placeholder="Search contacts…"
            reps={reps}
            leadLabels={leadLabels}
            total={total}
            columns={columns}
          />
          <Card lit>
            {contacts.length === 0 ? (
              <EmptyState
                icon={<IconUsers size={20} />}
                title={
                  filtered || params.scope !== "all" || params.preset
                    ? "No contacts match"
                    : lock.fav
                      ? "No favorite contacts yet"
                      : lock.deals
                        ? "No contacts with deals yet"
                        : lock.interested
                          ? "Nobody marked Interested yet"
                          : "No contacts yet"
                }
                body={
                  params.scope === "mine" && !filtered
                    ? "Nobody here is yours yet. Switch to Everyone or Unowned, and assign people to yourself from there."
                    : filtered || params.scope !== "all" || params.preset
                      ? "Try a different search, or clear a filter."
                      : lock.fav
                        ? "Click the star on any contact and they show up here."
                        : lock.interested
                          ? "Set someone's status to Interested from their page and they show up here."
                          : lock.deals
                            ? "A contact appears here once a deal or quote carries their name."
                            : "Add your first customer or lead to start tracking notes, quotes and contracts, or import a spreadsheet."
                }
                action={
                  !filtered &&
                  params.scope === "all" &&
                  !params.preset &&
                  !lock.fav &&
                  !lock.deals &&
                  !lock.interested && (
                    <Link href="/dashboard/contacts/new" className="btn btn-primary btn-sm">
                      <IconPlus size={14} />
                      Add contact
                    </Link>
                  )
                }
              />
            ) : (
              <>
                {/* Phone: a card list. */}
                <div className="md:hidden">
                  <ul className="divide-y divide-[var(--hairline-3)]">
                    {contacts.map((contact) => {
                      const h = health.get(contact.id);
                      const best = bestPhone(contact);
                      const line = [contact.title, contact.company?.name].filter(Boolean).join(" · ");
                      return (
                        <li key={contact.id} className="flex gap-3 py-3" data-testid="contact-card" data-contact-id={contact.id}>
                          <CardCheck id={contact.id} label={contact.name} />
                          <div className="min-w-0 flex-1">
                            <CardTitle href={`/dashboard/contacts/${contact.id}`} name={contact.name} health={h} />
                            {line && <p className="muted truncate text-sm">{line}</p>}
                            {h && (
                              <div className="mt-1 flex items-center gap-2">
                                <LifecycleMeter health={h} size="mini" showCaption={false} />
                                <span className="faint text-xs">{cardCaption(h)}</span>
                              </div>
                            )}
                            <CardActions
                              number={best?.number ?? null}
                              contactId={contact.id}
                              log={<LogButton contactId={contact.id} name={contact.name} className="min-h-[44px] flex-1 justify-center" />}
                            />
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
                        <th className="sticky left-0 z-[1] [background:linear-gradient(var(--surface),var(--surface)),var(--bg)]">Person</th>
                        <th>Pulse</th>
                        <th>Next step</th>
                        <th>Best phone</th>
                        {showRep && <th>Rep</th>}
                        {show.has("email") && <th>Email</th>}
                        {show.has("phone2") && <th>Phone 2</th>}
                        {show.has("location") && <th>Location</th>}
                        {show.has("industry") && <th>Industry · Type</th>}
                        {show.has("notes") && <th>Notes</th>}
                        {show.has("marketing") && <th>Marketing</th>}
                        {show.has("added") && <th>Added</th>}
                        {show.has("addedBy") && <th>Added by</th>}
                        {show.has("status") && <th>Status</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((contact) => {
                        const h = health.get(contact.id);
                        const best = bestPhone(contact);
                        const others = otherPhones(contact);
                        const location = [contact.city, contact.state].filter(Boolean).join(", ");
                        return (
                          <tr key={contact.id} data-testid="contact-row" data-contact-id={contact.id}>
                            <td className="whitespace-nowrap pr-0">
                              <RowCheck id={contact.id} label={contact.name} />
                              <StarButton id={contact.id} favorite={contact.favorite} action={setContactFavorite} label={contact.name} />
                            </td>
                            <td className="sticky left-0 z-[1] min-w-[12rem] max-w-[18rem] [background:linear-gradient(var(--surface),var(--surface)),var(--bg)]">
                              <Link href={`/dashboard/contacts/${contact.id}`} className="link font-semibold">
                                {contact.name}
                              </Link>
                              {(contact.title || contact.company) && (
                                <p className="faint truncate text-xs">
                                  {contact.title}
                                  {contact.title && contact.company && " · "}
                                  {contact.company && (
                                    <Link href={`/dashboard/companies/${contact.company.id}`} className="hover:underline">
                                      {contact.company.name}
                                    </Link>
                                  )}
                                </p>
                              )}
                              {contact._count.deals > 0 && (
                                <p className="faint text-[0.68rem]">
                                  {contact._count.deals} {contact._count.deals === 1 ? "deal" : "deals"}
                                </p>
                              )}
                              <OwesLine balance={owed.get(contact.id)} timeZone={timeZone} />
                            </td>
                            <td>
                              <PulseCell health={h} repId={contact.ownerId} />
                            </td>
                            <td>
                              <NextStepCell health={h} />
                            </td>
                            <td className="muted" data-testid={best?.label === "Mobile" ? "contact-row-mobile" : "contact-row-phone"}>
                              {best ? <PhoneLink number={best.number} contactId={contact.id} /> : <span className="faint">—</span>}
                            </td>
                            {showRep && (
                              <td>
                                <RepCell name={repName(contact.owner)} />
                              </td>
                            )}
                            {show.has("email") && (
                              <td className="muted">
                                {contact.email ? (
                                  <a href={`mailto:${contact.email}`} className="hover:underline">
                                    {contact.email}
                                  </a>
                                ) : (
                                  <span className="faint">—</span>
                                )}
                              </td>
                            )}
                            {show.has("phone2") && (
                              <td className="muted">
                                {others.length ? (
                                  others.map((number) => (
                                    <p key={number}>
                                      <PhoneLink number={number} contactId={contact.id} />
                                    </p>
                                  ))
                                ) : (
                                  <span className="faint">—</span>
                                )}
                              </td>
                            )}
                            {show.has("location") && (
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
                            )}
                            {show.has("industry") && (
                              <td className="text-xs">
                                <div className="flex flex-wrap items-center gap-1">
                                  <TagCell
                                    industries={contact.company?.industries ?? []}
                                    types={contact.company ? contact.company.companyTypes : [INDIVIDUAL_COMPANY_TYPE]}
                                  />
                                  {contact.company && (
                                    <AutoPill
                                      field="industries"
                                      autoFilled={contact.company.autoFilled}
                                      enrichedAt={contact.company.enrichedAt}
                                      timeZone={timeZone}
                                    />
                                  )}
                                </div>
                              </td>
                            )}
                            {show.has("notes") && (
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
                            )}
                            {show.has("marketing") && (
                              <td>
                                <MarketingCell tally={marketing.get(contact.id)} timeZone={timeZone} />
                              </td>
                            )}
                            {show.has("added") && <td className="faint whitespace-nowrap text-xs">{formatDate(contact.createdAt, timeZone)}</td>}
                            {show.has("addedBy") && <td className="faint whitespace-nowrap text-xs">{contact.createdBy?.name ?? "—"}</td>}
                            {show.has("status") && (
                              <td>
                                <StatusBadge status={contact.status} />
                              </td>
                            )}
                          </tr>
                        );
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
              noun="contacts"
            />
          </Card>
        </BulkAssign>
      </ListLogProvider>
    </div>
  );
}

// Only used to tell "the workspace is empty" from "the filters hide
// everything", so the empty state can say the right thing.
async function totalInWorkspace(organizationId: string, lock: ListLock) {
  return prisma.contact.count({
    where: {
      organizationId,
      ...(lock.fav ? { favorite: true } : {}),
      ...(lock.deals ? { deals: { some: {} } } : {}),
      ...(lock.interested ? { status: "INTERESTED" as const } : {}),
    },
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
