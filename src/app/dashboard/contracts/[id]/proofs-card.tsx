"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setContractProofsAction } from "@/app/dashboard/proofs/actions";

type Choice = {
  versionId: string;
  token: string;
  number: number;
  version: number;
  current: boolean;
  productName: string;
  colorLabel: string | null;
  status: string;
  onRows: boolean;
  held: boolean;
};

const STATUS: Record<string, string> = {
  SENT: "waiting for their answer",
  APPROVED: "approved",
  CHANGES: "changes asked",
  SUPERSEDED: "replaced by a newer version",
};

// The apparel pack (Nov 12, 2026): which of the quote's proofs this contract
// carries. The customer's Sales Order and the printer's order take them;
// a blank-garment supplier's order shouldn't. Changed only while a draft.
export function ContractProofsCard({ contractId, choices, editable }: { contractId: string; choices: Choice[]; editable: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState(() => new Set(choices.filter((choice) => choice.held).map((choice) => choice.versionId)));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const changed = choices.some((choice) => choice.held !== picked.has(choice.versionId));

  return (
    <div className="space-y-3 p-5" data-testid="contract-proofs">
      {choices.length === 0 ? (
        <p className="faint text-sm">No proof on its quote has gone out yet.</p>
      ) : (
        <ul className="space-y-2">
          {choices.map((choice) => (
            <li key={choice.versionId}>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  disabled={!editable || pending}
                  checked={picked.has(choice.versionId)}
                  onChange={(event) => {
                    setSaved(false);
                    const next = new Set(picked);
                    if (event.target.checked) next.add(choice.versionId);
                    else next.delete(choice.versionId);
                    setPicked(next);
                  }}
                  data-testid="contract-proof"
                  data-proof={choice.number}
                  data-version={choice.version}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/files/${choice.token}?v=thumb`} alt="" className="h-10 w-14 rounded border border-[var(--hairline-2)] bg-white object-contain" />
                <span className="min-w-0">
                  <span className="block font-medium">
                    Proof {choice.number}
                    {choice.version > 1 || !choice.current ? ` (v${choice.version})` : ""} · {choice.productName}
                    {choice.colorLabel ? ` · ${choice.colorLabel}` : ""}
                  </span>
                  <span className="faint block text-xs">
                    {STATUS[choice.status] ?? choice.status.toLowerCase()}
                    {choice.onRows ? " · on this contract's rows" : ""}
                    {choice.held && !choice.current ? " · on this contract now" : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {!editable && <p className="faint text-xs">Proofs change only while the contract is a draft.</p>}
      {editable && choices.length > 0 && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!changed || pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await setContractProofsAction(contractId, [...picked]);
              if ("error" in result && result.error) {
                setError(result.error);
                return;
              }
              setSaved(true);
              router.refresh();
            })
          }
          data-testid="contract-proofs-save"
        >
          Save
        </button>
      )}
      {saved && !changed && <p className="text-xs text-[var(--ok)]" role="status">Saved.</p>}
      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
