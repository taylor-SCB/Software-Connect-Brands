"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  Field,
  SelectField,
  TextareaField,
  FormError,
  FormSuccess,
} from "@/components/ui";
import { updateQuoteMeta } from "../actions";
import type { ActionState } from "@/lib/forms";
import type { WorkspaceUser } from "@/lib/workspace-users";

export function QuoteMetaForm({
  quoteId,
  defaults,
  users,
}: {
  quoteId: string;
  defaults: {
    title: string;
    template: string;
    introNote: string;
    terms: string;
    validUntil: string;
    leadSalesRepId: string;
    contractSignerId: string;
    teamUserIds: string[];
  };
  users: WorkspaceUser[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateQuoteMeta,
    {},
  );

  // Held here rather than handed back by the server on a refusal. React
  // empties a form whose action is a server function even when it refuses,
  // and the keep-what-was-typed helper can only carry single values — it
  // would lose a multi-select entirely, and would put a deliberately
  // cleared name back, which the next save would then write.
  const [leadSalesRepId, setLeadSalesRepId] = useState(defaults.leadSalesRepId);
  const [contractSignerId, setContractSignerId] = useState(defaults.contractSignerId);
  const [teamUserIds, setTeamUserIds] = useState<string[]>(defaults.teamUserIds);

  // React resets the form's DOM once the action returns. A controlled
  // <select> whose value hasn't changed gets no re-render, so nothing puts
  // it back and it silently shows its first option — which the next save
  // would then write. Hidden inputs survive a reset on their own; these
  // two have to be restored by hand.
  const repRef = useRef<HTMLSelectElement>(null);
  const signerRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (repRef.current) repRef.current.value = leadSalesRepId;
    if (signerRef.current) signerRef.current.value = contractSignerId;
  }, [state, leadSalesRepId, contractSignerId]);

  function toggleTeamMember(id: string) {
    setTeamUserIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  // Everyone except whoever is already named as rep or signer.
  const others = users.filter((user) => user.id !== leadSalesRepId && user.id !== contractSignerId);

  // Once a save has been refused, `kept` is the whole truth about what was
  // in the form: it omits a field that was empty, so a field missing from
  // it was deliberately cleared and must come back empty. Falling back to
  // the stored value there put deleted text straight back on the screen,
  // and the next save would have written it again.
  const was = (field: keyof typeof defaults, fallback: string) =>
    state?.kept ? state.kept[field] ?? "" : fallback;

  return (
    <form action={formAction} className="space-y-4 p-5">
      <input type="hidden" name="quoteId" value={quoteId} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="Quote title" name="title" defaultValue={was("title", defaults.title)} required />
        </div>
        <SelectField
          label="Template"
          name="template"
          defaultValue={was("template", defaults.template)}
          options={[
            { value: "SIMPLE", label: "Simple" },
            { value: "MODERN", label: "Modern" },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Valid until"
          name="validUntil"
          type="date"
          defaultValue={was("validUntil", defaults.validUntil)}
        />
      </div>

      <TextareaField
        label="Intro note"
        name="introNote"
        rows={3}
        placeholder="Thanks for having us out last week — here's the scope we discussed."
        defaultValue={was("introNote", defaults.introNote)}
      />

      <TextareaField
        label="Terms"
        name="terms"
        rows={3}
        placeholder="50% deposit to schedule, balance on completion. Quote valid 30 days."
        defaultValue={was("terms", defaults.terms)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Lead sales rep</span>
          <select
            ref={repRef}
            name="leadSalesRepId"
            value={leadSalesRepId}
            onChange={(event) => setLeadSalesRepId(event.target.value)}
            className="select"
            data-testid="lead-sales-rep"
          >
            {/* Blank first: both are optional, and a select whose saved
                value is missing would otherwise show the first name on the
                list and write it on the next save. */}
            <option value="">— Nobody —</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
                {user.title ? ` · ${user.title}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Contract signer</span>
          <select
            ref={signerRef}
            name="contractSignerId"
            value={contractSignerId}
            onChange={(event) => setContractSignerId(event.target.value)}
            className="select"
            data-testid="contract-signer"
          >
            <option value="">— Nobody —</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
                {user.title ? ` · ${user.title}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <span className="label">Other team members on this deal</span>
        {teamUserIds.map((id) => (
          <input key={id} type="hidden" name="teamUserIds" value={id} />
        ))}
        {others.length === 0 ? (
          <p className="faint text-xs">
            {users.length === 1
              ? "You are the only user in this workspace today. Teammates show up here once they have logins."
              : "Everyone in the workspace is already named above."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="team-members">
            {others.map((user) => {
              const on = teamUserIds.includes(user.id);
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => toggleTeamMember(user.id)}
                  aria-pressed={on}
                  className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
                >
                  {user.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}
