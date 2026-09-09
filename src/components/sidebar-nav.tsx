"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconGrid,
  IconUsers,
  IconBox,
  IconFileText,
  IconSignature,
  IconTrending,
  IconSettings,
  IconLayers,
  IconBuilding,
} from "@/components/icons";

type NavChild = { href: string; label: string; Icon: (p: { size?: number; className?: string }) => React.ReactElement };

const NAV: {
  href: string;
  label: string;
  Icon: NavChild["Icon"];
  // Sub-modules that live under a section. Shown indented beneath the
  // parent while the section is active, so the sidebar stays short.
  children?: NavChild[];
}[] = [
  { href: "/dashboard", label: "Overview", Icon: IconGrid },
  { href: "/dashboard/contacts", label: "Contacts", Icon: IconUsers },
  { href: "/dashboard/companies", label: "Companies", Icon: IconBuilding },
  { href: "/dashboard/deals", label: "Pipeline", Icon: IconTrending },
  {
    href: "/dashboard/products",
    label: "Products",
    Icon: IconBox,
    children: [{ href: "/dashboard/products/ratesheets", label: "Ratesheets", Icon: IconLayers }],
  },
  { href: "/dashboard/quotes", label: "Quotes", Icon: IconFileText },
  { href: "/dashboard/contracts", label: "Contracts", Icon: IconSignature },
  { href: "/dashboard/settings", label: "Settings", Icon: IconSettings },
];

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
      {NAV.map(({ href, label, Icon, children }) => {
        const sectionActive = isActive(pathname, href);
        const childActive = children?.find((child) => isActive(pathname, child.href));
        // The parent lights up for its own page; on a sub-module page the
        // child carries the highlight instead so only one row reads as
        // "you are here".
        const active = sectionActive && !childActive;
        return (
          <div key={href}>
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
      })}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  // One flat strip on a phone: sub-modules sit right after their parent.
  const items = NAV.flatMap((item) => [item, ...(item.children ?? [])]);

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
