"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatCents, dollarsToCents } from "@/lib/format";
import { lineNetCents } from "@/lib/quote-math";
import { Card, CardHeader, Meter, Badge, FormError } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { adjustAward, deleteScope, moveLineToScope, updateScope } from "../actions";

type Award = { id: string; kind: string; deltaCents: number; note: string; createdAt: string };
type Line = {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  tag: string;
  contract: { id: string; number: number; type: string; payable: boolean; status: string };
};

export type ScopeView = {
  id: string;
  name: string;
  serviceType: string | null;
  description: string;
  crewLabel: string | null;
  // The crew on it, when one from the workspace's list is assigned. Set
  // on the Crew & time tab; the typed label below is the fallback for a
  // one-off sub nobody wants to set up as a crew.
  crewName: string | null;
  isDefault: boolean;
  awardedCents: number;
  spentCents: number;
  committedCents: number;
  receivedCents: number;
  billedCents: number;
  plannedCostCents: number;
  awards: Award[];
  lineItems: Line[];
  tagTotals: { tag: string; label: string; cents: number }[];
};

const AWARD_LABELS: Record<string, string> = {
  CONTRACT: "Signed agreement",
  CHANGE_ORDER: "Change order",
  CONTRACT_REMOVED: "Paperwork removed",
  QUOTE: "From the quote",
  MANUAL: "Changed by hand",
};

