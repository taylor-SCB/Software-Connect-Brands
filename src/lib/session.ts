import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Call this at the top of any dashboard page/action that needs a
// logged-in user. Sends anonymous visitors to /login and hands back
// the pieces every tenant-scoped query needs.
export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
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
