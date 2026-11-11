"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconCheck, IconPlus, IconSearch, IconX, IconMessage, IconMail, IconPhone, IconCalendar, IconChevronDown } from "@/components/icons";
import { ACTIVITY_LABELS, type ActivityTypeValue } from "@/lib/constants";
import { useSearch } from "@/lib/use-search";
import { quickAddContactToCompany } from "@/app/dashboard/contacts/account-actions";
import { claimActivities } from "@/app/dashboard/companies/actions";
import { undoClaim } from "@/app/dashboard/companies/[id]/claim-actions";
import type { CompanyPerson } from "@/components/company-people-picker";
import { FormError } from "@/components/ui";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

const NOUNS: Record<string, [string, string]> = {
  PHONE_CALL: ["call", "calls"],
  TEXT: ["text", "texts"],
  EMAIL: ["email", "emails"],
  MEETING: ["meeting", "meetings"],
};

export type UnclaimedActivity = { id: string; type: string; body: string; when: string };
export type BypassGroup = { userId: string; userName: string; activities: UnclaimedActivity[] };

// A claim just made, for "Moved onto Eli Park · Undo".
type Claimed = { token: string; message: string };

// "1 call not linked to a person yet": the words for what is waiting.
function waitingWords(groups: BypassGroup[]) {
  const rows = groups.flatMap((group) => group.activities);
  const types = new Set(rows.map((row) => row.type));
  const [one, many] = types.size === 1 ? (NOUNS[rows[0].type] ?? ["touch", "touches"]) : ["touch", "touches"];
  return `${rows.length} ${rows.length === 1 ? one : many} not linked to a person yet`;
}

