"use client";

import { useRef, useState, type RefObject } from "react";
import { FloatingMenu } from "@/components/floating-menu";
import { IconChevronDown, IconPlus } from "@/components/icons";
import { BUILT_IN_LEAD_LABELS, MAX_LEAD_LABEL_LENGTH, NO_LEAD_LABEL, canonicalLeadLabel, leadLabelStyle } from "@/lib/lead-labels";

// An opportunity's Lead Label as a chip: N/A until one is picked.
export function LeadLabelChip({ label, size = "sm" }: { label: string | null; size?: "sm" | "xs" }) {
  const style = leadLabelStyle(label);
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-full border font-semibold ${
        size === "xs" ? "px-1.5 py-px text-[0.62rem]" : "px-2 py-0.5 text-[0.7rem]"
      }`}
      style={style}
      data-testid="lead-label"
      data-label={label ?? NO_LEAD_LABEL}
    >
      {label ?? NO_LEAD_LABEL}
    </span>
  );
}

// The chip as a button: N/A, the five built-ins, the workspace's custom
// labels, and "+ Add Custom Lead Label" to type a new one.
export function LeadLabelPicker({
  value,
  customLabels,
  onChange,
}: {
  value: string | null;
  customLabels: string[];
  onChange: (label: string | null) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1"
        aria-label={`Lead label: ${value ?? NO_LEAD_LABEL}. Change it`}
        data-testid="lead-label-picker"
      >
        <LeadLabelChip label={value} />
        <IconChevronDown size={11} className="opacity-60" />
      </button>
      <LeadLabelMenu
        anchor={button}
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        customLabels={customLabels}
        onChange={(label) => {
          setOpen(false);
          onChange(label);
        }}
      />
    </>
  );
}

// The picker's list on its own, so something other than the chip can open
// it (a Pipeline tile's ⋯ → Lead label…, or "+ label" on a tile with
// none; BDR redesign, Nov 11, 2026).
export function LeadLabelMenu({
  anchor,
  open,
  onClose,
  value,
  customLabels,
  onChange,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  value: string | null;
  customLabels: string[];
  onChange: (label: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState("");
  const choices = [...BUILT_IN_LEAD_LABELS, ...customLabels.filter((label) => !(BUILT_IN_LEAD_LABELS as readonly string[]).includes(label))];
  if (value && !choices.includes(value)) choices.push(value);

  function pick(label: string | null) {
    setAdding(false);
    setTyped("");
    onChange(label);
  }

  return (
    <FloatingMenu
      anchor={anchor}
      open={open}
      onClose={() => {
        setAdding(false);
        onClose();
      }}
      width={240}
      testId="lead-label-menu"
      label="Lead label"
    >
      <ul className="py-1">
        {[null, ...choices].map((label) => (
          <li key={label ?? NO_LEAD_LABEL}>
            <button
              type="button"
              onClick={() => pick(label)}
              className={`flex w-full items-center px-3 py-1.5 text-left hover:bg-[var(--hover)] ${label === value ? "bg-[var(--hover)]" : ""}`}
              data-testid={`lead-label-option-${label ?? NO_LEAD_LABEL}`}
            >
              <LeadLabelChip label={label} />
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-[var(--hairline-3)] p-2">
        {adding ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const label = canonicalLeadLabel(typed);
              if (label) pick(label);
            }}
            className="flex gap-1.5"
          >
            <input
              autoFocus
              value={typed}
              maxLength={MAX_LEAD_LABEL_LENGTH}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Label name"
              aria-label="Custom lead label"
              className="input input-sm min-w-0 flex-1"
              data-testid="lead-label-custom-input"
            />
            <button type="submit" disabled={!canonicalLeadLabel(typed)} className="btn btn-primary btn-sm" data-testid="lead-label-custom-add">
              Add
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="link inline-flex items-center gap-1 text-xs" data-testid="lead-label-add-custom">
            <IconPlus size={12} />
            Add Custom Lead Label
          </button>
        )}
      </div>
    </FloatingMenu>
  );
}
