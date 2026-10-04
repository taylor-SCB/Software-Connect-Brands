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

type View = "all" | "company" | "people" | "personal";

// The notes feed with an All / Personal switch. Personal gathers every
// note wearing a personal label (birthday, family, hobbies…) so the
// relationship side of a contact is one tap away. On a company page
// (`split`, Oct 4, 2026) two more views sit between them: Company, the
// notes written on the company itself, and People, the notes written on
// the people at it, so "they move buildings in March" is not lost among
// forty people's notes.
export function NotesList({ notes, split = false }: { notes: NoteItem[]; split?: boolean }) {
  const [view, setView] = useState<View>("all");
  const personal = notes.filter((note) => isPersonalLabel(note.label));
  const company = notes.filter((note) => !note.via);
  const people = notes.filter((note) => Boolean(note.via));
  const shown = view === "personal" ? personal : view === "company" ? company : view === "people" ? people : notes;

  const tabs: { key: View; label: string; count: number }[] = [
    { key: "all", label: "All", count: notes.length },
    ...(split
      ? [
          { key: "company" as const, label: "Company", count: company.length },
          { key: "people" as const, label: "People", count: people.length },
        ]
      : []),
    { key: "personal", label: "Personal", count: personal.length },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 pt-4" data-testid="notes-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setView(tab.key)}
            aria-pressed={view === tab.key}
            className={`btn btn-sm ${view === tab.key ? "btn-primary" : "btn-ghost"}`}
            data-testid={`notes-tab-${tab.key}`}
          >
            {tab.label}
            <span className="num opacity-70">{tab.count}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={
            view === "personal"
              ? "Nothing personal yet"
              : view === "company"
                ? "No notes on the company itself yet"
                : view === "people"
                  ? "No notes on its people yet"
                  : "No notes yet"
          }
          body={
            view === "personal"
              ? "Label a note Personal, Birthday, Hobbies or Family and it shows up here."
              : view === "company"
                ? "A note added on this page sits on the company."
                : view === "people"
                  ? "A note added on a person's page shows here with their name."
                  : undefined
          }
        />
      ) : (
        <ul className="mt-2 divide-y divide-[rgb(255_255_255/0.045)]" data-testid="notes-rows">
          {shown.map((note) => (
            <li key={note.id} className="px-5 py-3" data-testid="note-row">
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
