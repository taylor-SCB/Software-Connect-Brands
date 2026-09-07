import Link from "next/link";
import { requireSuperAdmin } from "@/lib/session";
import { IconArrowLeft, IconSparkles } from "@/components/icons";

// Deliberately not the tenant dashboard shell: this console spans every
// workspace, so borrowing any one tenant's branding would be misleading. A
// fixed accent keeps it visually obvious you are outside your own account.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const operator = await requireSuperAdmin();

  return (
    <div
      className="relative z-10 min-h-screen"
      style={{ ["--brand" as string]: "#a855f7" }}
    >
      <header className="border-b border-[var(--border)] px-5 py-3 sm:px-8">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
              style={{ background: "var(--brand)" }}
            >
              <IconSparkles size={15} />
            </div>
            <div>
              <p className="text-sm font-semibold">Operator console</p>
              <p className="faint text-[0.68rem]">{operator.email}</p>
            </div>
          </div>
          <Link href="/dashboard" className="btn btn-ghost btn-sm">
            <IconArrowLeft size={13} />
            My workspace
          </Link>
        </div>
      </header>

      <main className="p-5 sm:p-8">
        <div className="fade-up mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
