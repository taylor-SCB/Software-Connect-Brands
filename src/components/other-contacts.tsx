"use client";

import { useState, useTransition } from "react";
import { IconCheck, IconPlus, IconSearch, IconX, IconMessage, IconMail, IconPhone, IconCalendar } from "@/components/icons";
import { ACTIVITY_LABELS, type ActivityTypeValue } from "@/lib/constants";
import { useSearch } from "@/lib/use-search";
import { quickAddContactToCompany } from "@/app/dashboard/contacts/account-actions";
import { claimActivities } from "@/app/dashboard/companies/actions";
import type { CompanyPerson } from "@/components/company-people-picker";
import { FormError } from "@/components/ui";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

export type UnclaimedActivity = { id: string; type: string; body: string; when: string };
export type BypassGroup = { userId: string; userName: string; activities: UnclaimedActivity[] };

// "Other Contacts" on a company's People card (Oct 4, 2026): the
// activities logged on the company with nobody linked, grouped under
// whoever bypassed ("Nic Steffl Bypassed · 3"). Claim moves one, or all
// of a teammate's, onto a real person at the company: their history,
// their Contacted status and the calendar entry follow it.
export function OtherContacts({ companyId, people, groups }: { companyId: string; people: CompanyPerson[]; groups: BypassGroup[] }) {
  // Which claim box is open: one activity, or a whole group.
  const [claiming, setClaiming] = useState<{ key: string; ids: string[]; label: string } | null>(null);

  if (groups.length === 0) return null;
  const total = groups.reduce((sum, group) => sum + group.activities.length, 0);

  return (
    <div className="border-t border-[var(--border)]" data-testid="other-contacts">
      <div className="px-5 pb-2 pt-4">
        <p className="text-sm font-medium">Other Contacts</p>
        <p className="faint text-xs">
          {total} {total === 1 ? "activity" : "activities"} logged here with nobody linked. Claim one to move it onto a person.
        </p>
      </div>
      {groups.map((group) => {
        const groupKey = `group-${group.userId}`;
        return (
          <div key={group.userId} className="border-t border-[rgb(255_255_255/0.045)]" data-testid="bypass-group" data-user-id={group.userId}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <p className="text-sm">
                <span className="font-medium">{group.userName} Bypassed</span>
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
                  className="btn btn-ghost btn-sm"
                  data-testid="claim-all"
                >
                  Claim all
                </button>
              )}
            </div>
            {claiming?.key === groupKey && (
              <ClaimBox companyId={companyId} people={people} ids={claiming.ids} label={claiming.label} onClose={() => setClaiming(null)} />
            )}
            <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
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
                          <p className="faint text-[0.7rem]">
                            {ACTIVITY_LABELS[activity.type as ActivityTypeValue] ?? activity.type} · {activity.when}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setClaiming(claiming?.key === key ? null : { key, ids: [activity.id], label: "this activity" })}
                        className="btn btn-ghost btn-sm shrink-0"
                        data-testid="claim-one"
                      >
                        Claim
                      </button>
                    </div>
                    {claiming?.key === key && (
                      <ClaimBox companyId={companyId} people={people} ids={claiming.ids} label={claiming.label} onClose={() => setClaiming(null)} />
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
}: {
  companyId: string;
  people: CompanyPerson[];
  ids: string[];
  label: string;
  onClose: () => void;
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
      else onClose();
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
      else onClose();
    });

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[var(--border-strong)] bg-[rgb(255_255_255/0.03)] p-2.5" data-testid="claim-box">
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
            className="badge cursor-pointer gap-1 border border-[var(--border)] text-[var(--text)] transition-colors hover:border-[var(--brand)]"
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
