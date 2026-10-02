import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { aiStatus } from "@/lib/ai";
import { buildCallList, scopeRows, storedOpeners, type CallScope } from "@/lib/call-list";
import { PageHeader, CardHeader, EmptyState } from "@/components/ui";
import { IconPhone } from "@/components/icons";
import { CallSections } from "./call-rows";

type SearchParams = Promise<{ whose?: string }>;

// The morning Call List (Oct 2, 2026). Who to call today and why, most
// pressing first: follow-ups due, meetings nobody marked held, met with no
// quote, quotes and contracts gone quiet, and people Interested with no
// meeting booked. Each line has a drafted opener; ticking it logs the touch.
export default async function CallListPage({ searchParams }: { searchParams: SearchParams }) {
  const { organizationId, userId, role } = await requireSession();
  const { whose: requested } = await searchParams;
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  const manager = role === "OWNER" || role === "ADMIN";

  const users = manager
    ? await prisma.user.findMany({ where: { organizationId, removedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  const whose = manager && requested && (requested === "everyone" || users.some((user) => user.id === requested)) ? requested : userId;
  const scope: CallScope = whose === "everyone" ? "everyone" : { userId: whose };

  const [all, ai] = await Promise.all([buildCallList(organizationId, today), aiStatus(userId, timeZone)]);
  const { mine, nobodys } = scopeRows(all, scope);
  const openers = Object.fromEntries(await storedOpeners(organizationId, [...mine, ...nobodys], today));
  const aiReady = ai.configured && ai.used < ai.limit;
  const autoDraft = aiReady && [...mine.slice(0, 15), ...nobodys.slice(0, 5)].some((row) => !openers[row.key]);
  const whoseName = whose === "everyone" ? "Everyone's" : whose === userId ? "Your" : `${users.find((user) => user.id === whose)?.name ?? "Their"}'s`;

  return (
    <div>
      <PageHeader
        eyebrow="Today"
        title="Call List"
        subtitle={`${whoseName} calls for today · ${mine.length} ${mine.length === 1 ? "person" : "people"}${nobodys.length ? ` · ${nobodys.length} nobody's` : ""}`}
        actions={
          manager ? (
            <form className="flex items-center gap-2" action="/dashboard/call-list">
              <label htmlFor="whose" className="faint text-xs">
                Whose list
              </label>
              <select id="whose" name="whose" defaultValue={whose} className="select input-sm w-auto" data-testid="call-whose">
                <option value={userId}>Mine</option>
                <option value="everyone">Everyone</option>
                {users
                  .filter((user) => user.id !== userId)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
              </select>
              <button type="submit" className="btn btn-ghost btn-sm">
                Show
              </button>
            </form>
          ) : null
        }
      />
      {ai.configured ? (
        <p className="faint mb-3 text-xs" data-testid="ai-counter">
          AI drafts today: {ai.used} of {ai.limit}
        </p>
      ) : (
        <p className="faint mb-3 text-xs">Openers appear here once AI drafting is switched on for the workspace. The list works without it.</p>
      )}

      <CallSections
        mine={mine}
        nobodys={nobodys}
        openers={openers}
        whose={whose}
        aiReady={aiReady}
        autoDraft={autoDraft}
        showOwner={whose === "everyone"}
        headers={{
          mine: <CardHeader title={whose === "everyone" ? "Everyone's calls" : "Your calls"} subtitle="Most pressing first. Logging a call takes it off the list." />,
          nobodys: <CardHeader title="Nobody's" subtitle="Nobody has touched these yet. Whoever calls first, they're theirs." />,
        }}
        emptyMine={
          <EmptyState icon={<IconPhone size={20} />} title="Nobody to chase today" body="Follow-ups, quiet quotes and contracts, and people waiting on a meeting show up here." />
        }
      />
      <p className="faint mt-4 text-xs">
        The list is worked out from the{" "}
        <Link href="/dashboard/calendar" className="underline">
          calendar
        </Link>
        , the status of each person and the paperwork out. It never changes anything on its own.
      </p>
    </div>
  );
}
