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
} from "@/components/icons";

const NAV = [
  { href: "/dashboard", label: "Overview", Icon: IconGrid },
  { href: "/dashboard/contacts", label: "Contacts", Icon: IconUsers },
  { href: "/dashboard/deals", label: "Pipeline", Icon: IconTrending },
  { href: "/dashboard/products", label: "Products", Icon: IconBox },
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
      {NAV.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`nav-item ${active ? "nav-item-active" : ""}`}
          >
            <Icon size={16} className={active ? "" : "opacity-70"} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto pb-1">
      {NAV.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
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
