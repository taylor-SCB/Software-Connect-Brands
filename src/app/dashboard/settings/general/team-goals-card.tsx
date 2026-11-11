"use client";

import { useActionState } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import type { ActionState } from "@/lib/forms";
import { updateTeamGoals } from "./actions";

type Goals = { weeklyTryGoal: number | null; weeklyTalkGoal: number | null; weeklyMeetingGoal: number | null; parkAfterTries: number };

const FIELDS: { name: keyof Goals; label: string; hint: string }[] = [
  { name: "weeklyTryGoal", label: "Tries", hint: "calls, texts, emails and meetings logged" },
  { name: "weeklyTalkGoal", label: "Talks", hint: "talked, they replied, or a meeting held" },
  { name: "weeklyMeetingGoal", label: "Meetings booked", hint: "meetings each rep books" },
];

// Settings → General: each rep's weekly goals and the try limit (BDR
// redesign, Nov 11, 2026). Goals are optional; until one is set My day's
// ring for it reads "vs last week".
export function TeamGoalsCard({ goals, canEdit }: { goals: Goals; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTeamGoals, {});
  // After a refusal, what was typed (an emptied box stays empty).
  const value = (name: keyof Goals) => (state.kept ? (state.kept[name] ?? "") : goals[name] === null ? "" : String(goals[name]));
  return (
    <form action={action} className="space-y-3 px-5 pb-5" data-testid="team-goals-form" noValidate>
      <p className="faint text-sm">Each rep&apos;s week, Monday to Sunday. Leave a box empty for no goal.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <label key={field.name} className="block min-w-0 text-sm">
            <span className="font-medium">{field.label}</span>
            <input
              key={value(field.name)}
              name={field.name}
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              placeholder="No goal"
              defaultValue={value(field.name)}
              disabled={!canEdit}
              className="input num mt-1 w-full"
              data-testid={`goal-${field.name}`}
            />
            <span className="faint mt-1 block text-xs">{field.hint}</span>
          </label>
        ))}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span>Offer &ldquo;Try again in 30 days&rdquo; after</span>
        <input
          key={value("parkAfterTries")}
          name="parkAfterTries"
          type="number"
          inputMode="numeric"
          min={1}
          max={50}
          defaultValue={value("parkAfterTries")}
          disabled={!canEdit}
          className="input input-sm num w-20"
          data-testid="goal-parkAfterTries"
        />
        <span>tries with no talk.</span>
      </label>
      {canEdit ? (
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="team-goals-save">
          {pending ? "Saving…" : "Save"}
        </button>
      ) : (
        <p className="faint text-xs">Only owners and admins can change this.</p>
      )}
      <FormError message={state.error} />
      <FormSuccess message={state.success} />
    </form>
  );
}
