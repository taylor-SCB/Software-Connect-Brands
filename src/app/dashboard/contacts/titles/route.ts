import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { cleanSearch } from "@/lib/list-params";

// The Job title filter's choices (Nov 10, 2026): the workspace's distinct
// titles, ignoring case and outer spaces, most common first, each with how
// many people carry it and the spelling most of them use. Fifty at a time,
// narrowed by what is typed.
export async function GET(request: Request) {
  const { organizationId } = await requireSession();
  const q = cleanSearch(new URL(request.url).searchParams.get("q") ?? "").slice(0, 60);
  const rows = await prisma.$queryRaw<{ name: string; count: number }[]>`
    SELECT mode() WITHIN GROUP (ORDER BY btrim(title)) AS name, count(*)::int AS count
      FROM "Contact"
     WHERE "organizationId" = ${organizationId} AND btrim(coalesce(title, '')) <> ''
       ${q ? Prisma.sql`AND title ILIKE ${`%${q}%`}` : Prisma.empty}
     GROUP BY lower(btrim(title))
     ORDER BY count DESC, name
     LIMIT 50`;
  return NextResponse.json(rows);
}
