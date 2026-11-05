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
  // How many products have each label: ticked on the Variations card, or
  // a unit as the product's own unit (a workspace one, or a built-in one),
  // each product counted once.
  const [groups, usage] = await Promise.all([
    getVariationGroups(organizationId, { includeArchived: true }),
    prisma.$queryRaw<{ optionId: string; n: bigint }[]>`
      SELECT used.oid AS "optionId", count(DISTINCT used.pid) AS n FROM (
        SELECT "optionId" AS oid, "productId" AS pid FROM "ProductVariation" WHERE "organizationId" = ${organizationId}
        UNION
        SELECT "customUnitId", id FROM "Product"
         WHERE "organizationId" = ${organizationId} AND "customUnitId" IS NOT NULL AND "unitOfMeasure" IS NULL
        UNION
        SELECT o.id, p.id FROM "Product" p
          JOIN "VariationOption" o ON o."organizationId" = p."organizationId" AND o."builtInUnit" = p."unitOfMeasure"
         WHERE p."organizationId" = ${organizationId} AND p."unitOfMeasure" IS NOT NULL
      ) used
      GROUP BY used.oid`,
  ]);
  const counts: Record<string, number> = {};
  for (const row of usage) counts[row.optionId] = Number(row.n);

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
