import { prisma } from "@/lib/prisma";

/** How every screen in the app files an address: trimmed, lower case. */
export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

/**
 * The account behind a typed address, matched without regard to case.
 *
 * Signing up files an address lower-cased, and so does every other form
 * that stores one — but the login check used to look the row up by exactly
 * what was typed. A phone capitalises the first letter of a text box by
 * default, so "Taylor@..." never matched the stored "taylor@...", and the
 * screen said "Invalid email or password" to someone whose password was
 * right all along (Sept 17, 2026). There is no password reset yet, so that
 * dead end locks a person out of their own workspace for good.
 *
 * Exact match first, so a workspace holding two spellings still gets the
 * row it asked for; the case-insensitive pass is only the fallback, and it
 * takes the oldest match so the answer never depends on row order.
 */
export async function findLoginUser(typed: string) {
  const email = normalizeEmail(typed);

  const select = {
    id: true,
    name: true,
    email: true,
    passwordHash: true,
    organizationId: true,
    role: true,
    isSuperAdmin: true,
    organization: { select: { status: true } },
  } as const;

  const exact = await prisma.user.findUnique({ where: { email }, select });
  if (exact) return exact;

  return prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select,
    orderBy: { createdAt: "asc" },
  });
}
