"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerProofsAction } from "./actions";

// The answers to every proof waiting on the page: Approve or Ask for
// changes on each (with what to change), one name, and for an approval the
// tick that says the spelling, colours and placement were checked.
export function ProofAnswers({
  token,
  proofs,
}: {
  token: string;
  proofs: { versionId: string; label: string }[];
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Record<string, "approve" | "changes" | undefined>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const approving = proofs.filter((proof) => choice[proof.versionId] === "approve");
  const changing = proofs.filter((proof) => choice[proof.versionId] === "changes");

  function submit() {
    setError(null);
    start(async () => {
      const result = await answerProofsAction({
        token,
        name,
        confirmed,
        approve: approving.map((proof) => proof.versionId),
        changes: changing.map((proof) => ({ versionId: proof.versionId, note: notes[proof.versionId] ?? "" })),
      });
      if ("error" in result) {
        setError(result.error);
        router.refresh();
        return;
      }
      setDone(changing.length ? "Thanks. We'll make the changes and send you a new proof." : "Thanks. Your approval is recorded.");
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="card card-lit p-5 text-sm" role="status" data-testid="pf-done">
        {done}
      </div>
    );
  }

  if (!proofs.length) {
    return error ? (
      <p className="card p-5 text-sm text-[var(--danger)]" role="alert" data-testid="pf-error">
        {error}
      </p>
    ) : null;
  }

  return (
    <div className="card card-lit space-y-4 p-5" data-testid="pf-answers">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Your answer</h2>
        {proofs.length > 1 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setChoice(Object.fromEntries(proofs.map((proof) => [proof.versionId, "approve" as const])))}
            data-testid="pf-approve-all"
          >
            Approve all
          </button>
        )}
      </div>
      <ul className="space-y-3">
        {proofs.map((proof) => (
          <li key={proof.versionId} className="space-y-2" data-testid="pf-answer" data-version={proof.versionId}>
            <p className="text-sm font-medium">{proof.label}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`btn btn-sm min-h-11 ${choice[proof.versionId] === "approve" ? "btn-primary" : "btn-ghost"}`}
                aria-pressed={choice[proof.versionId] === "approve"}
                onClick={() => setChoice({ ...choice, [proof.versionId]: "approve" })}
                data-testid="pf-approve"
              >
                Approve
              </button>
              <button
                type="button"
                className={`btn btn-sm min-h-11 ${choice[proof.versionId] === "changes" ? "btn-primary" : "btn-ghost"}`}
                aria-pressed={choice[proof.versionId] === "changes"}
                onClick={() => setChoice({ ...choice, [proof.versionId]: "changes" })}
                data-testid="pf-changes"
              >
                Ask for changes
              </button>
            </div>
            {choice[proof.versionId] === "changes" && (
              <textarea
                className="input min-h-20"
                maxLength={1000}
                placeholder="What should we change?"
                value={notes[proof.versionId] ?? ""}
                onChange={(event) => setNotes({ ...notes, [proof.versionId]: event.target.value })}
                aria-label={`What to change on ${proof.label}`}
                data-testid="pf-note"
              />
            )}
          </li>
        ))}
      </ul>
      <label className="block text-sm">
        <span className="label">Your name</span>
        <input
          className="input mt-1"
          value={name}
          maxLength={80}
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
          data-testid="pf-name"
        />
      </label>
      {approving.length > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} data-testid="pf-confirm" />
          <span>I&apos;ve checked the spelling, colors and placement. Approve for printing.</span>
        </label>
      )}
      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert" data-testid="pf-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary min-h-11 w-full sm:w-auto"
        disabled={pending || (!approving.length && !changing.length)}
        onClick={submit}
        data-testid="pf-submit"
      >
        {pending ? "Sending…" : "Send my answer"}
      </button>
    </div>
  );
}
