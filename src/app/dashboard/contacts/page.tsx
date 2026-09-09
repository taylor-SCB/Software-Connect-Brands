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
  IconSearch,
  IconGlobe,
} from "@/components/icons";
import { ACTIVITY_TYPES, type ActivityTypeValue } from "@/lib/constants";

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

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { organizationId } = await requireSession();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const where = {
    organizationId,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { company: { name: { contains: query, mode: "insensitive" as const } } },
            { email: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: query } },
            { city: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [contacts, activityCounts] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { notes: true } },
        company: { select: { id: true, name: true } },
      },
    }),
    prisma.activity.groupBy({
      by: ["contactId", "type"],
      where: { organizationId, contactId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  // contactId -> { TEXT: 2, EMAIL: 1, ... }
  const counts = new Map<string, Partial<Record<ActivityTypeValue, number>>>();
  for (const row of activityCounts) {
    if (!row.contactId) continue;
    const existing = counts.get(row.contactId) ?? {};
    existing[row.type as ActivityTypeValue] = row._count._all;
    counts.set(row.contactId, existing);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Relationships"
        title="Contacts"
        subtitle={`${contacts.length} ${contacts.length === 1 ? "record" : "records"}${query ? ` matching “${query}”` : ""}`}
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
                placeholder="Search contacts…"
                aria-label="Search contacts"
                className="input input-sm w-52 pl-8"
              />
            </form>
            <Link href="/dashboard/contacts/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              Add contact
            </Link>
          </>
        }
      />

      <Card lit>
        {contacts.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={20} />}
            title={query ? "No contacts match that search" : "No contacts yet"}
            body={
              query
                ? "Try a different name, company, email or phone number."
                : "Add your first customer or lead to start tracking notes, quotes and contracts."
            }
            action={
              !query && (
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
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Website</th>
                  <th>Notes</th>
                  <th>Activity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const activity = counts.get(contact.id) ?? {};
                  return (
                    <tr key={contact.id}>
                      <td className="font-medium">
                        {contact.company ? (
                          <Link
                            href={`/dashboard/companies/${contact.company.id}`}
                            className="hover:underline"
                          >
                            {contact.company.name}
                          </Link>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/dashboard/contacts/${contact.id}`}
                          className="link"
                        >
                          {contact.name}
                        </Link>
                        {contact.title && <p className="faint text-xs">{contact.title}</p>}
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
                        {contact.website ? (
                          <a
                            href={contact.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            <IconGlobe size={13} />
                            {contact.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </a>
                        ) : (
                          <span className="faint">—</span>
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
      </Card>
    </div>
  );
}
