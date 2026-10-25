"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { linkDistributorCompany } from "@/lib/distributors";
import { linkPlatformSupplier } from "@/lib/platform-suppliers";

// "+ Add new distributor" from a quote line's Supplier / Contractor box.
// Makes both halves — the Company the CRM knows and the Distributor record
// the Products page and purchase orders use — so the same business is
// pickable from either side rather than existing twice.
export async function addDistributorCompany(
  name: string,
): Promise<{ error?: string; company?: { id: string; name: string } }> {
  const { organizationId } = await requireSession();

  const typed = typeof name === "string" ? name.trim() : "";
  if (!typed) return { error: "Type the supplier's name" };
  if (typed.length > 160) return { error: "That name is too long" };

  const linked = await linkDistributorCompany(organizationId, typed);
  if (!linked) return { error: "Type the supplier's name" };

  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/products");

  return { company: { id: linked.companyId, name: linked.name } };
}

// A supplier picked from "On Software Connect Brands" on a quote line:
// this workspace's own supplier for that account — both halves, linked to
// it — so the line, like every other, points at a Company.
export async function addPlatformSupplier(
  platformOrganizationId: string,
): Promise<{ error?: string; company?: { id: string; name: string } }> {
  const { organizationId } = await requireSession();
  if (typeof platformOrganizationId !== "string" || platformOrganizationId.length > 60) {
    return { error: "Pick the supplier again." };
  }

  const linked = await linkPlatformSupplier(organizationId, platformOrganizationId);
  if (!linked.ok) return { error: linked.error };

  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/products");

  return { company: { id: linked.companyId, name: linked.name } };
}
