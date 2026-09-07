import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { DEFAULT_TIME_ZONE } from "@/lib/format";

// Deduped for the lifetime of one render, so a page that needs the
// organization in three places still issues one query.
export const getOrganization = cache(async () => {
  const { organizationId } = await requireSession();
  return prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
});

// Time zone lives on the organization rather than the session token: a
// token minted before the setting changed would otherwise keep rendering
// the old zone until the user logged out and back in.
export async function getTimeZone(): Promise<string> {
  try {
    return (await getOrganization()).timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
