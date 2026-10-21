import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/session";
import { formatDate, formatDateTime, DEFAULT_TIME_ZONE } from "@/lib/format";
import { PageHeader, Card, CardHeader, StatTile, EmptyState } from "@/components/ui";
import { IconUsers, IconDownload, IconFileText } from "@/components/icons";
import { WorkspaceRow } from "./workspace-row";
import { setRatesheetIssueResolved } from "./actions";

// Operator console. Never cached: an approval has to show up the instant
// it happens, and the list is a handful of rows.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const operator = await requireSuperAdmin();

  // The operator's own zone, read directly rather than through
  // getTimeZone() — that helper is scoped to the *signed-in* workspace and
  // swallows the redirect requireSession throws, which would turn a paused
  // operator workspace into a silent fallback instead of a login bounce.
  const operatorUser = await prisma.user.findUnique({
    where: { id: operator.userId },
    select: { organization: { select: { timeZone: true } } },
  });
  const timeZone = operatorUser?.organization.timeZone ?? DEFAULT_TIME_ZONE;

  const organizations = await prisma.organization.findMany({
    orderBy: [
      // Anything waiting on a decision belongs at the top — that's the
      // only part of this page that is a to-do list.
      { status: "asc" },
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      users: {
        orderBy: { createdAt: "asc" },
        select: {
          name: true,
          email: true,
          phone: true,
          role: true,
          lastLoginAt: true,
          isSuperAdmin: true,
        },
      },
      _count: {
        select: { users: true, contacts: true, quotes: true, contracts: true },
      },
    },
  });

  // Declined ratesheet imports: open ones first, then the last few fixed.
  const issues = await prisma.ratesheetImportIssue.findMany({
    orderBy: [{ resolvedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      note: true,
      detected: true,
      fileName: true,
      sizeBytes: true,
      createdAt: true,
      resolvedAt: true,
      organization: { select: { name: true } },
      user: { select: { name: true, email: true } },
      distributor: { select: { name: true } },
    },
  });
  const openIssues = issues.filter((issue) => !issue.resolvedAt);

  const counts = {
    pending: organizations.filter((o) => o.status === "PENDING").length,
    active: organizations.filter((o) => o.status === "ACTIVE").length,
    paused: organizations.filter((o) => o.status === "PAUSED").length,
  };

  const waiting = organizations.filter((o) => o.status === "PENDING");
  const decided = organizations.filter((o) => o.status !== "PENDING");

  return (
    <div>
      <PageHeader
        eyebrow="Operator"
        title="Every workspace"
        subtitle="Who has signed up, who is using it, and who gets in."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Waiting on you" value={counts.pending} accent="#fbbf24" />
        <StatTile label="Active" value={counts.active} accent="#34d399" />
        <StatTile label="Paused" value={counts.paused} accent="#f97316" />
        <StatTile label="Total workspaces" value={organizations.length} />
      </div>

      <Card lit className="mb-6">
        <CardHeader
          title="Waiting for approval"
          subtitle={
            waiting.length > 0
              ? "Nobody here can log in yet."
              : "Nothing waiting right now."
          }
        />
        {waiting.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={20} />}
            title="All caught up"
            body="New signups will land here."
          />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {waiting.map((organization) => (
              <WorkspaceRow
                key={organization.id}
                organization={{
                  ...organization,
                  createdAt: formatDate(organization.createdAt, timeZone),
                  reviewedAt: null,
                  users: organization.users.map((user) => ({
                    ...user,
                    lastLoginAt: user.lastLoginAt
                      ? formatDateTime(user.lastLoginAt, timeZone)
                      : null,
                  })),
                }}
              />
            ))}
          </div>
        )}
      </Card>

      <Card lit className="mb-6" id="ratesheet-issues">
        <CardHeader
          title="Ratesheet imports to look at"
          subtitle={
            openIssues.length > 0
              ? `${openIssues.length} declined because the sheet read wrong. Nothing was imported from them.`
              : "Nobody has declined an import."
          }
        />
        {issues.length === 0 ? (
          <EmptyState
            icon={<IconFileText size={20} />}
            title="Nothing declined"
            body="When someone declines a ratesheet import, the file and their note land here."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]" data-testid="ratesheet-issues">
            {issues.map((issue) => {
              const detected = (issue.detected ?? {}) as {
                supplier?: string | null;
                rule?: string | null;
                tabs?: { name: string; headers: string[]; chosenRoles: string[] | null; detectedRoles: string[] }[];
              };
              return (
                <li key={issue.id} className="space-y-1 px-5 py-3" style={issue.resolvedAt ? { opacity: 0.55 } : undefined}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {issue.organization.name} · {issue.fileName}
                        {issue.resolvedAt && <span className="faint text-xs font-normal"> · fixed</span>}
                      </p>
                      <p className="faint text-xs">
                        {issue.user ? `${issue.user.name} (${issue.user.email})` : "A removed user"} ·{" "}
                        {formatDateTime(issue.createdAt, timeZone)}
                        {(issue.distributor?.name ?? detected.supplier) && ` · from ${issue.distributor?.name ?? detected.supplier}`}
                        {detected.rule && ` · ${detected.rule}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <a href={`/admin/ratesheet-issues/${issue.id}`} className="btn btn-ghost btn-sm">
                        <IconDownload size={12} />
                        File
                      </a>
                      <form action={setRatesheetIssueResolved}>
                        <input type="hidden" name="issueId" value={issue.id} />
                        <input type="hidden" name="resolved" value={issue.resolvedAt ? "0" : "1"} />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          {issue.resolvedAt ? "Reopen" : "Mark fixed"}
                        </button>
                      </form>
                    </div>
                  </div>
                  <p className="text-sm">&ldquo;{issue.note}&rdquo;</p>
                  {detected.tabs?.map((tab) => (
                    <p key={tab.name} className="faint text-xs">
                      {tab.name}:{" "}
                      {tab.headers
                        .map((header, index) => `${header || `Column ${index + 1}`} → ${(tab.chosenRoles ?? tab.detectedRoles)[index] ?? "?"}`)
                        .join(" · ")}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Everyone else" subtitle="Active, paused and rejected." />
        {decided.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={20} />}
            title="No workspaces yet"
            body="Approved signups show up here."
          />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {decided.map((organization) => (
              <WorkspaceRow
                key={organization.id}
                organization={{
                  ...organization,
                  createdAt: formatDate(organization.createdAt, timeZone),
                  reviewedAt: organization.reviewedAt
                    ? formatDate(organization.reviewedAt, timeZone)
                    : null,
                  users: organization.users.map((user) => ({
                    ...user,
                    lastLoginAt: user.lastLoginAt
                      ? formatDateTime(user.lastLoginAt, timeZone)
                      : null,
                  })),
                }}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
