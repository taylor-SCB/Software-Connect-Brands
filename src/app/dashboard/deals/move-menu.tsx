"use client";

import { useRef, useState } from "react";
import { CONTACT_COLUMNS, PIPELINE_COLUMNS, PIPELINE_COLUMN_COLORS, PIPELINE_COLUMN_LABELS, type PipelineColumn } from "@/lib/constants";
import { FloatingMenu } from "@/components/floating-menu";
import { IconChevronDown } from "@/components/icons";

export const isMeetingColumn = (column: string) => (CONTACT_COLUMNS as readonly string[]).includes(column);

// The stage chip on a tile and in its panel: every column, with the
// meeting ones closed to a deal.
export function MoveMenu({
  current,
  archived = false,
  locked,
  onMove,
}: {
  current: PipelineColumn;
  archived?: boolean;
  // A deal: the meeting columns are not on offer.
  locked: boolean;
  onMove: (column: PipelineColumn) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const accent = PIPELINE_COLUMN_COLORS[current];
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium"
        style={{ borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`, color: accent }}
        aria-label={`Stage: ${archived ? "Archived" : PIPELINE_COLUMN_LABELS[current]}. Move it`}
        data-testid="tile-move"
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        {archived ? "Archived" : PIPELINE_COLUMN_LABELS[current]}
        <IconChevronDown size={11} className="opacity-70" />
      </button>
      <FloatingMenu anchor={button} open={open} onClose={() => setOpen(false)} width={220} testId="tile-move-menu" label="Move to">
        <ul role="listbox" aria-label="Move to" className="py-1">
          {PIPELINE_COLUMNS.map((column) => {
            const blocked = locked && isMeetingColumn(column);
            return (
              <li key={column}>
                <button
                  type="button"
                  role="option"
                  aria-selected={column === current}
                  disabled={blocked}
                  title={blocked ? "A deal can't go back to a meeting" : undefined}
                  onClick={() => {
                    setOpen(false);
                    onMove(column);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[rgb(255_255_255/0.04)] disabled:cursor-not-allowed disabled:opacity-40 ${
                    column === current ? "font-semibold" : ""
                  }`}
                  data-testid={`tile-move-${column}`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PIPELINE_COLUMN_COLORS[column] }} />
                  {PIPELINE_COLUMN_LABELS[column]}
                </button>
              </li>
            );
          })}
        </ul>
      </FloatingMenu>
    </>
  );
}
