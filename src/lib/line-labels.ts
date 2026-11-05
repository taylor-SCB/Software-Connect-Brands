import { lineGroupsFor } from "@/lib/variations";
import { picturesFor } from "@/lib/product-images";
import type { LineProductLabels } from "@/lib/variation-shared";

// For a quote line's pickers: each product's live labels (units left out)
// and its pictures, main first. Two queries for any number of products.
export async function lineLabelsFor(organizationId: string, productIds: string[]) {
  const ids = [...new Set(productIds)];
  const [groups, pictures] = await Promise.all([lineGroupsFor(organizationId, ids), picturesFor(organizationId, ids)]);
  const out: Record<string, LineProductLabels> = {};
  for (const id of ids) {
    const groupList = groups.get(id) ?? [];
    const pictureList = (pictures.get(id) ?? []).map(({ id: pictureId, token, colorOptionId }) => ({
      id: pictureId,
      token,
      colorOptionId,
    }));
    if (groupList.length || pictureList.length) out[id] = { groups: groupList, pictures: pictureList };
  }
  return out;
}
