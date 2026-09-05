import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SidebarNav, MobileNav } from "@/components/sidebar-nav";
import { IconLogout } from "@/components/icons";
import { logout } from "./actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
  });

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
    >
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-[var(--border)] p-4 lg:flex lg:sticky lg:top-0 lg:h-screen">
        <div>
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

          <SidebarNav />
        </div>

        <div className="space-y-2">
          <div className="divider" />
          <div className="px-1">
            <p className="truncate text-xs font-medium">{session.name}</p>
            <p className="faint truncate text-[0.68rem]">{session.email}</p>
          </div>
          <form action={logout}>
            <button type="submit" className="nav-item w-full text-left">
              <IconLogout size={15} className="opacity-70" />
              Log out
            </button>
          </form>
        </div>
      </aside>

      <div className="border-b border-[var(--border)] p-3 lg:hidden">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">{organization.name}</p>
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
        <div className="fade-up mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
