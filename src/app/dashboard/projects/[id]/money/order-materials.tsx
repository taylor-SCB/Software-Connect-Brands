"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatCents } from "@/lib/format";
import { FormError } from "@/components/ui";
import { IconBox } from "@/components/icons";
import { orderFromSupplier } from "../../actions";

type Supplier = {
  distributorId: string;
  name: string;
  companyId: string | null;
  lines: { id: string; name: string; quantity: number; costCents: number }[];
};

// The materials on this job that have a supplier behind them, and one tap
// to turn them into that supplier's purchase order at what they cost.
export function OrderMaterials({ projectId, suppliers }: { projectId: string; suppliers: Supplier[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();

  if (suppliers.length === 0) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" data-testid="order-materials">
        <IconBox size={13} />
        Order materials
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3">
      <p className="muted text-xs">
        Priced at what the material costs you. Each one becomes a draft purchase order to review and send.
      </p>
      <ul className="space-y-2">
        {suppliers.map((supplier) => (
          <li key={supplier.distributorId} className="flex flex-wrap items-center justify-between gap-2" data-testid="supplier-to-order">
            <div className="min-w-0">
              <p className="text-sm font-medium">{supplier.name}</p>
              <p className="faint num text-xs">
                {supplier.lines.length} {supplier.lines.length === 1 ? "item" : "items"} ·{" "}
                {formatCents(supplier.lines.reduce((sum, line) => sum + line.costCents, 0))}
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(undefined);
                  const result = await orderFromSupplier(projectId, supplier.distributorId);
                  if (result?.error) {
                    setError(result.error);
                    return;
                  }
                  if (result?.contractId) router.push(`/dashboard/contracts/${result.contractId}`);
                  else router.refresh();
                })
              }
              className="btn btn-primary btn-sm"
              data-testid="order-from-supplier"
            >
              Order from {supplier.name}
            </button>
          </li>
        ))}
      </ul>
      <FormError message={error} />
      <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
        Close
      </button>
    </div>
  );
}
