import Link from "next/link";
import { LoginForm } from "./form";
import { isEmailConfigured } from "@/lib/email";

// Set when a signed-in session is turned away mid-visit — the workspace was
// paused or removed while they were using it, so they land back here
// without explanation unless we give one.
const STATUS_NOTICES: Record<string, string> = {
  pending: "Your workspace is still waiting to be approved.",
  paused: "This workspace has been paused. Get in touch and we'll sort it out.",
  rejected: "This workspace isn't active.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <div className="fade-up w-full max-w-sm">
        <div className="card card-lit p-6">
          <h1 className="page-title !text-2xl">Log in</h1>
          <p className="muted mt-1 text-sm">Welcome back.</p>
          {/* Offered only when email can actually be sent. A "forgot
              password" link that leads nowhere is worse than none: it
              promises a way back in that never arrives. */}
          <LoginForm
            notice={status ? STATUS_NOTICES[status] : undefined}
            canReset={isEmailConfigured()}
          />
        </div>

        <p className="faint mt-5 text-center text-xs">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="link">
            Create a workspace
          </Link>
        </p>
      </div>
    </div>
  );
}
