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
      title: true,
      avatarUrl: true,
      isSuperAdmin: true,
      organizationId: true,
      removedAt: true,
      organization: { select: { status: true } },
    },
  }),
);

// Why a signed-in browser is no longer let in: taken off the workspace
// (or the row is gone), or the workspace itself isn't active. Each is a
// notice on the login page (STATUS_NOTICES in src/app/login/page.tsx).
export type SessionBlock = "removed" | "pending" | "paused" | "rejected";
export const SESSION_BLOCKS: readonly SessionBlock[] = ["removed", "pending", "paused", "rejected"];

type SessionUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
export type SessionState =
  | { kind: "none" }
  | { kind: "blocked"; reason: SessionBlock }
  | { kind: "ok"; user: SessionUser };

// The one answer to "is this browser still let in?", read from the
// database, never from the login cookie alone (Nov 25, 2026: a removed
// rep's saved document links still opened on the cookie). Everything that
// trusts a login goes through here: requireSession, the file links, the
// draft previews and the open tab's check (/api/session).
export async function sessionState(): Promise<SessionState> {
  const session = await auth();
  if (!session?.user?.id) return { kind: "none" };
  const user = await currentUser(session.user.id);
  if (!user || user.removedAt) return { kind: "blocked", reason: "removed" };
  if (user.organization.status !== "ACTIVE") {
    return { kind: "blocked", reason: user.organization.status.toLowerCase() as SessionBlock };
  }
  return { kind: "ok", user };
}

// The workspace a still-allowed browser belongs to, or null: what a file
// link or a draft preview compares with the record's own workspace.
export async function activeOrganizationId(): Promise<string | null> {
  const state = await sessionState();
  return state.kind === "ok" ? state.user.organizationId : null;
}

// Where a turned-away browser is sent: /session-ended wipes its login
// cookie, so nothing that reads the cookie alone lets it back in, then
// shows the login page with the reason.
export function sessionEndedPath(reason: SessionBlock) {
  return `/session-ended?reason=${reason}`;
}

// Call this at the top of any dashboard page/action that needs a
// logged-in user. Sends anonymous visitors to /login and hands back
// the pieces every tenant-scoped query needs.
export async function requireSession() {
  const state = await sessionState();
  if (state.kind === "none") redirect("/login");
  // Removed, or the workspace paused, out from under a live session.
  if (state.kind === "blocked") redirect(sessionEndedPath(state.reason));
  const { user } = state;

  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    name: user.name,
    email: user.email,
    title: user.title,
    avatarUrl: user.avatarUrl,
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
  // A login taken off its workspace is out everywhere, the console too:
  // from here an operator creates whole accounts.
  if (!user?.isSuperAdmin || user.removedAt) notFound();

  return { userId: user.id, name: user.name, email: user.email };
}
