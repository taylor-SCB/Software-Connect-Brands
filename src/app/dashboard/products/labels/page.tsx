import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { getVariationGroups } from "@/lib/variations";
import { ProductsSubnav } from "../products-subnav";
import { LabelsManager } from "./labels-manager";

// Labels & Units (Release 3b): the workspace's label groups — Unit, Color
// and Size built in, its own beside them — and its own units. Anyone adds;
// an Owner or Admin renames, retires, brings back and reorders.
export default async function LabelsPage() {
  const { organizationId, role } = await requireSession();
  const [groups, usage, ownUnitUsage] = await Promise.all([
    getVariationGroups(organizationId, { includeArchived: true }),
    prisma.productVariation.groupBy({ by: ["optionId"], where: { organizationId }, _count: { _all: true } }),
    prisma.product.groupBy({
      by: ["customUnitId"],
      where: { organizationId, customUnitId: { not: null }, unitOfMeasure: null },
      _count: { _all: true },
    }),
  ]);
  const counts: Record<string, number> = {};
  for (const row of usage) counts[row.optionId] = row._count._all;
  for (const row of ownUnitUsage) {
    if (row.customUnitId) counts[row.customUnitId] = Math.max(counts[row.customUnitId] ?? 0, row._count._all);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Labels & Units"
        subtitle="The colors, sizes and other labels your products come in, and your own units. A quote line picks one of each."
      />
      <ProductsSubnav current="labels" />
      <LabelsManager groups={groups} counts={counts} canManage={role === "OWNER" || role === "ADMIN"} />
    </div>
  );
}