// "Not linked to a person yet" at the top of a company's Who to call (BDR
// redesign, Nov 11, 2026; it was "Other Contacts" under the People card,
// Oct 4, 2026): what was logged on the company with nobody linked — a
// call to the front desk, a bypassed log — as one amber line, "1 call not
// linked to a person yet · Who was it with?". It opens the list, grouped
// under whoever logged it ("Nic Steffl · 3"). Claim moves one, or all of
// a teammate's, onto a real person at the company: their history, their
// Attempted / Connected status and the calendar entry follow it. Every
// claim can be taken back for ten seconds ("Moved onto Eli Park · Undo",
// undoClaim).
export function OtherContacts({ companyId, people, groups }: { companyId: string; people: CompanyPerson[]; groups: BypassGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Which claim box is open: one activity, or a whole group.
  const [claiming, setClaiming] = useState<{ key: string; ids: string[]; label: string } | null>(null);
  const [claimed, setClaimed] = useState<Claimed | null>(null);
  const [undoError, setUndoError] = useState<string | undefined>();
  const [undoing, startUndo] = useTransition();

  // The Undo stays ten seconds.
  useEffect(() => {
    if (!claimed) return;
    const timer = setTimeout(() => setClaimed(null), 10_000);
    return () => clearTimeout(timer);
  }, [claimed]);

  if (groups.length === 0 && !claimed && !undoError) return null;
  const total = groups.reduce((sum, group) => sum + group.activities.length, 0);

  const undo = (row: Claimed) =>
    startUndo(async () => {
      setUndoError(undefined);
      const result = await undoClaim({ token: row.token });
      if (result.error) setUndoError(result.error);
      setClaimed(null);
      router.refresh();
    });

  return (
    <div className="border-b border-[var(--hairline-3)]" data-testid="other-contacts">
      {total > 0 && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full items-center gap-2.5 border-l-4 border-[var(--health-warn)] bg-[var(--health-warn-soft)] px-4 py-2.5 text-left text-sm pointer-coarse:min-h-11"
          data-testid="not-linked-toggle"
        >
          <span className="health-dot shrink-0" data-health="warn" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="font-medium" data-testid="not-linked-count">
              {waitingWords(groups)}
            </span>
            <span className="text-[var(--text-dim)]"> · Who was it with?</span>
          </span>
          <IconChevronDown size={14} className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {claimed && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm" role="status" data-testid="claim-done">
          <span>{claimed.message}</span>
          <button type="button" onClick={() => undo(claimed)} disabled={undoing} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="claim-undo">
            {undoing ? "Undoing…" : "Undo"}
          </button>
        </div>
      )}
      {undoError && (
        <div className="px-5 pb-2.5">
          <FormError message={undoError} />
        </div>
      )}
      {open &&
        groups.map((group) => {
          const groupKey = `group-${group.userId}`;
          return (
            <div key={group.userId} className="border-t border-[var(--hairline-3)]" data-testid="bypass-group" data-user-id={group.userId}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                <p className="text-sm">
                  <span className="font-medium">Logged by {group.userName}</span>
                  <span className="faint num ml-1.5 text-xs">{group.activities.length}</span>
                </p>
                {group.activities.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setClaiming(
                        claiming?.key === groupKey
                          ? null
                          : { key: groupKey, ids: group.activities.map((row) => row.id), label: `all ${group.activities.length} of ${group.userName}'s` },
                      )
                    }
                    className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
                    data-testid="claim-all"
                  >
                    Claim all
                  </button>
                )}
              </div>
              {claiming?.key === groupKey && (
                <div className="px-5 pb-2.5">
                  <ClaimBox companyId={companyId} people={people} ids={claiming.ids} label={claiming.label} onClose={() => setClaiming(null)} onClaimed={setClaimed} />
                </div>
              )}
              <ul className="divide-y divide-[var(--hairline-3)]">
                {group.activities.map((activity) => {
                  const Icon = ACTIVITY_ICONS[activity.type as ActivityTypeValue] ?? IconPhone;
                  const key = `one-${activity.id}`;
                  return (
                    <li key={activity.id} className="px-5 py-2.5" data-testid="unclaimed-row" data-activity-id={activity.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 gap-2">
                          <Icon size={13} className="mt-1 shrink-0 text-[var(--text-faint)]" />
                          <div className="min-w-0">
                            <p className="truncate text-sm">{activity.body}</p>
                            <p className="faint text-xs">
                              {ACTIVITY_LABELS[activity.type as ActivityTypeValue] ?? activity.type} · {activity.when}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setClaiming(claiming?.key === key ? null : { key, ids: [activity.id], label: "this activity" })}
                          className="btn btn-ghost btn-sm shrink-0 pointer-coarse:min-h-11"
                          data-testid="claim-one"
                        >
                          Claim
                        </button>
                      </div>
                      {claiming?.key === key && (
                        <ClaimBox companyId={companyId} people={people} ids={claiming.ids} label={claiming.label} onClose={() => setClaiming(null)} onClaimed={setClaimed} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
    </div>
  );
}

// Pick the person it belongs to: the company's first people as chips,
// a search for the rest, or a new contact made on the spot. One tap on a
// person does the claim.
function ClaimBox({
  companyId,
  people,
  ids,
  label,
  onClose,
  onClaimed,
}: {
  companyId: string;
  people: CompanyPerson[];
  ids: string[];
  label: string;
  onClose: () => void;
  onClaimed: (claimed: Claimed) => void;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", phone: "" });
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const q = query.trim();
  const { results } = useSearch<CompanyPerson>(q ? `/dashboard/contacts/search?companyId=${companyId}&q=${encodeURIComponent(q)}` : null);
  const shown = q ? results : people.slice(0, 12);

  const claim = (contactId: string) =>
    start(async () => {
      setError(undefined);
      const result = await claimActivities({ activityIds: ids, contactId });
      if (result?.error) setError(result.error);
      else {
        if (result.claimToken) onClaimed({ token: result.claimToken, message: result.success ?? "Claimed" });
        onClose();
      }
    });

  const addNew = () =>
    start(async () => {
      setError(undefined);
      const result = await quickAddContactToCompany({ companyId, ...draft });
      if (result.error || !result.contact) {
        setError(result.error ?? "Couldn't add that contact");
        return;
      }
      const made = await claimActivities({ activityIds: ids, contactId: result.contact.id });
      if (made?.error) setError(made.error);
      else {
        if (made.claimToken) onClaimed({ token: made.claimToken, message: made.success ?? "Claimed" });
        onClose();
      }
    });

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[var(--border-strong)] bg-[var(--tint-2)] p-2.5" data-testid="claim-box">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs">
          Who was <span className="font-medium">{label}</span> with?
        </p>
        <div className="relative">
          <IconSearch size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find someone here…"
            aria-label="Find someone at this company"
            className="input input-sm w-44 pl-7"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((person) => (
          <button
            key={person.id}
            type="button"
            disabled={pending}
            onClick={() => claim(person.id)}
            title={[person.email, person.phone].filter(Boolean).join(" · ") || undefined}
            className="badge cursor-pointer gap-1 border border-[var(--border)] text-[var(--text)] transition-colors hover:border-[var(--brand)] pointer-coarse:min-h-11"
            data-testid="claim-person"
          >
            <IconCheck size={10} />
            {person.name}
          </button>
        ))}
        {q && results.length === 0 && <span className="faint text-xs">Nobody here by that name.</span>}
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setDraft({ name: q, email: "", phone: "" });
              setAdding(true);
            }}
            className="btn btn-ghost btn-sm"
            data-testid="claim-add"
          >
            <IconPlus size={11} />
            Add New Contact
          </button>
        )}
        <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Cancel claim">
          <IconX size={12} />
        </button>
      </div>
      {adding && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Name"
            aria-label="New contact name"
            maxLength={120}
            autoFocus
            className="input input-sm"
          />
          <input
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            placeholder="Email · optional"
            aria-label="New contact email"
            type="email"
            className="input input-sm"
          />
          <input
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            placeholder="Phone · optional"
            aria-label="New contact phone"
            type="tel"
            className="input input-sm"
          />
          <button type="button" onClick={addNew} disabled={pending || !draft.name.trim()} className="btn btn-primary btn-sm" data-testid="claim-add-save">
            {pending ? "Adding…" : "Add and claim"}
          </button>
        </div>
      )}
      <FormError message={error} />
      {pending && !adding && <p className="faint text-xs">Moving…</p>}
    </div>
  );
}
