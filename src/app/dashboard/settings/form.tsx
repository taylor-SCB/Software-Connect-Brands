"use client";

import { useActionState, useState } from "react";
import { Field, FormError, FormSuccess } from "@/components/ui";
import { updateBranding } from "./actions";
import type { ActionState } from "@/lib/forms";

const PRESETS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7"];

export function BrandingForm({
  organization,
  canEdit,
}: {
  organization: { name: string; logoUrl: string | null; primaryColor: string };
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateBranding,
    {},
  );
  // Local state drives the live preview so the swatch and button update
  // as the color changes, before anything is saved.
  const [color, setColor] = useState(organization.primaryColor);

  return (
    <form action={formAction} className="space-y-5 p-5">
      <Field
        label="Company name"
        name="name"
        defaultValue={organization.name}
        required
      />

      <Field
        label="Logo URL"
        name="logoUrl"
        placeholder="https://yourcompany.com/logo.png"
        defaultValue={organization.logoUrl ?? ""}
        hint="Shown in the sidebar and on quotes and contracts."
      />

      <div>
        <label className="label" htmlFor="primaryColor">
          Primary color
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="primaryColor"
            name="primaryColor"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            disabled={!canEdit}
            className="input num w-32"
          />
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#6366f1"}
            onChange={(event) => setColor(event.target.value)}
            disabled={!canEdit}
            aria-label="Pick primary color"
            className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--border)] bg-transparent"
          />
          <div className="flex gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                disabled={!canEdit}
                aria-label={`Use ${preset}`}
                className="h-7 w-7 rounded-md border border-[var(--border)] transition-transform hover:scale-110"
                style={{ background: preset }}
              />
            ))}
          </div>
        </div>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{
          borderColor: "color-mix(in srgb, var(--preview) 35%, transparent)",
          background: "color-mix(in srgb, var(--preview) 10%, transparent)",
          ["--preview" as string]: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#6366f1",
        }}
      >
        <p className="eyebrow mb-2">Preview</p>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: "var(--preview)" }}
          >
            {organization.name.charAt(0).toUpperCase()}
          </div>
          <span
            className="btn btn-sm text-white"
            style={{ background: "var(--preview)" }}
          >
            Primary button
          </span>
        </div>
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      {canEdit && (
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Saving…" : "Save changes"}
        </button>
      )}
    </form>
  );
}
