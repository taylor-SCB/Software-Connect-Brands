"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { logout } from "@/app/dashboard/actions";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { LookSwitch } from "@/components/look-switch";
import type { Theme } from "@/lib/theme-names";
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
  IconTag,
  IconUsers as IconAccount,
  IconLogout,
  IconSparkles,
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
      // Industry, Company Type, Lead Label and Job Title values with
      // Rename / Merge into / Retire (Nov 10, 2026).
      { href: "/dashboard/labels", label: "Labels", Icon: IconTag },
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

// `/dashboard` would otherwise light up on every child route, so the
// index link matches exactly while section links match their subtree.
function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// A Member's Settings opens My Account (BDR redesign, Nov 11, 2026):
// Branding is an Owner's page. The link is the only thing that changes;
// the section and its two pages are the same for everyone.
const MEMBER_SETTINGS = "/dashboard/settings/account";

// `open`: every section's sub-pages shown, not just the active one's (the
// phone's More sheet lists the whole tree).
export function SidebarNav({ member = false, open = false, onNavigate }: { member?: boolean; open?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Sections">
      {NAV.map((entry) =>
        "group" in entry ? (
          <div key={entry.group} className="mt-3 flex flex-col gap-0.5" data-testid="nav-group">
            <p className="faint px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em]">{entry.group}</p>
            {entry.items.map((item) => (
              <Section key={item.href} item={item} pathname={pathname} member={member} open={open} onNavigate={onNavigate} />
            ))}
          </div>
        ) : (
          <Section key={entry.href} item={entry} pathname={pathname} member={member} open={open} onNavigate={onNavigate} />
        ),
      )}
    </nav>
  );
}

function Section({
  item: { href, label, Icon, children },
  pathname,
  member,
  open,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  member: boolean;
  open: boolean;
  onNavigate?: () => void;
}) {
  const sectionActive = isActive(pathname, href);
  const linkHref = member && href === "/dashboard/settings" ? MEMBER_SETTINGS : href;
  const childActive = children?.find((child) => isActive(pathname, child.href));
  // The parent lights up for its own page; on a sub-module page the
  // child carries the highlight instead so only one row reads as
  // "you are here".
  const active = sectionActive && !childActive;
  return (
    <div>
      <Link
        href={linkHref}
        aria-current={active ? "page" : undefined}
        className={`nav-item pointer-coarse:min-h-11 ${active ? "nav-item-active" : ""}`}
        onClick={onNavigate}
        data-testid="nav-link"
        data-href={href}
      >
        <Icon size={16} className={active ? "" : "opacity-70"} />
        {label}
      </Link>
      {children && (sectionActive || open) && (
        <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--hairline-3)] pl-2">
          {children.map((child) => {
            const on = child === childActive;
            return (
              <Link
                key={child.href}
                href={child.href}
                aria-current={on ? "page" : undefined}
                className={`nav-item py-1.5 text-[0.8rem] pointer-coarse:min-h-11 ${on ? "nav-item-active" : ""}`}
                onClick={onNavigate}
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

// The phone's navigation (BDR redesign, Nov 11, 2026; release 5): a fixed
// 56px tab bar along the bottom — Today · Contacts · Companies · Pipeline
// · More — in place of the sideways strip of every link. More opens the
// whole sidebar tree in today's order and names, then Dark / Light, then
// Log out, which asks first. Nothing is removed: every link the strip had
// is in More. Hidden from lg up, where the sidebar is.
const TABS = [
  { href: "/dashboard", label: "Today", Icon: IconGrid },
  { href: "/dashboard/contacts", label: "Contacts", Icon: IconUsers },
  { href: "/dashboard/companies", label: "Companies", Icon: IconBuilding },
  { href: "/dashboard/deals", label: "Pipeline", Icon: IconTrending },
] as const;

export function PhoneTabBar({
  member,
  theme,
  workspace,
  operator,
}: {
  member: boolean;
  theme: Theme;
  workspace: string;
  operator: boolean;
}) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pending, start] = useTransition();
  const tab = TABS.find((item) => isActive(pathname, item.href));
  const close = () => {
    setMore(false);
    setLeaving(false);
  };

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hairline-3)] bg-[var(--overlay)] pb-[env(safe-area-inset-bottom,0px)] lg:hidden"
        aria-label="Main"
        data-testid="phone-tabs"
      >
        <div className="mx-auto grid h-14 max-w-xl grid-cols-5">
          {TABS.map(({ href, label, Icon }) => {
            const on = tab?.href === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                className={`flex min-w-0 flex-col items-center justify-center gap-0.5 text-[0.68rem] font-medium ${on ? "text-[var(--brand)]" : "muted"}`}
                data-testid="phone-tab"
                data-href={href}
              >
                <Icon size={18} />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMore(true)}
            aria-current={tab ? undefined : "page"}
            aria-haspopup="dialog"
            className={`flex min-w-0 flex-col items-center justify-center gap-0.5 text-[0.68rem] font-medium ${tab ? "muted" : "text-[var(--brand)]"}`}
            data-testid="phone-more"
          >
            <IconLayers size={18} />
            More
          </button>
        </div>
      </nav>
      <Sheet open={more} onClose={close} title="More" eyebrow={workspace} testId="phone-more-sheet">
        <SidebarNav member={member} open onNavigate={close} />
        <div className="mt-4 space-y-3 border-t border-[var(--hairline-3)] pt-4">
          {operator && (
            <Link href="/admin" className="nav-item pointer-coarse:min-h-11" onClick={close}>
              <IconSparkles size={15} className="opacity-70" />
              Operator console
            </Link>
          )}
          <div className="flex items-center justify-between gap-3 px-1">
            <span className="text-sm">Look</span>
            <LookSwitch key={theme} theme={theme} className="inline-flex" />
          </div>
          {leaving ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] p-3" role="group" aria-label="Log out?" data-testid="logout-confirm">
              <span className="min-w-0 flex-1 text-sm">Log out of {workspace}?</span>
              <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={() => setLeaving(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm min-h-11"
                disabled={pending}
                onClick={() => start(async () => void (await logout()))}
                data-testid="logout-yes"
              >
                {pending ? "Logging out…" : "Yes, log out"}
              </button>
            </div>
          ) : (
            <button type="button" className="nav-item w-full min-h-11 text-left" onClick={() => setLeaving(true)} data-testid="phone-logout">
              <IconLogout size={15} className="opacity-70" />
              Log out
            </button>
          )}
        </div>
      </Sheet>
    </>
  );
}
