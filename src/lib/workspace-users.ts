import { prisma } from "@/lib/prisma";

export type WorkspaceUser = {
  id: string;
  name: string;
  email: string;
  title: string | null;
};

// Everyone with a login in this workspace. One definition, so "Who can
// send?" on a contract template and the people named on a quote are
// literally the same list rather than two queries that drift.
//
// The select stays explicit: there is no global omit for User, so a bare
// findMany would hand back the password hash.
//
// Someone taken off the account stays in the list, labelled, rather than
// dropping out: a quote they lead or a template only they could send
// still points at them, and a picker whose saved value is missing from
// its options silently saves the first option instead.
export async function loadWorkspaceUsers(organizationId: string): Promise<WorkspaceUser[]> {
  const users = await prisma.user.findMany({
    where: { organizationId },
    orderBy: [{ removedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: { id: true, name: true, email: true, title: true, removedAt: true },
  });
  return users.map(({ removedAt, ...user }) => (removedAt ? { ...user, name: `${user.name} (removed)` } : user));
}
