import { prisma } from "@/lib/prisma";
import { DEFAULT_CONTRACT_TEMPLATES } from "@/lib/default-templates";
import { DEFAULT_CONTRACT_TYPES } from "@/lib/constants";
import type { AccountTypeValue } from "@/lib/account-types";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export type NewWorkspace = {
  companyName: string;
  accountType: AccountTypeValue;
  // PENDING for a signup, which the operator reviews; ACTIVE for an
  // account the operator makes from /admin.
  status: "PENDING" | "ACTIVE";
  // The operator who made it, for Create Account.
  createdById?: string | null;
  city?: string | null;
  state?: string | null;
  owner: { name: string; email: string; phone: string | null; passwordHash: string };
};

/**
 * A new workspace with its owner, seeded the way every workspace starts:
 * the contract type list and the six built-in templates. Used by signup
 * and by the operator's Create Account, so the two can never drift apart.
 *
 * Two people can pick the same company name at the same instant, so the
 * unique constraint — not a pre-flight SELECT — is the source of truth:
 * a slug collision retries with -2, -3…; a taken email is reported.
 */
export async function createWorkspace(
  input: NewWorkspace,
): Promise<{ ok: true; organizationId: string; ownerId: string } | { ok: false; reason: "email" | "name" }> {
  const base = slugify(input.companyName) || "workspace";
  const now = new Date();

  // Logins are one address, one account, in any capitalisation; the
  // unique index only catches the exact spelling. lower() rather than an
  // insensitive equals, which is ILIKE and reads the _ in john_doe@ as a
  // wildcard.
  const taken = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User" WHERE lower("email") = lower(${input.owner.email}) LIMIT 1`;
  if (taken.length > 0) return { ok: false, reason: "email" };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const created = await prisma.organization.create({
        data: {
          name: input.companyName,
          slug,
          status: input.status,
          reviewedAt: input.status === "ACTIVE" ? now : null,
          accountType: input.accountType,
          createdById: input.createdById ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          users: {
            create: {
              name: input.owner.name,
              email: input.owner.email,
              phone: input.owner.phone,
              passwordHash: input.owner.passwordHash,
              role: "OWNER",
            },
          },
          contractTypeOptions: {
            create: DEFAULT_CONTRACT_TYPES.map((name) => ({ name })),
          },
          contractTemplates: {
            create: DEFAULT_CONTRACT_TEMPLATES.map((template) => ({
              name: template.name,
              type: template.type,
              description: template.description,
              body: template.body,
              isDefault: true,
              baseline: template.name,
            })),
          },
        },
        select: { id: true, users: { select: { id: true } } },
      });
      return { ok: true, organizationId: created.id, ownerId: created.users[0].id };
    } catch (error) {
      if ((error as { code?: string })?.code !== "P2002") throw error;
      // Through the pg driver adapter Prisma names the constraint under
      // meta.driverAdapterError ("User_email_key"), not meta.target, which
      // is how a taken email at signup used to come back as "try a
      // different name" after five slug retries.
      const detail = JSON.stringify((error as { meta?: unknown })?.meta ?? {});
      if (detail.includes("email")) return { ok: false, reason: "email" };
      if (attempt === 4) return { ok: false, reason: "name" };
    }
  }
  return { ok: false, reason: "name" };
}
