"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import {
  NOTE_LABEL_NAMES,
  NOTE_LABEL_COLORS,
  isPersonalLabel,
  type NoteLabelValue,
} from "@/lib/constants";

export type NoteItem = {
  id: string;
  body: string;
  label: string | null;
  authorName: string;
  when: string;
  // Copies of this note on other contacts, when it was logged in a batch.
  others: number;
  // On a company page: which person the note actually sits on.
  via?: { id: string; name: string } | null;
};

// The notes feed with an All / Personal switch. Personal gathers every
// note wearing a personal label (birthday, family, hobbies…) so the
// relationship side of a contact is one tap away.
export function NotesList({ notes }: { notes: NoteItem[] }) {
  const [view, setView] = useState<"all" | "personal">("all");
  const personal = notes.filter((note) => isPersonalLabel(note.label));
  const shown = view === "personal" ? personal : notes;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-5 pt-4">
        <button
          type="button"
          onClick={() => setView("all")}
          aria-pressed={view === "all"}
          className={`btn btn-sm ${view === "all" ? "btn-primary" : "btn-ghost"}`}
        >
          All
          <span className="num opacity-70">{notes.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setView("personal")}
          aria-pressed={view === "personal"}
          className={`btn btn-sm ${view === "personal" ? "btn-primary" : "btn-ghost"}`}
        >
          Personal
          <span className="num opacity-70">{personal.length}</span>
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={view === "personal" ? "Nothing personal yet" : "No notes yet"}
          body={
            view === "personal"
              ? "Label a note Personal, Birthday, Hobbies or Family and it shows up here."
              : undefined
          }
        />
      ) : (
        <ul className="mt-2 divide-y divide-[rgb(255_255_255/0.045)]">
          {shown.map((note) => (
            <li key={note.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-sm leading-relaxed">{note.body}</p>
                {note.label && (
                  <Badge color={NOTE_LABEL_COLORS[note.label as NoteLabelValue]}>
                    {NOTE_LABEL_NAMES[note.label as NoteLabelValue]}
                  </Badge>
                )}
              </div>
              <p className="faint mt-1 text-[0.7rem]">
                {note.authorName} · {note.when}
                {note.via && (
                  <>
                    {" · "}
                    <Link href={`/dashboard/contacts/${note.via.id}`} className="link">
                      {note.via.name}
                    </Link>
                  </>
                )}
                {note.others > 0 && ` · also on ${note.others} ${note.others === 1 ? "other" : "others"}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
