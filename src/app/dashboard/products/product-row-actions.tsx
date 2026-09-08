"use client";

import Link from "next/link";
import { IconCopy } from "@/components/icons";
import { DeleteButton } from "@/components/delete-button";
import { cloneProduct, deleteProduct } from "./actions";

// Edit / Clone / Delete on a products row. Edit and Clone share the ghost
// style; Delete is the red trash icon with an inline confirm.
export function ProductRowActions({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Link href={`/dashboard/products/${productId}`} className="btn btn-ghost btn-sm">
        Edit
      </Link>
      <form action={cloneProduct}>
        <input type="hidden" name="productId" value={productId} />
        <button type="submit" className="btn btn-ghost btn-sm" title="Make a copy to edit">
          <IconCopy size={12} />
          Clone
        </button>
      </form>
      <DeleteButton
        action={deleteProduct}
        hiddenName="productId"
        hiddenValue={productId}
        label={`Delete ${productName}`}
        question={`Delete ${productName}?`}
        note="Quotes already built keep their own copy of the name and price."
      />
    </div>
  );
}
