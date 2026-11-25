import { redirect } from "next/navigation";
import { SESSION_BLOCKS, sessionState, type SessionBlock } from "@/lib/session";
import { SignedOutLook } from "@/components/signed-out-look";
import { EndSession } from "./end-session";

// Where a browser that is no longer let in lands (Nov 25, 2026): someone
// taken off the workspace, or a workspace paused, while they were signed
// in. Reached by a click, a save (requireSession) or the open tab's own
// check (SessionWatch). A page, not a route handler: a save's redirect is
// followed by the app's own navigation, which can't follow a route handler
// and stalled there with the cookie still set. The page signs the browser
// out at once (EndSession), wiping the login cookie, and the login page
// says why.
export default async function SessionEndedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const state = await sessionState();
  if (state.kind === "ok") redirect("/dashboard");
  if (state.kind === "none") {
    // Already signed out (another tab got there first): keep the notice.
    const { reason } = await searchParams;
    const known = SESSION_BLOCKS.includes(reason as SessionBlock) ? reason : null;
    redirect(known ? `/login?status=${known}` : "/login");
  }

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <SignedOutLook />
      <div className="fade-up w-full max-w-sm">
        <div className="card card-lit p-6">
          <h1 className="page-title !text-2xl">Signing you out</h1>
          <p className="muted mt-1 text-sm">
            {state.reason === "removed"
              ? "This login was taken off its workspace."
              : "This workspace isn't open right now."}
          </p>
          <EndSession />
        </div>
      </div>
    </div>
  );
}
