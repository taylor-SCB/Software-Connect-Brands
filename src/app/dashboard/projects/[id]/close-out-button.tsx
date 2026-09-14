"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { IconCheck } from "@/components/icons";
import { closeOutProject, reopenProject } from "../actions";

export type OpenItemView = { kind: string; text: string; href: string };

// Closing out is one button. What makes it worth pressing is the list
// beside it: the loose ends somebody usually forgets. Nothing here blocks
// it — a contractor closing a job with $500 still owed knows something
// the app does not.
export function CloseOutButton({
  projectId,
  projectName,
  closed,
  closedNote,
  openItems,
}: {
  projectId: string;
  projectName: string;
  closed: boolean;
  closedNote: string | null;
  openItems: OpenItemView[];
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();

  if (closed) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="close-out-done">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setState({});
              setState((await reopenProject(projectId)) ?? {});
            })
          }
          className="btn btn-ghost btn-sm"
          data-testid="reopen-project"
        >
          Reopen this job
        </button>
        {closedNote && <span className="faint text-xs">{closedNote}</span>}
        <FormError message={state.error} />
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm"
        data-testid="close-out"
      >
        <IconCheck size={13} />
        Close out
      </button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4">
      <p className="text-sm font-medium">Close out {projectName}?</p>

      {openItems.length === 0 ? (
        <p className="muted text-xs" data-testid="close-out-clean">
          Nothing is left open on this job. Clean close.
        </p>
      ) : (
        <div data-testid="close-out-open-items">
          <p className="muted text-xs">
            Still open. None of it stops you — closing out is your call.
          </p>
          <ul className="mt-1.5 space-y-1">
            {openItems.map((item) => (
              <li key={item.kind} className="text-xs" data-testid="close-out-item" data-kind={item.kind}>
                <Link href={item.href} className="link">
                  {item.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="block text-xs">
        <span className="faint block">Anything to note about closing it</span>
        <input
          value={note}
          onChange={(fired) => setNote(fired.target.value)}
          maxLength={1000}
          placeholder="Walked it with Dana. Punch list signed off."
          className="input input-sm w-full"
          data-testid="close-out-note"
        />
      </label>

      <FormError message={state.error} />
      <FormSuccess message={state.success} />

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setState({});
              const result = await closeOutProject(projectId, note);
              setState(result ?? {});
              if (!result?.error) setOpen(false);
            })
          }
          className="btn btn-primary btn-sm"
          data-testid="close-out-confirm"
        >
          {pending ? "Closing…" : "Close it out"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Not yet
        </button>
      </div>
    </div>
  );
}
