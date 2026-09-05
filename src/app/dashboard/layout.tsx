import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logout } from "./actions";

const navItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/contacts", label: "Contacts" },
  { href: "/dashboard/deals", label: "Deals" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
  });

  return (
    <div
      className="flex min-h-screen"
      style={{ ["--brand" as string]: organization.primaryColor }}
    >
      <aside className="flex w-60 flex-col justify-between border-r border-gray-200 bg-white p-4">
        <div>
          <div className="mb-6 flex items-center gap-2 px-2">
            {organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={organization.logoUrl}
                alt={organization.name}
                className="h-8 w-8 rounded object-cover"
              />
            ) : (
              <div
                className="flex h-8 w-8 items-center justify-center rounded text-sm font-semibold text-white"
                style={{ backgroundColor: "var(--brand)" }}
              >
                {organization.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="truncate font-semibold text-gray-900">
              {organization.name}
            </span>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="space-y-2 border-t border-gray-200 pt-4">
          <p className="truncate px-2 text-xs text-gray-500">{session.email}</p>
          <form action={logout}>
            <button
              type="submit"
              className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Log out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 bg-gray-50 p-8">{children}</main>
    </div>
  );
}
