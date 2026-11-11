import { prisma } from "@/lib/prisma";

// Each person's remembered choices (User.uiPrefs, BDR redesign Nov 11,
// 2026). It follows the person to their phone the way User.theme does.
//
// The shape is one object per screen, so two screens (and two coders) never
// trip over each other's keys:
//   { calendar: { scope: "mine" | "team", view: "agenda" | ... },
//     myday: { ... }, lists: { ... } }
// Written only when the person changes something, one key at a time,
// merged key by key inside its namespace (saveUiPref in
// src/app/dashboard/prefs-actions.ts, jsonb in one statement so two tabs
// saving different keys never undo each other), and checked when read:
// anything malformed reads as "not set", so the role's default applies.

export type UiPrefs = Record<string, Record<string, unknown>>;

// Namespaces and keys are short words; the action refuses anything else.
export const PREF_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Every namespace that is an object; anything else stored is dropped.
export function cleanUiPrefs(value: unknown): UiPrefs {
  if (!isObject(value)) return {};
  const out: UiPrefs = {};
  for (const [name, section] of Object.entries(value)) if (isObject(section)) out[name] = section;
  return out;
}

export async function readUiPrefs(userId: string): Promise<UiPrefs> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiPrefs: true } });
  return cleanUiPrefs(user?.uiPrefs);
}

// The same, plus whatever was stored at the top level before the
// namespaced shape (the Stats sprint saved `statsColumns` there, Nov 11,
// 2026). Read only as a fallback when the namespaced key isn't set, so
// nobody loses a saved choice; the next save writes the namespaced one,
// which wins from then on.
export async function readUiPrefsWithLegacy(userId: string): Promise<{ prefs: UiPrefs; legacy: Record<string, unknown> }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiPrefs: true } });
  const raw = user?.uiPrefs;
  const legacy: Record<string, unknown> = {};
  if (isObject(raw)) for (const [key, value] of Object.entries(raw)) if (!isObject(value)) legacy[key] = value;
  return { prefs: cleanUiPrefs(raw), legacy };
}

// One remembered choice as one of the allowed values, or null.
export function prefChoice<T extends string>(prefs: UiPrefs, namespace: string, key: string, allowed: readonly T[]): T | null {
  const value = prefs[namespace]?.[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function prefFlag(prefs: UiPrefs, namespace: string, key: string): boolean | null {
  const value = prefs[namespace]?.[key];
  return typeof value === "boolean" ? value : null;
}

export function prefWords(prefs: UiPrefs, namespace: string, key: string): string[] | null {
  const value = prefs[namespace]?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null;
}
