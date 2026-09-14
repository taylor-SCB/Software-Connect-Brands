"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSparkles, IconX, IconCheck } from "@/components/icons";
import { FormError } from "@/components/ui";
import { addEnrichCounts, describeFilled, emptyEnrichCounts, FILL_BATCH_SIZE, type EnrichCounts } from "@/lib/enrich";
import { planCompanyFill, fillCompaniesBatch, type CompanyFillPlan } from "./fill-actions";

// "Fill in missing" on the Companies list. Says what it will do first,
// then runs in batches with a progress bar like Import CSV. Only blanks
// are filled and everything filled wears a small "auto" mark.
export function FillMissingButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" data-testid="fill-missing-button">
        <IconSparkles size={14} />
        Fill in missing
      </button>
      {open && <FillDialog onClose={() => setOpen(false)} />}
    </>
  );
}

type Phase =
  | { step: "planning" }
  | { step: "ready"; plan: CompanyFillPlan }
  | { step: "running"; plan: CompanyFillPlan; done: number; totals: EnrichCounts }
  | { step: "finished"; plan: CompanyFillPlan; done: number; totals: EnrichCounts; stopped: boolean; error?: string };

function FillDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ step: "planning" });
  const [planError, setPlanError] = useState("");
  const stopRef = useRef(false);
  const running = phase.step === "running";

  useEffect(() => {
    let cancelled = false;
    planCompanyFill()
      .then((plan) => {
        if (!cancelled) setPhase({ step: "ready", plan });
      })
      .catch(() => {
        if (!cancelled) setPlanError("Couldn't look at your companies just now. Close this and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !running) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  async function run(plan: CompanyFillPlan) {
    stopRef.current = false;
    const totals = emptyEnrichCounts();
    let done = 0;
    setPhase({ step: "running", plan, done, totals: { ...totals } });
    for (let start = 0; start < plan.ids.length; start += FILL_BATCH_SIZE) {
      if (stopRef.current) break;
      const batch = plan.ids.slice(start, start + FILL_BATCH_SIZE);
      let result: Awaited<ReturnType<typeof fillCompaniesBatch>>;
      try {
        result = await fillCompaniesBatch(batch);
      } catch {
        result = { error: "The connection dropped. Open Fill in missing again to carry on where this left off." };
      }
      if ("error" in result) {
        setPhase({ step: "finished", plan, done, totals, stopped: true, error: result.error });
        router.refresh();
        return;
      }
      addEnrichCounts(totals, result);
      done = Math.min(plan.ids.length, start + FILL_BATCH_SIZE);
      setPhase({ step: "running", plan, done, totals: { ...totals } });
    }
    setPhase({ step: "finished", plan, done, totals, stopped: stopRef.current });
    router.refresh();
  }

  return (
    <div className="modal-backdrop" onClick={() => !running && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Fill in missing"
        onClick={(event) => event.stopPropagation()}
        className="card card-lit flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">Fill in missing</h2>
            <p className="faint mt-0.5 text-xs">Tags, phones and websites, from what you already have.</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close" className="btn btn-ghost btn-sm">
            <IconX size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {phase.step === "planning" && !planError && <p className="text-xs">Looking at your companies…</p>}
          <FormError message={planError} />
          {phase.step === "ready" && <Plan plan={phase.plan} />}
          {(phase.step === "running" || phase.step === "finished") && (
            <Progress
              total={phase.plan.ids.length}
              done={phase.done}
              totals={phase.totals}
              finished={phase.step === "finished"}
              stopped={phase.step === "finished" && phase.stopped}
              error={phase.step === "finished" ? phase.error : undefined}
            />
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--border)] px-5 py-3">
          {phase.step === "ready" && phase.plan.ids.length > 0 && (
            <button type="button" onClick={() => run(phase.plan)} className="btn btn-primary btn-sm" data-testid="fill-missing-start">
              <IconSparkles size={13} />
              Start
            </button>
          )}
          {phase.step === "ready" && (
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              {phase.plan.ids.length > 0 ? "Not now" : "Close"}
            </button>
          )}
          {phase.step === "running" && (
            <button type="button" onClick={() => (stopRef.current = true)} className="btn btn-ghost btn-sm" data-testid="fill-missing-stop">
              Stop after this batch
            </button>
          )}
          {phase.step === "finished" && (
            <button type="button" onClick={onClose} className="btn btn-primary btn-sm" data-testid="fill-missing-done">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Plan({ plan }: { plan: CompanyFillPlan }) {
  const { untagged, noPhone, noWebsite } = plan.counts;
  if (plan.ids.length === 0) {
    return (
      <p className="text-sm" data-testid="fill-missing-plan">
        Nothing to fill in. Every company has tags, a phone and a website.
      </p>
    );
  }
  // Only the parts with a count: "tag 40 companies and try to fill in 12
  // phones", never "tag 0 companies and try to fill in 0 phones and 812
  // websites". At least one count is above zero whenever there are ids.
  const fills = [
    noPhone > 0 ? `${noPhone.toLocaleString()} ${noPhone === 1 ? "phone" : "phones"}` : null,
    noWebsite > 0 ? `${noWebsite.toLocaleString()} ${noWebsite === 1 ? "website" : "websites"}` : null,
  ].filter((part): part is string => Boolean(part));
  const work = [
    untagged > 0 ? `tag ${untagged.toLocaleString()} ${untagged === 1 ? "company" : "companies"}` : null,
    fills.length > 0 ? `try to fill in ${fills.join(" and ")}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" and ");
  return (
    <div className="space-y-3 text-sm">
      <p data-testid="fill-missing-plan">
        The app will {work} from your spreadsheet data and the people at each company. Nothing you typed is changed.
        Anything filled in gets a small &ldquo;auto&rdquo; mark until you confirm it.
      </p>
      <p className="faint text-xs">
        A phone is only copied when one person is clearly the main line, or everyone has the same number. A website is
        only copied when everyone&apos;s work email points to the same place. Blanks it can&apos;t be sure about stay blank.
      </p>
      {plan.capped && (
        <p className="text-xs text-[var(--warn)]">
          That&apos;s a lot of companies. This run takes the first {plan.ids.length.toLocaleString()}; open Fill in missing
          again afterwards for the rest.
        </p>
      )}
    </div>
  );
}

function Progress({
  total,
  done,
  totals,
  finished,
  stopped,
  error,
}: {
  total: number;
  done: number;
  totals: EnrichCounts;
  finished: boolean;
  stopped: boolean;
  error?: string;
}) {
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium" data-testid="fill-missing-progress">
            {finished
              ? stopped
                ? `Stopped after ${done.toLocaleString()} of ${total.toLocaleString()} companies`
                : `Looked at ${total.toLocaleString()} companies`
              : `Filling in… ${done.toLocaleString()} of ${total.toLocaleString()} companies`}
          </span>
          <span className="num faint">{percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[rgb(255_255_255/0.08)]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-[var(--brand)] transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        {!finished && <p className="faint mt-1 text-xs">Keep this tab open. Stopping early is fine; open Fill in missing again to finish.</p>}
      </div>

      {finished && !error && !stopped && (
        <div className="flex items-start gap-3 rounded-xl border border-[rgb(52_211_153/0.3)] bg-[rgb(52_211_153/0.09)] px-4 py-3">
          <IconCheck size={16} className="mt-0.5 shrink-0 text-[var(--ok)]" />
          <p className="text-sm font-semibold">Done. Look for the small &ldquo;auto&rdquo; marks in the list.</p>
        </div>
      )}
      {finished && !error && stopped && (
        <p className="text-sm" data-testid="fill-missing-stopped">
          Stopped. Open Fill in missing again to do the rest.
        </p>
      )}
      <FormError message={error} />

      <p className="text-sm" data-testid="fill-missing-summary">
        {/* Every company in a run had a blank, so an empty result is "could
            not", never "nothing to" — that line is the plan's, above. */}
        {describeFilled(totals, "Nothing could be filled in")}
        {finished && totals.stillMissing > 0 && (
          <span className="faint">
            {" "}
            · {totals.stillMissing.toLocaleString()} still {totals.stillMissing === 1 ? "has" : "have"} a blank nobody on file
            could fill
          </span>
        )}
      </p>
    </div>
  );
}
