import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { parseTheme, type Theme } from "@/lib/theme-names";

export { THEMES, THEME_LABELS, parseTheme, type Theme } from "@/lib/theme-names";

// The person's saved look, read once per request however many layouts ask.
export const themeFor = cache(async (userId: string): Promise<Theme> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { theme: true } });
  return parseTheme(user?.theme);
});
