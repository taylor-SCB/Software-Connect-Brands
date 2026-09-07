import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/session";
import { formatDate, formatDateTime, DEFAULT_TIME_ZONE } from "@/lib/format";
import { PageHeader, Card, CardHeader, StatTile, EmptyState } from "@/components/ui";
import { IconUsers } from "@/components/icons";
import { WorkspaceRow } from "./workspace-row";

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
