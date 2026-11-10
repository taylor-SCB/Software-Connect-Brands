"use server";

import { refresh } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { THEMES, type Theme } from "@/lib/theme-names";

// Saves the look a person picked in the header. Only their own row, and
// only one of the three names; anything else is ignored rather than
// stored.
export async function setTheme(theme: Theme): Promise<{ ok: boolean }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !(THEMES as readonly string[]).includes(theme)) return { ok: false };
  await prisma.user.update({ where: { id: userId }, data: { theme } });
  refresh();
  return { ok: true };
}
