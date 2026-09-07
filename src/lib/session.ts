import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// The JWT is a snapshot taken at login and is not re-issued when the
// operator pauses a workspace or revokes an admin. Reading both flags back
// from the database on every request is what makes Pause take effect
// immediately instead of whenever the token happens to expire. cache()
// collapses this to one query per request no matter how many components
// ask.
const currentUser = cache(async (userId: string) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isSuperAdmin: true,
      organizationId: true,
      organization: { select: { status: true } },
    },
  }),
);

// Call this at the top of any dashboard page/action that needs a
// logged-in user. Sends anonymous visitors to /login and hands back
// the pieces every tenant-scoped query needs.
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await currentUser(session.user.id);
  // Deleted out from under a live session.
  if (!user) redirect("/login");
  if (user.organization.status !== "ACTIVE") {
    redirect(`/login?status=${user.organization.status.toLowerCase()}`);
  }

  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    name: user.name,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
  };
}

// Org-wide settings (branding, templates) are owner/admin territory.
// Members can still work the pipeline but can't re-skin the product.
export async function requireAdminSession() {
  const session = await requireSession();
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return { ...session, allowed: false as const };
  }
  return { ...session, allowed: true as const };
}

// Operator-level access across every workspace. notFound() rather than a
// redirect or a 403: someone who isn't an operator should get no signal
// that /admin is a real address.
export async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await currentUser(session.user.id);
  if (!user?.isSuperAdmin) notFound();

  return { userId: user.id, name: user.name, email: user.email };
}
