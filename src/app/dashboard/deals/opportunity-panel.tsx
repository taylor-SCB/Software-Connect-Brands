"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { PipelineColumn } from "@/lib/constants";
import { dollarsToCents, formatCents, formatDate } from "@/lib/format";
import { LeadLabelPicker } from "@/components/lead-label-chip";
import { IconCalendar, IconClock, IconFileText, IconPlus, IconX } from "@/components/icons";
import { loadOpportunity, saveOpportunity, type OpportunityDetail, type OpportunityPerson } from "./opportunity-actions";
import { MoveMenu } from "./move-menu";
import { FollowUpButton, MeetingSuggest, QuietBadge, SuggestedLabel } from "./ai-assist-ui";

type Role = OpportunityPerson["role"];
const ROLES: { role: Role; label: string }[] = [
  { role: "PRIMARY", label: "Primary POC" },
  { role: "ASSOCIATED", label: "Associated POC" },
  { role: "HIDDEN", label: "Do Not List" },
];

// A tile opened (Oct 27, 2026): its name, lead label, rep, value, every
// meeting date, and who is on it — Primary POC, Associated POC or Do Not
// List, one each, with anyone else added from the contacts. Nothing is
// written until Save.
export function OpportunityPanel({
  id,
  timeZone,
  onClose,
  onMove,
  ai = false,
  quietDays = null,
  suggestedLabel = null,
}: {
  id: string;
  timeZone: string;
  // The AI helpers and the gone-quiet badge (Nov 10, 2026).
  ai?: boolean;
  quietDays?: number | null;
  suggestedLabel?: { label: string; reason: string } | null;
  onClose: () => void;
  // `saved` carries the name when the panel's edits were saved on the way.
  onMove: (column: PipelineColumn, saved?: { title: string }) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [leadLabel, setLeadLabel] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [value, setValue] = useState("");
  // Each person's role; null is "nothing ticked yet" for someone just added.
  const [people, setPeople] = useState<(Omit<OpportunityPerson, "role"> & { role: Role | null })[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    loadOpportunity(id).then((result) => {
      if (!live) return;
      if ("error" in result) {
        setLoadError(result.error);
        return;
      }
      setDetail(result);
      setTitle(result.title);
      setLeadLabel(result.leadLabel);
      setOwnerId(result.ownerId ?? "");
      setValue(result.deal ? (result.deal.valueCents / 100).toFixed(2) : "");
      setPeople(result.people);
    });
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Ticking one of a person's three boxes greys the other two; unticking
  // frees them. There is one Primary: ticking it on someone moves the old
  // Primary to Associated.
  function tick(contactId: string, role: Role) {
    setPeople((rows) =>
      rows.map((row) => {
        if (row.contactId === contactId) return { ...row, role: row.role === role ? null : role };
        if (role === "PRIMARY" && row.role === "PRIMARY") return { ...row, role: "ASSOCIATED" };
        return row;
      }),
    );
  }

  // Anything changed in the panel since it opened.
  function unsaved() {
    if (!detail) return false;
    const roles = (rows: { contactId: string; role: Role | null }[]) => rows.map((row) => `${row.contactId}:${row.role}`).join(",");
    return (
      title !== detail.title ||
      leadLabel !== detail.leadLabel ||
      ownerId !== (detail.ownerId ?? "") ||
      value !== (detail.deal ? (detail.deal.valueCents / 100).toFixed(2) : "") ||
      roles(people) !== roles(detail.people)
    );
  }

  // `then` runs once the save has gone through and the panel is closed.
  function save(then?: (saved: { title: string }) => void) {
    if (!detail || pending) return;
    const unset = people.find((row) => row.role === null);
    if (unset) {
      setError(`Tick Primary POC, Associated POC or Do Not List for ${unset.name}`);
      return;
    }
    setError(undefined);
    start(async () => {
      const result = await saveOpportunity({
        id: detail.id,
        title,
        leadLabel,
        ownerId,
        valueCents: detail.deal && !detail.deal.hasQuotes ? dollarsToCents(value) : null,
        people: people.map((row) => ({ contactId: row.contactId, role: row.role as Role })),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
      then?.({ title: title.trim() });
    });
  }

  // The Stage menu in the panel (UX review, Nov 10, 2026): it used to
  // close the panel and drop every unsaved edit. Edits made here are saved
  // first, as Save would; a save that is refused keeps the panel open with
  // its message and moves nothing. The stage it is already in does nothing.
  function moveFromPanel(next: PipelineColumn) {
    if (next === column) return;
    if (!unsaved()) {
      onClose();
      onMove(next);
      return;
    }
    save((saved) => onMove(next, saved));
  }

  const column = detail?.column === "ARCHIVED" ? "CONTRACT_SENT" : ((detail?.column ?? "MEETING_SET") as PipelineColumn);
  const isDeal = Boolean(detail?.deal && !["LEAD", "CONTACTED"].includes(detail.deal.stage));
  const primary = people.find((row) => row.role === "PRIMARY");

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-[var(--scrim)]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Opportunity"
        className="card popover flex h-full w-full max-w-xl flex-col rounded-none"
        data-testid="opportunity-panel"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline-3)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1">{isDeal ? "Deal" : "Opportunity"}</p>
            {detail ? (
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
                aria-label="Name"
                className="input w-full text-base font-semibold"
                data-testid="panel-title"
              />
            ) : (
              <p className="faint text-sm">{loadError ?? "Loading…"}</p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm !px-1.5" data-testid="panel-close">
            <IconX size={14} />
          </button>
        </div>

        {detail && (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="faint">Stage</span>
                <MoveMenu current={column} archived={detail.column === "ARCHIVED"} locked={isDeal} onMove={moveFromPanel} />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="faint">Lead label</span>
                <LeadLabelPicker value={leadLabel} customLabels={detail.customLabels} onChange={setLeadLabel} />
                {!leadLabel && <SuggestedLabel opportunityId={detail.id} rule={suggestedLabel} ai={ai} onAccept={setLeadLabel} />}
              </span>
              <label className="flex items-center gap-1.5">
                <span className="faint">Rep</span>
                <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="select input-sm w-44" data-testid="panel-rep">
                  <option value="">Unassigned</option>
                  {detail.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(quietDays !== null || ai) && (
              <div className="flex flex-wrap items-center gap-2" data-testid="panel-quiet">
                {quietDays !== null && <QuietBadge days={quietDays} />}
                {ai && <FollowUpButton opportunityId={detail.id} />}
              </div>
            )}

            {ai && (
              <MeetingSuggest
                opportunityId={detail.id}
                canSetValue={Boolean(detail.deal && isDeal && !detail.deal.hasQuotes)}
                onPrimary={(contactId) => {
                  const row = people.find((person) => person.contactId === contactId);
                  if (row && row.role !== "PRIMARY") {
                    setPeople((rows) =>
                      rows.map((person) =>
                        person.contactId === contactId
                          ? { ...person, role: "PRIMARY" }
                          : person.role === "PRIMARY"
                            ? { ...person, role: "ASSOCIATED" }
                            : person,
                      ),
                    );
                  }
                }}
                onLabel={setLeadLabel}
                onValue={(cents) => setValue((cents / 100).toFixed(2))}
              />
            )}

            {detail.deal && isDeal && (
              <label className="flex items-center justify-between gap-3 text-xs">
                <span className="faint">Value{detail.deal.hasQuotes ? " (from its quotes)" : ""}</span>
                {detail.deal.hasQuotes ? (
                  <span className="num text-sm font-medium">{formatCents(detail.deal.valueCents)}</span>
                ) : (
                  <input
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    inputMode="decimal"
                    className="input input-sm num w-36 text-right"
                    data-testid="panel-value"
                  />
                )}
              </label>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">People</h3>
                <span className="faint text-[0.7rem]">One box each · one Primary</span>
              </div>
              <div className="overflow-x-auto">
                {/* On a phone (UX review, Nov 10, 2026) the headers wrap
                    and the cells tighten so Do Not List stays on screen. */}
                <table className="table text-xs max-sm:[&_td]:px-1.5 max-sm:[&_th]:px-1.5 max-sm:[&_th]:tracking-normal max-sm:[&_th]:whitespace-normal" data-testid="panel-people">
                  <thead>
                    <tr>
                      <th>Name</th>
                      {ROLES.map((item) => (
                        <th key={item.role} className="text-center">
                          {item.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((row) => (
                      <tr key={row.contactId} data-testid="panel-person" data-name={row.name}>
                        <td className="max-w-[12rem]">
                          <Link href={`/dashboard/contacts/${row.contactId}`} className="link block truncate max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]">
                            {row.name}
                          </Link>
                          <span className="faint block text-[0.65rem]">
                            {[row.company, row.fromMeeting ? "from the meeting" : "added"].filter(Boolean).join(" · ")}
                          </span>
                        </td>
                        {ROLES.map((item) => (
                          <td key={item.role} className="text-center">
                            {/* A greyed-out box is the browser's own disabled look,
                                as everywhere else; an extra 30% fade made it all
                                but vanish on white (UX review). */}
                            <input
                              type="checkbox"
                              checked={row.role === item.role}
                              disabled={row.role !== null && row.role !== item.role}
                              onChange={() => tick(row.contactId, item.role)}
                              aria-label={`${row.name}: ${item.label}`}
                              className="h-4 w-4 accent-[var(--brand)]"
                              data-testid={`role-${item.role}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <AddPerson
                exclude={people.map((row) => row.contactId)}
                onAdd={(person) => setPeople((rows) => [...rows, { ...person, role: "ASSOCIATED", fromMeeting: false }])}
              />
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Meetings</h3>
              {detail.meetings.length === 0 ? (
                <p className="faint text-xs">No meeting logged on this one.</p>
              ) : (
                <ul className="space-y-1 text-xs" data-testid="panel-meetings">
                  {detail.meetings.map((meeting) => (
                    <li key={meeting.id} className="flex items-center gap-1.5">
                      <IconCalendar size={12} className="faint" />
                      {formatDate(meeting.on, timeZone)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Quotes</h3>
                {primary && (
                  <Link
                    href={`/dashboard/quotes/new?contactId=${primary.contactId}${detail.deal ? `&dealId=${detail.deal.id}` : ""}`}
                    className="btn btn-ghost btn-sm"
                    data-testid="panel-new-quote"
                  >
                    <IconPlus size={12} />
                    New quote
                  </Link>
                )}
              </div>
              {detail.deal?.quotes.length ? (
                <ul className="space-y-1 text-xs">
                  {detail.deal.quotes.map((quote) => (
                    <li key={quote.id}>
                      <Link href={`/dashboard/quotes/${quote.id}`} className="link flex items-center gap-1.5">
                        <IconFileText size={12} />
                        <span className="num">QUO-{quote.number}</span>
                        <span className="truncate">{quote.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="faint text-xs">No quotes yet.</p>
              )}
              {detail.deal && (
                <Link href={`/dashboard/deals/tracker?dealId=${detail.deal.id}`} className="faint mt-2 flex items-center gap-1 text-xs hover:text-[var(--text)]">
                  <IconClock size={12} />
                  Contract Coordinator
                </Link>
              )}
            </section>
          </div>
        )}

        <div className="border-t border-[var(--hairline-3)] px-5 py-3">
          {error && <p className="mb-2 text-xs text-[var(--danger)]" data-testid="panel-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button type="button" onClick={() => save()} disabled={!detail || pending} className="btn btn-primary btn-sm" data-testid="panel-save">
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

type Found = { id: string; name: string; company: string | null; email: string | null; phone: string | null };

// "+ Add contact": search the workspace's contacts by name, company,
// email or phone; a pick joins as Associated POC.
function AddPerson({
  exclude,
  onAdd,
}: {
  exclude: string[];
  onAdd: (person: { contactId: string; name: string; company: string | null; email: string | null; phone: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/dashboard/contacts/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : []))
        .then((rows: Found[]) => setResults(rows))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="link mt-2 inline-flex items-center gap-1 text-xs" data-testid="panel-add-person">
        <IconPlus size={12} />
        Add contact
      </button>
    );
  }
  const shown = query.trim().length >= 2 ? results.filter((row) => !exclude.includes(row.id)) : [];
  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] p-2">
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search contacts by name, company, email or phone"
        aria-label="Search contacts"
        className="input input-sm"
        data-testid="panel-add-search"
      />
      <ul className="mt-1 max-h-48 overflow-y-auto">
        {query.trim().length >= 2 && shown.length === 0 && <li className="faint px-2 py-1.5 text-xs">Nobody new matches.</li>}
        {shown.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => {
                onAdd({ contactId: row.id, name: row.name, company: row.company, email: row.email, phone: row.phone });
                setQuery("");
                setResults([]);
              }}
              className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--hover)]"
              data-testid="panel-add-result"
            >
              <span className="font-medium">{row.name}</span>
              <span className="faint">{[row.company, row.email, row.phone].filter(Boolean).join(" · ")}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setOpen(false)} className="link mt-1 text-xs">
        Done adding
      </button>
    </div>
  );
}
