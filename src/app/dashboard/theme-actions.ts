"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, isTheme, type Theme } from "@/lib/theme-names";

// Saves the look picked on the switch. Always remembered in this browser
// (so the login page matches); for a signed-in person also saved on their
// own row, which is what follows them to the phone. Only the two names
// are taken; anything else is ignored rather than stored.
export async function setTheme(theme: Theme): Promise<{ ok: boolean }> {
  if (!isTheme(theme)) return { ok: false };
  const store = await cookies();
  store.set(THEME_COOKIE, theme, { path: "/", maxAge: THEME_COOKIE_MAX_AGE, sameSite: "lax" });
  const session = await auth();
  const userId = session?.user?.id;
  if (userId) await prisma.user.update({ where: { id: userId }, data: { theme } });
  refresh();
  return { ok: true };
}
