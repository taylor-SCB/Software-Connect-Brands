"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import {
  backTargetSnapshot,
  recordVisit,
  subscribe,
  unwindTo,
  type TrailEntry,
} from "@/lib/trail";

const noTrail = () => "";

// Back to wherever the user came from (see src/lib/trail.ts). `href` and
// `label` are the fallback — the page's natural parent — used until the
// trail is read and whenever it has nothing earlier to offer. `current`
// is this page's own name, recorded so the *next* page can point back
// here by name.
export function BackLink({
  href,
  label,
  current,
}: {
  href: string;
  label: string;
  current?: string;
}) {
  const pathname = usePathname();

  // Server render and hydration see no trail (the fallback); the client
  // snapshot takes over right after, and refreshes whenever the trail is
  // written to.
  const snapshot = useSyncExternalStore(subscribe, () => backTargetSnapshot(pathname), noTrail);
  const target: TrailEntry | null = snapshot ? (JSON.parse(snapshot) as TrailEntry) : null;

  useEffect(() => {
    recordVisit(pathname, current);
  }, [pathname, current]);

  const destination = target ?? { href, label };

  return (
    <Link
      href={destination.href}
      onClick={() => {
        if (target) unwindTo(target);
      }}
      className="faint mb-3 inline-flex items-center gap-1.5 text-xs hover:text-[var(--text)]"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      {destination.label}
    </Link>
  );
}

// Mounted once in the dashboard layout so list pages (which have no Back
// link of their own) still land in the trail. Runs after any BackLink on
// the page, so a name the page supplied is kept over the generic one.
export function PageTrail() {
  const pathname = usePathname();
  useEffect(() => {
    recordVisit(pathname);
  }, [pathname]);
  return null;
}
