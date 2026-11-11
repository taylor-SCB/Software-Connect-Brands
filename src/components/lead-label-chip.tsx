"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { FloatingMenu } from "@/components/floating-menu";
import { IconChevronDown, IconPlus } from "@/components/icons";
import { BUILT_IN_LEAD_LABELS, MAX_LEAD_LABEL_LENGTH, NO_LEAD_LABEL, canonicalLeadLabel, leadLabelStyle } from "@/lib/lead-labels";

// Keyboard for a FloatingMenu of buttons (audit, Nov 11, 2026): opening
// it moves focus to the current choice or the first one (two frames: the
// panel is hidden the frame it places itself), Up / Down / Home / End walk
// the choices, and closing it hands focus back to the button that opened
// it when nothing else took it. Before, focus stayed on the button and Tab
// walked the whole board before reaching the menu.
export function useMenuFocus(open: boolean, testId: string, anchor: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const opener = anchor.current;
    const panel = () => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    const items = () =>
      Array.from(panel()?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled])") ?? []).filter(
        (el) => el.offsetParent !== null,
      );
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const box = panel();
        if (!box || box.contains(document.activeElement)) return;
        (box.querySelector<HTMLElement>("[data-current=true]") ?? items()[0])?.focus();
      });
    });
    function onKey(event: KeyboardEvent) {
      const box = panel();
      if (!box || !box.contains(document.activeElement) || (document.activeElement as HTMLElement).tagName === "INPUT") return;
      const list = items();
      if (!list.length) return;
      const at = list.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      if (event.key === "ArrowDown") next = (at + 1) % list.length;
      else if (event.key === "ArrowUp") next = (at - 1 + list.length) % list.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      if (next < 0) return;
      event.preventDefault();
      list[next].focus();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      document.removeEventListener("keydown", onKey);
      const now = document.activeElement;
      if (opener?.isConnected && (!now || now === document.body)) opener.focus();
    };
  }, [open, testId, anchor]);
}

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
        className="inline-flex items-center gap-1 [@media(pointer:coarse)]:min-h-11"
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
  useMenuFocus(open, "lead-label-menu", anchor);
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
              data-current={label === value ? "true" : undefined}
              className={`flex w-full items-center px-3 py-1.5 text-left hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] [@media(pointer:coarse)]:min-h-11 ${label === value ? "bg-[var(--hover)]" : ""}`}
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
            <button type="submit" disabled={!canonicalLeadLabel(typed)} className="btn btn-primary btn-sm [@media(pointer:coarse)]:min-h-11" data-testid="lead-label-custom-add">
              Add
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="link inline-flex items-center gap-1 text-xs [@media(pointer:coarse)]:min-h-11" data-testid="lead-label-add-custom">
            <IconPlus size={12} />
            Add Custom Lead Label
          </button>
        )}
      </div>
    </FloatingMenu>
  );
}
