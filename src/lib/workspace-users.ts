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
export async function loadWorkspaceUsers(organizationId: string): Promise<WorkspaceUser[]> {
  return prisma.user.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, title: true },
  });
}