// One scope of work: its bar, what it has collected, what it is made of,
// and why the awarded number is what it is.
export function ScopeCard({
  scope,
  scopeOptions,
  serviceTypes,
}: {
  scope: ScopeView;
  scopeOptions: { id: string; name: string }[];
  serviceTypes: string[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const [crew, setCrew] = useState(scope.crewLabel ?? "");
  const [adjust, setAdjust] = useState({ open: false, amount: "", note: "" });

  const left = scope.awardedCents - scope.spentCents - scope.committedCents;
  const used = scope.spentCents + scope.committedCents;

  const run = (action: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      const result = await action();
      if (result?.error) setError(result.error);
    });

  return (
    <Card lit>
      <CardHeader
        title={scope.name}
        subtitle={scope.serviceType ?? (scope.isDefault ? "Anything with no service type on it" : undefined)}
        actions={
          <div className="flex items-center gap-2">
            {/* A crew off the workspace's list wins over a typed name, and
                is changed where the crews are — on the Crew & time tab. */}
            {scope.crewName ? (
              <span className="muted text-xs" data-testid="scope-crew-name">
                {scope.crewName}
              </span>
            ) : (
              <label className="block text-xs">
                <span className="faint sr-only">Crew</span>
                <input
                  value={crew}
                  onChange={(event) => setCrew(event.target.value)}
                  onBlur={() => {
                    if ((scope.crewLabel ?? "") !== crew) run(() => updateScope(scope.id, { crewLabel: crew }));
                  }}
                  placeholder="Crew or sub"
                  aria-label={`Crew on ${scope.name}`}
                  className="input input-sm w-36"
                  data-testid="scope-crew"
                />
              </label>
            )}
            {!scope.isDefault && (
              <button
                type="button"
                onClick={() => run(() => deleteScope(scope.id))}
                disabled={pending}
                aria-label={`Remove ${scope.name}`}
                className="btn btn-ghost btn-sm !px-1.5"
                data-testid="scope-delete"
              >
                <IconTrash size={13} />
              </button>
            )}
          </div>
        }
      />

      <div className="space-y-3 p-5" data-testid="scope-card" data-scope-id={scope.id}>
        <Meter
          max={scope.awardedCents}
          segments={[
            { cents: scope.spentCents, tone: "spent" },
            { cents: scope.committedCents, tone: "committed" },
          ]}
          label={`${formatCents(used)} of ${formatCents(scope.awardedCents)} used on ${scope.name}`}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="muted">
            Awarded{" "}
            <span className="num font-medium" data-testid="scope-awarded" data-cents={scope.awardedCents}>
              {formatCents(scope.awardedCents)}
            </span>
          </span>
          <span className="muted">
            Spent <span className="num font-medium">{formatCents(scope.spentCents)}</span>
          </span>
          <span className="muted">
            Committed <span className="num font-medium">{formatCents(scope.committedCents)}</span>
          </span>
          <span className="muted">
            Left{" "}
            <span
              className={`num font-medium ${left < 0 ? "text-[var(--danger)]" : ""}`}
              data-testid="scope-left"
              data-cents={left}
            >
              {left < 0 ? `Over by ${formatCents(-left)}` : formatCents(left)}
            </span>
          </span>
        </div>

        {scope.billedCents > 0 && (
          <div>
            <Meter
              height={8}
              max={scope.billedCents}
              segments={[{ cents: scope.receivedCents, tone: "spent" }]}
              label={`${formatCents(scope.receivedCents)} of ${formatCents(scope.billedCents)} collected`}
            />
            <p className="faint num mt-1 text-[0.68rem]">
              Collected {formatCents(scope.receivedCents)} of {formatCents(scope.billedCents)} billed
            </p>
          </div>
        )}

        {scope.tagTotals.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[rgb(255_255_255/0.06)] pt-3 text-xs">
            {scope.tagTotals.map((entry) => (
              <span key={entry.tag} className="muted">
                {entry.label} <span className="num font-medium">{formatCents(entry.cents)}</span>
              </span>
            ))}
          </div>
        )}

        <FormError message={error} />

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setOpen(!open)} className="btn btn-ghost btn-sm" data-testid="scope-expand">
            {open ? "Hide the detail" : `Show the ${scope.lineItems.length} ${scope.lineItems.length === 1 ? "row" : "rows"} and history`}
          </button>
          <button
            type="button"
            onClick={() => setAdjust({ open: !adjust.open, amount: "", note: "" })}
            className="btn btn-ghost btn-sm"
            data-testid="scope-adjust"
          >
            Change the awarded amount
          </button>
        </div>

        {adjust.open && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-2.5">
            <label className="block text-xs">
              <span className="faint block">Add or take off</span>
              <input
                value={adjust.amount}
                onChange={(event) => setAdjust({ ...adjust, amount: event.target.value })}
                placeholder="-500.00"
                inputMode="decimal"
                aria-label="Amount to add or take off"
                className="input input-sm num w-28"
                data-testid="adjust-amount"
              />
            </label>
            <label className="block text-xs">
              <span className="faint block">Why</span>
              <input
                value={adjust.note}
                onChange={(event) => setAdjust({ ...adjust, note: event.target.value })}
                placeholder="Agreed on site, paperwork to follow"
                aria-label="Why the awarded amount is changing"
                className="input input-sm w-72"
                data-testid="adjust-note"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  // dollarsToCents keeps a leading minus, so "-500" is a
                  // credit of $500 without any help here.
                  const result = await adjustAward(scope.id, {
                    amountCents: dollarsToCents(adjust.amount),
                    note: adjust.note,
                  });
                  if (!result?.error) setAdjust({ open: false, amount: "", note: "" });
                  return result;
                })
              }
              className="btn btn-primary btn-sm"
              data-testid="adjust-save"
            >
              Save
            </button>
          </div>
        )}

        {open && (
          <div className="space-y-3 border-t border-[rgb(255_255_255/0.06)] pt-3">
            <div>
              <p className="eyebrow mb-2">Rows on this scope</p>
              {scope.lineItems.length === 0 ? (
                <p className="faint text-xs">Nothing on it yet.</p>
              ) : (
                <ul className="space-y-2">
                  {scope.lineItems.map((line) => (
                    <li key={line.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="scope-line">
                      <div className="min-w-0">
                        <p className="text-sm">{line.name}</p>
                        <p className="faint num text-xs">
                          <Link href={`/dashboard/contracts/${line.contract.id}`} className="link">
                            CON-{line.contract.number}
                          </Link>
                          {" · "}
                          {line.contract.type}
                          {line.contract.payable && (
                            <>
                              {" "}
                              <Badge color="#a78bfa">Money out</Badge>
                            </>
                          )}
                          {" · "}
                          {line.quantity} × {formatCents(line.unitPriceCents)}
                          {line.discountCents ? ` − ${formatCents(line.discountCents)}` : ""} ={" "}
                          {formatCents(lineNetCents(line))}
                        </p>
                      </div>
                      {scopeOptions.length > 1 && (
                        <select
                          value={scope.id}
                          disabled={pending}
                          onChange={(event) => run(() => moveLineToScope(line.id, event.target.value))}
                          aria-label={`Which scope ${line.name} belongs to`}
                          className="select input-sm w-40"
                          data-testid="line-scope"
                        >
                          {scopeOptions.map((option) => (
                            <option key={option.id} value={option.id}>{option.name}</option>
                          ))}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="eyebrow mb-2">Awarded amount, and why</p>
              <ul className="space-y-1 text-xs" data-testid="award-history">
                {scope.awards.length === 0 && <li className="faint">Nothing awarded to this scope yet.</li>}
                {scope.awards.map((award) => (
                  <li key={award.id} className="flex items-baseline justify-between gap-3">
                    <span className="muted">
                      {award.createdAt} · {award.note || AWARD_LABELS[award.kind] || award.kind}
                    </span>
                    <span className="num font-medium">
                      {award.deltaCents < 0 ? "−" : "+"}
                      {formatCents(Math.abs(award.deltaCents))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {scope.plannedCostCents > 0 && (
              <p className="faint text-xs" data-testid="scope-planned-cost">
                Expected cost on file{" "}
                <span className="num font-medium">{formatCents(scope.plannedCostCents)}</span> — from what these
                products cost you. Never shown to a customer.
              </p>
            )}

            <label className="block text-xs">
              <span className="faint block">Scope of work</span>
              <textarea
                defaultValue={scope.description}
                rows={3}
                placeholder="What this covers, in your own words."
                aria-label={`Scope of work for ${scope.name}`}
                onBlur={(event) => {
                  if (event.target.value !== scope.description) {
                    run(() => updateScope(scope.id, { description: event.target.value }));
                  }
                }}
                className="input w-full"
                data-testid="scope-description"
              />
            </label>
          </div>
        )}

        {serviceTypes.length === 0 && null}
      </div>
    </Card>
  );
}
