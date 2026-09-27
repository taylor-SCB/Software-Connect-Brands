import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatDateTime } from "@/lib/format";
import { PageHeader, Card, CardHeader, Badge } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { CompanyTiles } from "../company-tiles";
import { sentToday } from "@/lib/email-marketing";
import { DAILY_EMAIL_LIMIT } from "@/lib/email-fields";
import { AddUserForm, UserRowActions } from "./user-forms";

export default async function CompanyUsersPage() {
  const session = await requireSession();
  const { organizationId } = session;
  const canManage = session.role === "OWNER" || session.role === "ADMIN";
  const timeZone = await getTimeZone();

  const users = await prisma.user.findMany({
    where: { organizationId },
    orderBy: [{ removedAt: { sort: "asc", nulls: "first" } }, { role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      title: true,
      role: true,
      avatarUrl: true,
      lastLoginAt: true,
      removedAt: true,
    },
  });
  // Each person's email count for today, so an owner can see the
  // allowance being used. A handful of users, so one small read each.
  const emailsToday = new Map(
    await Promise.all(users.map(async (user) => [user.id, await sentToday(user.id, timeZone)] as const)),
  );
  const active = users.filter((user) => !user.removedAt);

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings · Company Information"
        title="Company Users"
        subtitle="Everyone with a login on this workspace."
      />

      <CompanyTiles current="users" />

      <Card lit>
        <CardHeader
          title={`${active.length} ${active.length === 1 ? "user" : "users"}`}
          subtitle={
            canManage
              ? "Add a teammate and they get an email to set their own password."
              : "Everyone with a login. An owner or admin can add people."
          }
        />
        {canManage && <AddUserForm />}
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Title</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Role</th>
                <th>Last login</th>
                <th title={`Emails sent today, of ${DAILY_EMAIL_LIMIT}`}>Emails today</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} data-testid="user-row" className={user.removedAt ? "opacity-60" : undefined}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar url={user.avatarUrl} name={user.name} size={30} round />
                      <span className="font-medium">{user.name}</span>
                    </div>
                  </td>
                  <td className="muted">{user.title ?? <span className="faint">—</span>}</td>
                  <td className="muted">{user.email}</td>
                  <td className="muted">{user.phone ?? <span className="faint">—</span>}</td>
                  <td>
                    {user.removedAt ? (
                      <Badge>Removed</Badge>
                    ) : (
                      <Badge>{user.role.charAt(0) + user.role.slice(1).toLowerCase()}</Badge>
                    )}
                  </td>
                  <td className="faint text-xs">
                    {user.lastLoginAt ? formatDateTime(user.lastLoginAt, timeZone) : user.removedAt ? "Never" : "Invited · not yet"}
                  </td>
                  <td className="num text-xs">
                    {emailsToday.get(user.id) ?? 0} / {DAILY_EMAIL_LIMIT}
                  </td>
                  {canManage && (
                    <td>
                      {user.role !== "OWNER" && user.id !== session.userId && (
                        <UserRowActions
                          userId={user.id}
                          name={user.name}
                          role={user.role}
                          removed={Boolean(user.removedAt)}
                          invited={!user.lastLoginAt}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
