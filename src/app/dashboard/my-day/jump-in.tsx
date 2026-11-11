"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconCalendar, IconPhone, IconSearch, IconUpload, IconUserPlus } from "@/components/icons";
import { useHowDidItGo } from "@/components/how-did-it-go/how-did-it-go";
import { useBookMeeting } from "@/components/book-meeting/book-meeting";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { useSearch } from "@/lib/use-search";

type Found = { id: string; name: string; company: string | null; phone?: string | null; email?: string | null };

// Jump in for Members on My day and the Daily Rundown (BDR redesign, Nov
// 11, 2026): Log a call · Add contact · Book a meeting · Import my list.
// Log a call and Book a meeting ask "Who?" first (the contacts search the
// pickers use), then open How did it go? or the Book meeting sheet.
export function MemberJumpIn({ today }: { today: string }) {
  const router = useRouter();
  const how = useHowDidItGo();
  const book = useBookMeeting({ onBooked: () => router.refresh() });
  const [asking, setAsking] = useState<"call" | "book" | null>(null);
  const [query, setQuery] = useState("");
  const { results, loading } = useSearch<Found>(asking ? `/dashboard/contacts/search?q=${encodeURIComponent(query.trim())}` : null);

  function pick(person: Found) {
    const mode = asking;
    setAsking(null);
    setQuery("");
    if (mode === "call") how.open({ target: { contactId: person.id }, type: "PHONE_CALL", name: person.name, today });
    else if (mode === "book") book.open({ contactId: person.id, name: person.name, today });
  }

  return (
    <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 sm:p-5" data-testid="jump-in-member">
      <button type="button" className="nav-item pointer-coarse:min-h-11" onClick={() => setAsking("call")} data-testid="jump-log-call">
        <IconPhone size={15} className="opacity-70" />
        Log a call
      </button>
      <Link href="/dashboard/contacts/new" className="nav-item pointer-coarse:min-h-11" data-testid="jump-add-contact">
        <IconUserPlus size={15} className="opacity-70" />
        Add contact
      </Link>
      <button type="button" className="nav-item pointer-coarse:min-h-11" onClick={() => setAsking("book")} data-testid="jump-book">
        <IconCalendar size={15} className="opacity-70" />
        Book a meeting
      </button>
      <Link href="/dashboard/contacts?import=1" className="nav-item pointer-coarse:min-h-11" data-testid="jump-import">
        <IconUpload size={15} className="opacity-70" />
        Import my list
      </Link>
      <Sheet
        open={asking !== null}
        onClose={() => {
          setAsking(null);
          setQuery("");
        }}
        title={asking === "book" ? "Book a meeting with…" : "Who did you call?"}
        testId="jump-who"
      >
        <label className="relative block">
          <span className="sr-only">Search people</span>
          <IconSearch size={14} className="faint pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            data-autofocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, company, phone or email"
            className="input w-full pl-8"
            data-testid="jump-who-search"
          />
        </label>
        <ul className="mt-3 max-h-80 divide-y divide-[var(--hairline-3)] overflow-y-auto" aria-busy={loading}>
          {results.map((person) => (
            <li key={person.id}>
              <button type="button" className="flex w-full min-w-0 flex-col items-stretch rounded-lg px-2 py-2 text-left hover:bg-[var(--hover)] pointer-coarse:min-h-11" onClick={() => pick(person)} data-testid="jump-who-pick">
                <span className="truncate text-sm font-medium">{person.name}</span>
                <span className="faint truncate text-xs">{[person.company, person.phone ?? person.email].filter(Boolean).join(" · ") || "No company"}</span>
              </button>
            </li>
          ))}
          {!loading && results.length === 0 && <li className="faint px-2 py-3 text-sm">{query.trim() ? "Nobody by that name" : "Start typing a name"}</li>}
        </ul>
      </Sheet>
      {how.element}
      {book.element}
    </div>
  );
}
