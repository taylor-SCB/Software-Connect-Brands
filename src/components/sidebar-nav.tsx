"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconGrid,
  IconUsers,
  IconBox,
  IconHardHat,
  IconFileText,
  IconSignature,
  IconTrending,
  IconSettings,
  IconLayers,
  IconBuilding,
  IconCalendar,
  IconClock,
  IconStar,
  IconFlame,
  IconChart,
  IconUsers as IconAccount,
} from "@/components/icons";

type NavChild = { href: string; label: string; Icon: (p: { size?: number; className?: string }) => React.ReactElement };

type NavItem = {
  href: string;
  label: string;
  Icon: NavChild["Icon"];
  // Sub-modules that live under a section. Shown indented beneath the
  // parent while the section is active, so the sidebar stays short.
  children?: NavChild[];
};

// A group is a heading with sections under it (CRM, Closer's Club). The
// heading is not a page of its own; its sections are always shown.
type NavEntry = NavItem | { group: string; items: NavItem[] };

// The order Taylor set on Sept 30, 2026. Contract Coordinator lives under
// Contracts only (it used to sit under Pipeline as well).
const NAV: NavEntry[] = [
  { href: "/dashboard", label: "Overview", Icon: IconGrid },
  { href: "/dashboard/calendar", label: "Calendar", Icon: IconCalendar },
  {
    group: "CRM",
    items: [
      {
        href: "/dashboard/contacts",
        label: "Contacts",
        Icon: IconUsers,
        children: [
          { href: "/dashboard/contacts/favorites", label: "Favorite Contacts", Icon: IconStar },
          { href: "/dashboard/contacts/interested", label: "Interested Contacts", Icon: IconFlame },
          { href: "/dashboard/contacts/with-deals", label: "Contacts with Deals", Icon: IconTrending },
        ],
      },
      {
        href: "/dashboard/companies",
        label: "Companies",
        Icon: IconBuilding,
        children: [
          { href: "/dashboard/companies/favorites", label: "Favorite Companies", Icon: IconStar },
          { href: "/dashboard/companies/interested", label: "Interested Companies", Icon: IconFlame },
          { href: "/dashboard/companies/with-deals", label: "Companies with Deals", Icon: IconTrending },
        ],
      },
    ],
  },
  {
    group: "Closer's Club",
    items: [
      { href: "/dashboard/deals", label: "Pipeline", Icon: IconTrending },
      { href: "/dashboard/quotes", label: "Quotes", Icon: IconFileText },
      {
        href: "/dashboard/contracts",
        label: "Contracts",
        Icon: IconSignature,
        children: [{ href: "/dashboard/contracts/tracker", label: "Contract Coordinator", Icon: IconClock }],
      },
      {
        href: "/dashboard/products",
        label: "Products",
        Icon: IconBox,
        children: [{ href: "/dashboard/products/ratesheets", label: "Ratesheets", Icon: IconLayers }],
      },
    ],
  },
  {
    href: "/dashboard/projects",
    label: "Projects",
    Icon: IconHardHat,
    children: [
      { href: "/dashboard/projects/properties", label: "Properties", Icon: IconBuilding },
      { href: "/dashboard/projects/budgets", label: "Budgets", Icon: IconTrending },
      { href: "/dashboard/projects/crews", label: "Crews", Icon: IconHardHat },
    ],
  },
  { href: "/dashboard/stats", label: "Stats / Reporting", Icon: IconChart },
  {
    href: "/dashboard/settings",
    label: "Settings",
    Icon: IconSettings,
    // My Account is listed first on purpose: Company Information keeps
    // the section's own address, so it would otherwise match every page.
    children: [
      { href: "/dashboard/settings/account", label: "My Account", Icon: IconAccount },
      { href: "/dashboard/settings", label: "Company Information", Icon: IconBuilding },
    ],
  },
];

// Every section in order, with the group headings taken out.
const SECTIONS: NavItem[] = NAV.flatMap((entry) => ("group" in entry ? entry.items : [entry]));

// `/dashboard` would otherwise light up on every child route, so the
// index link matches exactly while section links match their subtree.
function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((entry) =>
        "group" in entry ? (
          <div key={entry.group} className="mt-3 flex flex-col gap-0.5" data-testid="nav-group">
            <p className="faint px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em]">{entry.group}</p>
            {entry.items.map((item) => (
              <Section key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        ) : (
          <Section key={entry.href} item={entry} pathname={pathname} />
        ),
      )}
    </nav>
  );
}

function Section({ item: { href, label, Icon, children }, pathname }: { item: NavItem; pathname: string }) {
  const sectionActive = isActive(pathname, href);
  const childActive = children?.find((child) => isActive(pathname, child.href));
  // The parent lights up for its own page; on a sub-module page the
  // child carries the highlight instead so only one row reads as
  // "you are here".
  const active = sectionActive && !childActive;
  return (
    <div>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`nav-item ${active ? "nav-item-active" : ""}`}
      >
        <Icon size={16} className={active ? "" : "opacity-70"} />
        {label}
      </Link>
      {children && sectionActive && (
        <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--border)] pl-2">
          {children.map((child) => {
            const on = child === childActive;
            return (
              <Link
                key={child.href}
                href={child.href}
                aria-current={on ? "page" : undefined}
                className={`nav-item py-1.5 text-[0.8rem] ${on ? "nav-item-active" : ""}`}
              >
                <child.Icon size={14} className={on ? "" : "opacity-70"} />
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  // One flat strip on a phone: sub-modules sit right after their parent.
  // A child that shares its parent's address (Company Information) is
  // the parent on a phone, so the strip never lists one link twice.
  const items = SECTIONS.flatMap((item) => [item, ...(item.children ?? [])]).filter(
    (item, index, all) => all.findIndex((other) => other.href === item.href) === index,
  );

  return (
    <nav className="flex gap-1 overflow-x-auto pb-1">
      {items.map(({ href, label, Icon }) => {
        const deeper = items.some((other) => other.href !== href && other.href.startsWith(`${href}/`) && isActive(pathname, other.href));
        const active = isActive(pathname, href) && !deeper;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`nav-item shrink-0 ${active ? "nav-item-active" : ""}`}
          >
            <Icon size={15} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
