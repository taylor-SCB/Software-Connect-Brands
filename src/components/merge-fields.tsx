"use client";

import { useState } from "react";
import {
  MERGE_FIELDS,
  MERGE_GROUPS,
  mergeToken,
  splitMergeFields,
  type MergeContext,
  type MergeField,
  type MergeGroup,
} from "@/lib/merge";

// One merge field drawn as a chip. `state` is how the preview colours it:
// "label" is the plain brand chip that just names the field, "filled"
// shows the real value in white with brand letters, "missing" flashes
// soft red, and "unknown" is a token nobody recognises (a typo).
export function MergeChip({
  field,
  state = "label",
  value,
  raw,
  onClick,
}: {
  field?: MergeField;
  state?: "label" | "filled" | "missing" | "unknown";
  value?: string | null;
  raw?: string;
  onClick?: () => void;
}) {
  const className = `merge-chip ${
    state === "filled"
      ? "merge-chip-filled"
      : state === "missing"
        ? "merge-chip-missing"
        : state === "unknown"
          ? "merge-chip-unknown"
          : ""
  }`;
  const label = field?.label ?? raw ?? "";
  const text =
    state === "filled" ? (value ?? "") : state === "missing" ? "Missing Information" : label;
  const title =
    state === "filled"
      ? label
      : state === "missing"
        ? `${label}: nothing to fill this in with yet`
        : state === "unknown"
          ? "Not a known field — check the spelling"
          : field?.description;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        data-merge-key={field?.key}
        className={className}
      >
        {text}
      </button>
    );
  }
  return (
    <span title={title} data-merge-key={field?.key} data-merge-state={state} className={className}>
      {text}
    </span>
  );
}

// The merge-field box on a template: a row of tabs named after the screens
// the fields come from, then the chips. Clicking a chip hands its token to
// the caller, which drops it into the body at the cursor.
export function MergeFieldPalette({
  onInsert,
  hint,
}: {
  onInsert?: (token: string, field: MergeField) => void;
  hint?: string;
}) {
  const [group, setGroup] = useState<"ALL" | MergeGroup>("ALL");
  const visible = group === "ALL" ? MERGE_FIELDS : MERGE_FIELDS.filter((f) => f.group === group);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Merge field groups">
        {(["ALL", ...MERGE_GROUPS] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={group === name}
            onClick={() => setGroup(name)}
            className={`merge-tab ${group === name ? "merge-tab-active" : ""}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="tabpanel">
        {visible.map((field) => (
          <MergeChip
            key={field.key}
            field={field}
            onClick={onInsert ? () => onInsert(mergeToken(field.key), field) : undefined}
          />
        ))}
      </div>
      <p className="faint mt-2.5 text-xs">
        {hint ??
          "Click a chip to drop it into the body where your cursor is. Each one fills in with the customer's details when a contract is generated."}
      </p>
    </div>
  );
}

// A template body with its tokens drawn as chips. With no context it
// simply names each field; with one, each chip shows the value it will
// resolve to, or "Missing Information" when there is nothing to fill it
// in with yet.
export function MergeBody({
  body,
  context,
  className = "",
}: {
  body: string;
  context?: MergeContext | null;
  className?: string;
}) {
  const segments = splitMergeFields(body);
  return (
    <div className={`whitespace-pre-wrap text-sm leading-[1.9] ${className}`}>
      {segments.map((segment, index) => {
        if (segment.kind === "text") return <span key={index}>{segment.text}</span>;
        if (!segment.field) {
          return <MergeChip key={index} state="unknown" raw={segment.raw} />;
        }
        if (!context) return <MergeChip key={index} field={segment.field} />;
        const value = context[segment.key];
        return value ? (
          <MergeChip key={index} field={segment.field} state="filled" value={value} />
        ) : (
          <MergeChip key={index} field={segment.field} state="missing" />
        );
      })}
    </div>
  );
}
