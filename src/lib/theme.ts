import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { THEME_COOKIE, isTheme, parseTheme, type Theme } from "@/lib/theme-names";

export { THEMES, THEME_LABELS, parseTheme, type Theme } from "@/lib/theme-names";

// The look this browser picked while signed out (or last showed).
export async function cookieTheme(): Promise<Theme> {
  const store = await cookies();
  return parseTheme(store.get(THEME_COOKIE)?.value);
}

// A signed-in person's look: what they saved wins; someone who has never
// picked gets whatever this browser picked on the login page. A stored
// value that is not one of the two names (an old "bright") reads Dark.
// One read per request however many layouts ask.
export const themeFor = cache(async (userId: string): Promise<Theme> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { theme: true } });
  if (user?.theme == null) return cookieTheme();
  return isTheme(user.theme) ? user.theme : "dark";
});
