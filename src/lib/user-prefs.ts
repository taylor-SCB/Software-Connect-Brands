import { prisma } from "@/lib/prisma";

// Each person's remembered choices (User.uiPrefs, BDR redesign Nov 11,
// 2026): the calendar's Mine / Team, whether My day's "Team & money" is
// open, and — for the lists — scope, preset, sort and columns. It follows
// the person to their phone the way User.theme does. Written only when the
// person changes something, merged key by key (saveUiPref in
// src/app/dashboard/prefs-actions.ts), and checked when read: anything
// malformed reads as "not set", so the role's default applies.

export type UiPrefs = Record<string, unknown>;

export async function readUiPrefs(userId: string): Promise<UiPrefs> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiPrefs: true } });
  const value = user?.uiPrefs;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UiPrefs) : {};
}

// One remembered choice as one of the allowed values, or null.
export function prefChoice<T extends string>(prefs: UiPrefs, key: string, allowed: readonly T[]): T | null {
  const value = prefs[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function prefFlag(prefs: UiPrefs, key: string): boolean | null {
  const value = prefs[key];
  return typeof value === "boolean" ? value : null;
}
