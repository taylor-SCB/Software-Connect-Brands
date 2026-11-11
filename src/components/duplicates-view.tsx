import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { getTimeZone } from "@/lib/organization";
import { BackLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { MergeButton, type Hit } from "@/components/merge-button";
import { pageWindow } from "@/lib/list-params";
import {
  DUPLICATE_LABELS,
  DUPLICATE_MODES,
  GROUPS_PER_PAGE,
  findDuplicateGroups,
  type DuplicateKind,
  type DuplicateMode,
} from "@/lib/duplicates";

// "Find duplicates" from the Contacts and Companies lists (Nov 10, 2026):
// one tab per way two records can look like one, a page of groups at a
// time, and each group's "Merge these" opening Merge Contacts / Merge
// Companies with the group already picked (oldest first, kept by default).
export async function DuplicatesView({
  organizationId,
  kind,
  searchParams,
}: {
  organizationId: string;
  kind: DuplicateKind;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const modes = DUPLICATE_MODES[kind] as readonly DuplicateMode[];
  const rawBy = String(searchParams.by ?? "");
  const by: DuplicateMode = (modes as readonly string[]).includes(rawBy) ? (rawBy as DuplicateMode) : modes[0];
  const page = Math.max(1, Number(searchParams.page) || 1);
  const basePath = `/dashboard/${kind}/duplicates`;
  const [{ groups, total }, timeZone] = await Promise.all([findDuplicateGroups(organizationId, kind, by, page), getTimeZone()]);
  const ids = groups.flatMap((group) => group.ids);

  const records = new Map<string, Hit & { added: Date; rep: string | null; href: string }>();
  if (kind === "contacts" && ids.length) {
    const rows = await prisma.contact.findMany({
      where: { organizationId, id: { in: ids } },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        mobile: true,
        createdAt: true,
        company: { select: { name: true } },
        owner: { select: { name: true } },
      },
    });
    for (const row of rows) {
      records.set(row.id, {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone ?? row.mobile,
        company: row.company?.name ?? null,
        added: row.createdAt,
        rep: row.owner?.name ?? null,
        href: `/dashboard/contacts/${row.id}`,
      });
    }
  } else if (ids.length) {
    const rows = await prisma.company.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true, city: true, state: true, website: true, phone: true, createdAt: true, owner: { select: { name: true } } },
    });
    for (const row of rows) {
      records.set(row.id, {
        id: row.id,
        name: row.name,
        city: row.city,
        state: row.state,
        email: row.website,
        phone: row.phone,
        added: row.createdAt,
        rep: row.owner?.name ?? null,
        href: `/dashboard/companies/${row.id}`,
      });
    }
  }
  const window = pageWindow(total, GROUPS_PER_PAGE, page);
  const noun = kind === "contacts" ? "Contacts" : "Companies";

  return (
    <div>
      <BackLink href={`/dashboard/${kind}`} label={noun} current="Find duplicates" />
      <PageHeader
        eyebrow={noun}
        title="Find duplicates"
        subtitle={`${total.toLocaleString()} ${total === 1 ? "group" : "groups"} that look like the same ${kind === "contacts" ? "person" : "business"}. Merge folds each into one; check them first, two people can share an office phone.`}
      />
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
        {modes.map((mode) => (
          <Link
            key={mode}
            href={`${basePath}?by=${mode}`}
            role="tab"
            aria-selected={mode === by}
            className={`btn btn-sm ${mode === by ? "btn-primary" : "btn-ghost"}`}
            data-testid={`dup-tab-${mode}`}
          >
            {DUPLICATE_LABELS[kind][mode]}
          </Link>
        ))}
      </div>
      <Card lit>
        {groups.length === 0 ? (
          <EmptyState title="No duplicates found" body={`Nothing shares ${sharedThing(DUPLICATE_LABELS[kind][by] ?? "")}.`} />
        ) : (
          <ul className="divide-y divide-[var(--hairline)]">
            {groups.map((group) => {
              const members = group.ids.map((id) => records.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
              const shown = by === "name" && kind === "contacts" ? group.key.slice(group.key.indexOf("|") + 1) : group.key;
              return (
                <li key={group.key} className="px-5 py-3" data-testid="dup-group">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">
                      <span className="font-semibold" data-testid="dup-key">
                        {shown}
                      </span>
                      <span className="faint ml-2 text-xs">{group.count} records</span>
                    </p>
                    <MergeButton
                      kind={kind}
                      initial={members.slice(0, 5).map(({ id, name, email, phone, company, city, state }) => ({ id, name, email, phone, company, city, state }))}
                      label={group.count > 5 ? "Merge the first five" : "Merge these"}
                      stay
                    />
                  </div>
                  <ul className="space-y-1">
                    {members.map((row) => (
                      <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 text-sm" data-testid="dup-record">
                        <Link href={row.href} className="link">
                          {row.name}
                        </Link>
                        <span className="faint text-xs">
                          {[kind === "contacts" ? row.company : [row.city, row.state].filter(Boolean).join(", "), row.email, row.phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span className="faint text-xs">
                          Added {formatDate(row.added, timeZone)} · {row.rep ?? "Unassigned"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination
          total={total}
          from={window.from}
          to={window.to}
          page={window.current}
          pages={window.pages}
          hrefFor={(n) => `${basePath}?by=${by}${n > 1 ? `&page=${n}` : ""}`}
          noun="groups"
        />
      </Card>
    </div>
  );
}

// "Same email" → "an email", "Same phone" → "a phone" (ux-gaps: it read
// "a email").
function sharedThing(label: string) {
  const thing = label.toLowerCase().replace(/^same /, "");
  return `${/^[aeiou]/.test(thing) ? "an" : "a"} ${thing}`;
}
