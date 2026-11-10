import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SidebarNav, MobileNav } from "@/components/sidebar-nav";
import { PageTrail } from "@/components/back-link";
import { IconLogout, IconSparkles } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import Link from "next/link";
import { logout } from "./actions";
import { themeFor } from "@/lib/theme";
import { LookSwitch } from "@/components/look-switch";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
  });
  // The person's look, rendered into the server's HTML (data-theme below)
  // so the page never flashes Dark before turning Light.
  const theme = await themeFor(session.userId);

  const initials = organization.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

  return (
    // The tenant's brand color is injected here, so every descendant —
    // buttons, glows, focus rings, badges — reskins from one variable.
    <div
      className="relative z-10 flex min-h-screen flex-col lg:flex-row"
      style={{ ["--brand" as string]: organization.primaryColor }}
      data-theme={theme}
    >
      {/* The nav scrolls inside the sidebar and the account and Log out
          stay pinned at its foot (audit fix, Nov 10, 2026): on a short
          laptop screen the look switch had pushed Log out below the
          window, out of reach. Its right edge, like the phone bar's
          bottom line, is a --hairline-3 line: it separates, it isn't
          the outline of something to click, so it stayed soft when
          Light's --border was darkened for outlines (UX review). */}
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-[var(--hairline-3)] p-4 lg:flex lg:sticky lg:top-0 lg:h-screen">
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <div className="mb-6 flex items-center gap-2.5 px-1">
            {organization.logoUrl ? (
              // Tenant-supplied URL; next/image would need per-tenant
              // remote host config, so a plain img is the right call.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={organization.logoUrl}
                alt=""
                className="h-9 w-9 rounded-lg border border-[var(--border)] object-cover"
              />
            ) : (
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{
                  background:
                    "linear-gradient(140deg, color-mix(in srgb, var(--brand) 88%, white), var(--brand))",
                  boxShadow:
                    "0 6px 20px -8px color-mix(in srgb, var(--brand) 90%, transparent)",
                }}
              >
                {initials || "W"}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{organization.name}</p>
              <p className="faint truncate text-[0.68rem]">Workspace</p>
            </div>
          </div>

          {/* Dark / Light, under the workspace name so the page itself
              never moves to make room for it. */}
          <div className="-mt-3 mb-5 px-1">
            <LookSwitch key={theme} theme={theme} className="inline-flex" />
          </div>

          <SidebarNav />
        </div>

        <div className="shrink-0 space-y-2 pt-2">
          <div className="divider" />
          {session.isSuperAdmin && (
            <Link href="/admin" className="nav-item w-full">
              <IconSparkles size={15} className="opacity-70" />
              Operator console
            </Link>
          )}
          <Link href="/dashboard/settings/account" className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-[var(--hover)]">
            <Avatar url={session.avatarUrl} name={session.name} size={28} round />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{session.name}</p>
              <p className="faint truncate text-[0.68rem]">{session.title || session.email}</p>
            </div>
          </Link>
          <form action={logout}>
            <button type="submit" className="nav-item w-full text-left">
              <IconLogout size={15} className="opacity-70" />
              Log out
            </button>
          </form>
        </div>
      </aside>

      <div className="border-b border-[var(--hairline-3)] p-3 lg:hidden">
        <div className="mb-2 flex items-center justify-between">
          <p className="min-w-0 truncate text-sm font-semibold">{organization.name}</p>
          <LookSwitch key={theme} theme={theme} className="ml-auto mr-2 inline-flex shrink-0" />
          <form action={logout}>
            <button type="submit" className="btn btn-ghost btn-sm">
              <IconLogout size={14} />
              Log out
            </button>
          </form>
        </div>
        <MobileNav />
      </div>

      <main className="min-w-0 flex-1 p-5 sm:p-8">
        <PageTrail />
        <div className="fade-up mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
