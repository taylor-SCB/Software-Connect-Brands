// "How I got there is how I go back."
//
// The app keeps a short trail of the dashboard pages visited in this tab.
// A page's Back link points at the previous entry rather than at a fixed
// parent, so a quote opened from a contact goes back to that contact and
// the same quote opened from the Quotes list goes back to the list. The
// sidebar is always there for anyone who gets lost.
//
// Browser-only: sessionStorage is per tab and dies with it, which is
// exactly the lifetime a trail should have.

export type TrailEntry = { href: string; label: string };

const KEY = "scb:trail";
const MAX = 60;

// Pages that exist only to make or change something. They never appear in
// the trail, so creating a quote from a contact and landing on the new
// quote still reads "back to the contact", not "back to the form".
const TRANSIENT = /\/(new|edit)$/;

const SECTION_LABELS: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/contacts": "Contacts",
  "/dashboard/companies": "Companies",
  "/dashboard/deals": "Pipeline",
  "/dashboard/products": "Products",
  "/dashboard/products/ratesheets": "Ratesheets",
  "/dashboard/quotes": "Quotes",
  "/dashboard/contracts": "Contracts",
  "/dashboard/contracts/templates": "Templates",
  "/dashboard/settings": "Settings",
};

function read(): TrailEntry[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as TrailEntry[]) : [];
  } catch {
    return [];
  }
}

// Components read the trail through useSyncExternalStore, so every write
// tells them to look again.
const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(trail: TrailEntry[]) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(trail.slice(-MAX)));
  } catch {
    // Private mode or storage disabled: the Back link falls back to its
    // section list, which is still a sensible place to land.
  }
  listeners.forEach((listener) => listener());
}

export function isTransientPath(pathname: string) {
  return TRANSIENT.test(pathname);
}

export function defaultLabel(pathname: string) {
  return SECTION_LABELS[pathname] ?? "Previous page";
}

// Called on every dashboard page load. Re-visiting the page already on
// top only refreshes its label, so reloads and in-page form submits don't
// stack duplicates.
export function recordVisit(pathname: string, label?: string) {
  if (isTransientPath(pathname)) return;
  const trail = read();
  const top = trail[trail.length - 1];
  if (top && top.href === pathname) {
    if (label && top.label !== label) {
      top.label = label;
      write(trail);
    }
    return;
  }
  trail.push({ href: pathname, label: label ?? defaultLabel(pathname) });
  write(trail);
}

// The page to go back to from `pathname`: the nearest earlier entry that
// isn't this page. Null when the trail is empty (a bookmark, a fresh tab).
export function backTarget(pathname: string): TrailEntry | null {
  const trail = read();
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    if (trail[i].href !== pathname) return trail[i];
  }
  return null;
}

// A string form of backTarget, stable between writes, so a store snapshot
// compares equal when nothing changed.
export function backTargetSnapshot(pathname: string): string {
  const target = backTarget(pathname);
  return target ? JSON.stringify(target) : "";
}

// Going back unwinds the trail to the target, so that a second Back keeps
// retracing rather than bouncing between the same two pages.
export function unwindTo(target: TrailEntry) {
  const trail = read();
  const index = trail.map((entry) => entry.href).lastIndexOf(target.href);
  if (index >= 0) write(trail.slice(0, index + 1));
}
