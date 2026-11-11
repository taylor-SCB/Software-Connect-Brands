import { prisma } from "@/lib/prisma";
import {
  LIST_SCOPES,
  LIST_SORTS,
  VIEW_KEYS,
  presetsFor,
  type ListLock,
  type ListParams,
  type ListScope,
  type ListSort,
} from "@/lib/list-params";
import { CONTACT_COLUMNS, COMPANY_COLUMNS, DEFAULT_COLUMNS, type ListKind } from "@/lib/list-columns";

// What each person last chose on the Contacts and Companies lists (BDR
// redesign, Nov 11, 2026): scope (Mine / Everyone / Unowned), preset, sort
// and the extra columns. Kept in User.uiPrefs under namespaced keys —
// "contacts.scope", "companies.columns" — the same shape as the My day
// and calendar choices (src/lib/user-prefs.ts on the today branch), written
// one key at a time with jsonb || (saveListPrefs in
// src/app/dashboard/user-prefs-actions.ts) and checked when read: anything
// malformed reads as "not set", so the role's default applies.

type Prefs = Record<string, unknown>;

async function readPrefs(userId: string): Promise<Prefs> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiPrefs: true } });
  const value = user?.uiPrefs;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Prefs) : {};
}

function choice<T extends string>(prefs: Prefs, key: string, allowed: readonly T[]): T | null {
  const value = prefs[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export type ListView = {
  params: ListParams;
  columns: string[];
  // Members open on Mine and the call list; Owners and Admins on Everyone.
  member: boolean;
};

// Fills in scope, preset and sort for a page view. An address that carries
// any filter, search or page is a link someone made: it opens as written,
// and without a scope it reads Everyone, which is how every link made
// before Nov 11, 2026 was read. A bare address opens on the person's last
// choice, else their role's default. A sub-pane (Favorites, With deals,
// Interested) never opens on a saved preset: it is already a narrowed view.
export async function resolveListView(
  kind: ListKind,
  raw: Record<string, string | string[] | undefined>,
  parsed: ListParams,
  viewer: { userId: string; role: string },
  lock: ListLock = {},
): Promise<ListView> {
  const prefs = await readPrefs(viewer.userId);
  const member = viewer.role === "MEMBER";
  const bare = !VIEW_KEYS.some((key) => raw[key] !== undefined);
  const locked = Boolean(lock.fav || lock.deals || lock.interested);
  const presets = presetsFor(kind);

  const params: ListParams = { ...parsed, me: viewer.userId };
  if (!presets.includes(params.preset)) params.preset = "";

  if (bare) {
    params.scope = choice<ListScope>(prefs, `${kind}.scope`, LIST_SCOPES) ?? (member ? "mine" : "all");
    if (!locked) {
      const saved = choice(prefs, `${kind}.preset`, [...presets, "none"]);
      params.preset = saved === "none" ? "" : saved ?? (member && kind === "contacts" ? "call" : "");
    }
    params.sort = choice<ListSort>(prefs, `${kind}.sort`, LIST_SORTS) ?? "";
  } else if (!params.scope) {
    params.scope = "all";
  }

  const allowed = kind === "contacts" ? CONTACT_COLUMNS : COMPANY_COLUMNS;
  const saved = prefs[`${kind}.columns`];
  const columns = Array.isArray(saved)
    ? saved.filter((key): key is string => typeof key === "string" && (allowed as readonly string[]).includes(key))
    : [...DEFAULT_COLUMNS[kind]];
  return { params, columns, member };
}
