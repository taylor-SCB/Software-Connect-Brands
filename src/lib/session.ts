import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Call this at the top of any dashboard page/action that needs a
// logged-in user. Sends anonymous visitors to /login and hands back
// the pieces every tenant-scoped query needs.
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.organizationId) {
    redirect("/login");
  }
  return {
    userId: session.user.id,
    organizationId: session.user.organizationId,
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
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
