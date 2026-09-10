import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatDateTime } from "@/lib/format";
import { PageHeader, Card, CardHeader, Badge } from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { CompanyTiles } from "../company-tiles";

export default async function CompanyUsersPage() {
  const { organizationId } = await requireSession();
  const timeZone = await getTimeZone();

  const users = await prisma.user.findMany({
    where: { organizationId },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      title: true,
      role: true,
      avatarUrl: true,
      lastLoginAt: true,
    },
  });

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
          title={`${users.length} ${users.length === 1 ? "user" : "users"}`}
          subtitle="Inviting a teammate isn't built yet — each workspace has the person who signed up."
        />
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
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
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
                    <Badge>{user.role.charAt(0) + user.role.slice(1).toLowerCase()}</Badge>
                  </td>
                  <td className="faint text-xs">
                    {user.lastLoginAt ? formatDateTime(user.lastLoginAt, timeZone) : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
