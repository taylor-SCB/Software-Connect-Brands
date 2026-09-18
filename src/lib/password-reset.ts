import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// How long a "forgot password" link lives. Long enough to walk to a
// computer, short enough that an old email in an inbox is not a key.
export const RESET_TTL_MINUTES = 60;

// How many links one account may ask for in an hour. Stops the form being
// used to spray somebody's inbox, and stops it being used as a way to find
// out which addresses have accounts by watching how long a reply takes.
export const RESET_REQUESTS_PER_HOUR = 5;

// The shortest password we will store. Long beats clever: a length floor
// is the one rule that reliably helps and does not push people towards
// "P@ssw0rd!".
export const MIN_PASSWORD_LENGTH = 8;

/** The token that travels in the link. 32 bytes of real entropy. */
function newToken() {
  return randomBytes(32).toString("base64url");
}

/** What we store. The token itself never touches the database. */
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Start a reset for an address, and return the token to email.
 *
 * Returns null when there is nothing to do — no such account, or the
 * account has asked too many times in the last hour. The caller must say
 * exactly the same thing either way, so this form can never be used to
 * work out who has an account here.
 */
export async function createPasswordReset(
  email: string,
): Promise<{ token: string; user: { id: string; name: string; email: string } } | null> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim().toLowerCase(), mode: "insensitive" } },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  if (!user) return null;

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.passwordReset.count({
    where: { userId: user.id, createdAt: { gte: since } },
  });
  if (recent >= RESET_REQUESTS_PER_HOUR) return null;

  const token = newToken();
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
    },
  });

  return { token, user };
}

export type ResetLookup =
  | { ok: true; resetId: string; userId: string; email: string }
  | { ok: false; reason: "unknown" | "used" | "expired" };

/**
 * Look a link up without spending it, so the page can decide what to show
 * before asking someone to type a new password twice.
 */
export async function findPasswordReset(token: string): Promise<ResetLookup> {
  if (!token) return { ok: false, reason: "unknown" };

  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      usedAt: true,
      expiresAt: true,
      user: { select: { email: true } },
    },
  });

  if (!row) return { ok: false, reason: "unknown" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  return { ok: true, resetId: row.id, userId: row.userId, email: row.user.email };
}

/**
 * Spend the link and set the new password.
 *
 * The update is conditional on the row still being unused, and both writes
 * share one transaction: two taps on a slow phone must not be able to set
 * the password twice from one link.
 */
export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; reason: "unknown" | "used" | "expired" | "weak" }> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "weak" };

  const found = await findPasswordReset(token);
  if (!found.ok) return found;

  const passwordHash = await bcrypt.hash(newPassword, 10);

  const spent = await prisma.$transaction(async (tx) => {
    const claim = await tx.passwordReset.updateMany({
      where: { id: found.resetId, usedAt: null },
      data: { usedAt: new Date() },
    });
    // Somebody else got there first between the lookup and here.
    if (claim.count !== 1) return false;

    await tx.user.update({ where: { id: found.userId }, data: { passwordHash } });

    // Every other outstanding link for this account dies with it. If the
    // request was made because somebody else had got into the inbox, the
    // spare links in there should not still work.
    await tx.passwordReset.updateMany({
      where: { userId: found.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return true;
  });

  return spent ? { ok: true } : { ok: false, reason: "used" };
}

/** Constant-time compare, for anything that comes off a request. */
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
