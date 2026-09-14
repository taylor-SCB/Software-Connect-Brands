"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { FormError } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { addProjectNote, deleteProjectNote } from "../actions";

export type ProjectNoteView = { id: string; body: string; author: string; when: string };

// Notes about the job rather than about a person: "owner wants the north
// side done first", "gate code changed". Kept on the job so they outlive
// whoever said it.
export function ProjectNotes({ projectId, notes }: { projectId: string; notes: ProjectNoteView[] }) {
  const [state, action, pending] = useActionState(addProjectNote, {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) form.current?.reset();
  }, [state.success]);

  return (
    <div className="space-y-3 p-5">
      <form ref={form} action={action} className="space-y-2" data-testid="project-note-form">
        <input type="hidden" name="projectId" value={projectId} />
        <textarea
          name="body"
          rows={2}
          required
          maxLength={4000}
          placeholder="Owner wants the north side done first. Gate code is 4412."
          className="textarea w-full"
          data-testid="project-note-body"
        />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending} className="btn btn-ghost btn-sm" data-testid="project-note-add">
            {pending ? "Saving…" : "Add note"}
          </button>
          <FormError message={state.error} />
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="faint text-xs">Nothing noted on this job yet.</p>
      ) : (
        <ul className="space-y-2 border-t border-[rgb(255_255_255/0.06)] pt-3">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteRow({ note }: { note: ProjectNoteView }) {
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  return (
    <li className="flex items-start justify-between gap-3" data-testid="project-note">
      <div className="min-w-0">
        <p className="whitespace-pre-wrap text-sm">{note.body}</p>
        <p className="faint num text-xs">
          {note.author} · {note.when}
        </p>
        <FormError message={error} />
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const result = await deleteProjectNote(note.id);
            if (result?.error) setError(result.error);
          })
        }
        aria-label="Remove this note"
        className="btn btn-ghost btn-sm !px-1.5"
        data-testid="project-note-delete"
      >
        <IconTrash size={12} />
      </button>
    </li>
  );
}
