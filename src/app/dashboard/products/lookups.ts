import { prisma } from "@/lib/prisma";

// The two pick lists on the product form, scoped to the workspace. Both
// pages that render the form need the same shape, so it lives here.
export async function loadProductLookups(organizationId: string) {
  const [manufacturers, distributors] = await Promise.all([
    prisma.manufacturer.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.distributor.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        contacts: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    }),
  ]);
  return { manufacturers, distributors };
}
