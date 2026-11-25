"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSparkles, IconX } from "@/components/icons";
import { Badge } from "@/components/ui";
import { SameBox } from "./same-box";
import { MicButton, MIC_STOP } from "@/components/how-did-it-go/mic";
import { UndoToast } from "@/components/how-did-it-go/undo-toast";
import { readActivityWords, saveActivityCard, undoActivityCard } from "@/app/dashboard/deals/activity-ai-actions";
import {
  ACTIVITY_OUTCOME_LABELS,
  CONNECT_OUTCOMES,
  NOTE_LABELS,
  NOTE_LABEL_NAMES,
  OUTCOMES_BY_TYPE,
  STATUS_REASONS,
  STATUS_REASON_LABELS,
  type ActivityTypeValue,
} from "@/lib/constants";
import {
  centsToDollarText,
  pipelineLine,
  type ActivityCard,
  type CardCompany,
  type CardPerson,
  type CompanyCandidate,
  type OpenTile,
  type PersonCandidate,
  type Pick,
  type ReadResult,
} from "@/lib/activity-ai-shared";

// The Pipeline AI bar (Release 1, Activity AI, Nov 25, 2026). Type or say
// what happened; "Read it" asks the AI for cards; each card is checked and
// saved on its own. People and businesses are shared by every card from one
// sentence: Sue found (or made) once is Sue on the next card. Nothing is
// saved until a card's Save; each save gets one "Saved · Undo".

const TYPE_WORD: Record<ActivityTypeValue, string> = { PHONE_CALL: "Call", TEXT: "Text", EMAIL: "Email", MEETING: "Meeting" };
const TYPE_ORDER: ActivityTypeValue[] = ["PHONE_CALL", "TEXT", "EMAIL", "MEETING"];
const KIND_WORD: Record<ActivityCard["kind"], string> = { LOG: "Log", BOOK: "Book a meeting", SCHEDULE: "Put on the calendar", NOTE: "Note" };

const noop = () => {};

// When a save landed, for the toast's ten seconds.
const stamp = () => Date.now();

const chip = (on: boolean) => `btn btn-sm min-h-11 sm:min-h-0 ${on ? "btn-primary" : "btn-ghost"}`;

type Toast = { batchId: string; words: string; at: number; token: string };

export function PipelineAiBar({ autoFocus = false, onBusy }: { autoFocus?: boolean; onBusy?: (busy: boolean) => void }) {
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);
  // A card was saved from this sentence: the box empties once none are left.
  const savedAny = useRef(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<ReadResult | null>(null);
  const [cards, setCards] = useState<ActivityCard[]>([]);
  const [people, setPeople] = useState<CardPerson[]>([]);
  const [companies, setCompanies] = useState<CardCompany[]>([]);
  const [rep, setRep] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    onBusy?.(reading || saving !== null);
  }, [reading, saving, onBusy]);

  async function readIt() {
    const words = (box.current?.value ?? "").trim();
    box.current?.dispatchEvent(new Event(MIC_STOP));
    if (words.length < 3) {
      setError("Say or type what happened first");
      return;
    }
    setError(null);
    setReading(true);
    try {
      const result = await readActivityWords({ words });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setRead(result);
      setCards(result.cards);
      setPeople(result.people);
      setCompanies(result.companies);
      setRep(result.meId);
      setCardErrors({});
    } catch {
      setError("That couldn't be read just now. Try again.");
    } finally {
      setReading(false);
    }
  }

  function clearAll() {
    setRead(null);
    setCards([]);
    setPeople([]);
    setCompanies([]);
    setCardErrors({});
  }

  // A card saved or dismissed (other cards keep any edits made meanwhile).
  const dropCard = (id: string) => setCards((all) => all.filter((each) => each.id !== id));
  // The sentence is done once its last card is saved: the box empties for
  // the next one. Dismissing every card keeps the words to read again.
  useEffect(() => {
    if (cards.length === 0 && savedAny.current && box.current) {
      box.current.value = "";
      savedAny.current = false;
    }
  }, [cards.length]);

  const updateCard = (id: string, patch: Partial<ActivityCard>) => setCards((all) => all.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  const pickPerson = (key: string, pick: Pick) => setPeople((all) => all.map((row) => (row.key === key ? { ...row, pick } : row)));
  const pickCompany = (key: string, pick: Pick) => setCompanies((all) => all.map((row) => (row.key === key ? { ...row, pick } : row)));

  async function save(card: ActivityCard) {
    setSaving(card.id);
    setCardErrors((all) => ({ ...all, [card.id]: "" }));
    const onCard = card.personKeys.map((key) => people.find((row) => row.key === key)).filter((row): row is CardPerson => Boolean(row));
    const companyKeys = new Set([
      ...(card.companyKey ? [card.companyKey] : []),
      ...onCard.flatMap((row) => (row.said.companyKey ? [row.said.companyKey] : [])),
    ]);
    const used = companies.filter((row) => companyKeys.has(row.key) && row.pick);
    try {
      const result = await saveActivityCard({
        // A deal only when the card offers one (not "Already a deal", not a
        // meeting still to come); the AI's guess is never sent past that.
        card: dealAllowed(card, onCard, read) ? card : { ...card, deal: "NONE", valueCents: null },
        people: onCard.map((row) => ({ key: row.key, said: row.said, pick: row.pick! })),
        companies: used.map((row) => ({ key: row.key, said: row.said, pick: row.pick! })),
        rep,
      });
      if (!result.ok) {
        setCardErrors((all) => ({ ...all, [card.id]: result.error }));
        // Look-alikes the server found: the box asks about each.
        if (result.people) {
          const hits = result.people;
          setPeople((all) => all.map((row) => (hits[row.key] ? { ...row, pick: null, candidates: mergeCandidates(row.candidates, hits[row.key]) } : row)));
        }
        if (result.companies) {
          const hits = result.companies;
          setCompanies((all) => all.map((row) => (hits[row.key] ? { ...row, pick: null, candidates: mergeCandidates(row.candidates, hits[row.key]) } : row)));
        }
        return;
      }
      // What the save made is found from now on, for the other cards.
      for (const made of result.created) {
        if (made.kind === "person") {
          setPeople((all) =>
            all.map((row) => {
              if (row.key !== made.key) return row;
              const companyKey = row.said.companyKey;
              const company = companyKey ? companies.find((each) => each.key === companyKey) : null;
              const companyName = company ? (shownCompany(company)?.name ?? company.said.name) : null;
              return {
                ...row,
                pick: { kind: "found", id: made.id },
                candidates: [
                  { id: made.id, name: row.said.name, companyId: null, companyName, email: row.said.email, phone: row.said.phone, reason: "Just added", strong: true },
                  ...row.candidates,
                ],
              };
            }),
          );
        } else {
          setCompanies((all) =>
            all.map((row) =>
              row.key === made.key
                ? { ...row, pick: { kind: "found", id: made.id }, candidates: [{ id: made.id, name: row.said.name, city: row.said.city, state: row.said.state, reason: "Just added", strong: true }, ...row.candidates] }
                : row,
            ),
          );
        }
      }
      savedAny.current = true;
      dropCard(card.id);
      // Keyed by the save's own token: card ids repeat from one sentence to the
      // next, and the toast remembers which save it already undid.
      if (result.undo) setToast({ batchId: result.undo, words: result.words, at: stamp(), token: result.undo });
      else setToast(null);
      if (result.quoteUrl) {
        router.push(result.quoteUrl);
        return;
      }
      router.refresh();
    } catch {
      setCardErrors((all) => ({ ...all, [card.id]: "That didn't save. Check your connection and try again." }));
    } finally {
      setSaving(null);
    }
  }


  const onUndone = useCallback(() => router.refresh(), [router]);
  const closeToast = useCallback(() => setToast(null), []);
  const token = toast?.token;
  const undo = useCallback(() => undoActivityCard(token ?? ""), [token]);

  return (
    <section className="card mb-4 min-w-0 p-3 sm:p-4" data-testid="pai-bar" aria-label="Pipeline AI">
      <form
        className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          void readIt();
        }}
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <IconSparkles size={15} className="mt-3 shrink-0 text-[var(--brand)]" />
          <textarea
            ref={box}
            rows={2}
            maxLength={2000}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void readIt();
              }
            }}
            placeholder="Tell me what happened: “Talked to Bob at Acme Roofing, wants 12 cameras quoted. Meeting Tuesday at 2.”"
            aria-label="Tell me what happened"
            className="input min-h-11 min-w-0 flex-1 resize-y"
            data-testid="pai-words"
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-0.5">
          <MicButton target={box} onWords={noop} disabled={reading} testId="pai-mic" />
          <button type="submit" disabled={reading} className="btn btn-primary btn-sm min-h-11 sm:min-h-0" data-testid="pai-read">
            {reading ? "Reading…" : "Read it"}
          </button>
        </div>
      </form>
      {error && (
        <p className="mt-2 text-sm text-[var(--danger)]" role="alert" data-testid="pai-error">
          {error}
        </p>
      )}
      {read && read.dropped > 0 && cards.length > 0 && (
        <p className="faint mt-2 text-xs" data-testid="pai-dropped">
          {read.dropped === 1 ? "One thing I heard" : `${read.dropped} things I heard`} didn&apos;t match your words and {read.dropped === 1 ? "was" : "were"} left out. Check the cards.
        </p>
      )}
      {read && cards.length > 0 && (
        <div className="mt-3 space-y-3">
          {cards.map((card) => (
            <CardView
              key={card.id}
              card={card}
              read={read}
              people={people}
              companies={companies}
              rep={rep}
              setRep={setRep}
              saving={saving === card.id}
              busy={saving !== null}
              error={cardErrors[card.id] || null}
              onChange={(patch) => updateCard(card.id, patch)}
              onPickPerson={pickPerson}
              onPickCompany={pickCompany}
              onSave={() => void save(card)}
              onCancel={() => dropCard(card.id)}
            />
          ))}
          {cards.length > 1 && (
            <div className="flex justify-end">
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll} data-testid="pai-clear">
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
      <UndoToast saved={toast} onDone={closeToast} onUndone={onUndone} undo={undo} />
    </section>
  );
}

// What CardView shows as "Make it a deal", worked out the same way for Save.
function dealAllowed(card: ActivityCard, onCard: CardPerson[], read: ReadResult | null) {
  if (!read || card.kind !== "LOG" || onCard.length === 0 || card.outcome === "NO_SHOW" || card.interest === "NOT_INTERESTED") return false;
  const tiles = onCard.flatMap((row) => (row.pick?.kind === "found" ? (read.tiles[row.pick.id] ?? []) : []));
  if (tiles.some((tile) => tile.hasDeal)) return false;
  const firstFound = onCard[0]?.pick?.kind === "found" ? onCard[0].pick.id : null;
  if (card.type !== "MEETING" && firstFound && (read.tiles[firstFound] ?? []).some((tile) => !tile.hasDeal && tile.columnKey === "MEETING_SET")) return false;
  return true;
}

function mergeCandidates<T extends { id: string }>(had: T[], more: T[]): T[] {
  const seen = new Set(more.map((row) => row.id));
  return [...more, ...had.filter((row) => !seen.has(row.id))].slice(0, 8);
}

function shownPerson(person: CardPerson): PersonCandidate | null {
  return person.pick?.kind === "found" ? (person.candidates.find((row) => row.id === (person.pick as { id: string }).id) ?? null) : null;
}

function shownCompany(company: CardCompany): CompanyCandidate | null {
  return company.pick?.kind === "found" ? (company.candidates.find((row) => row.id === (company.pick as { id: string }).id) ?? null) : null;
}

function place(row: { city: string | null; state: string | null }) {
  return [row.city, row.state].filter(Boolean).join(", ");
}

function CardView({
  card,
  read,
  people,
  companies,
  rep,
  setRep,
  saving,
  busy,
  error,
  onChange,
  onPickPerson,
  onPickCompany,
  onSave,
  onCancel,
}: {
  card: ActivityCard;
  read: ReadResult;
  people: CardPerson[];
  companies: CardCompany[];
  rep: string;
  setRep: (value: string) => void;
  saving: boolean;
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<ActivityCard>) => void;
  onPickPerson: (key: string, pick: Pick) => void;
  onPickCompany: (key: string, pick: Pick) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const onCard = card.personKeys.map((key) => people.find((row) => row.key === key)).filter((row): row is CardPerson => Boolean(row));
  const company = card.companyKey && onCard.length === 0 ? (companies.find((row) => row.key === card.companyKey) ?? null) : null;
  const hasPerson = onCard.length > 0;
  // A new person's business, when one was said.
  const companyOf = (person: CardPerson) => (person.said.companyKey ? (companies.find((row) => row.key === person.said.companyKey) ?? null) : null);
  const needed = [
    ...onCard.map((row) => row.pick),
    ...(company ? [company.pick] : []),
    ...onCard.flatMap((row) => (row.pick?.kind === "new" && companyOf(row) ? [companyOf(row)!.pick] : [])),
  ];
  const anyNew =
    onCard.some((row) => row.pick?.kind === "new") ||
    company?.pick?.kind === "new" ||
    onCard.some((row) => row.pick?.kind === "new" && companyOf(row)?.pick?.kind === "new");

  // Found people's open tiles, for the Pipeline line and the deal choice.
  const tiles: OpenTile[] = onCard.flatMap((row) => (row.pick?.kind === "found" ? (read.tiles[row.pick.id] ?? []) : []));
  const dealTile = tiles.find((tile) => tile.hasDeal) ?? null;
  // Off anything but a held meeting, a tile whose meeting is still to come
  // is left for the meeting (converting it would mark that meeting held).
  const firstFound = onCard[0]?.pick?.kind === "found" ? onCard[0].pick.id : null;
  const setTile = card.type !== "MEETING" && firstFound ? ((read.tiles[firstFound] ?? []).find((tile) => !tile.hasDeal && tile.columnKey === "MEETING_SET") ?? null) : null;
  const canDeal = dealAllowed(card, onCard, read);

  const today = read.today;
  const types = card.kind === "BOOK" ? (["MEETING"] as ActivityTypeValue[]) : card.kind === "SCHEDULE" ? TYPE_ORDER.filter((type) => type !== "MEETING") : hasPerson ? TYPE_ORDER : TYPE_ORDER.filter((type) => type !== "MEETING");
  const outcomes = card.kind === "LOG" && card.type ? OUTCOMES_BY_TYPE[card.type].filter((key) => hasPerson || !CONNECT_OUTCOMES.includes(key)) : [];

  // Why Save waits, in words.
  const blocker = (() => {
    if (!hasPerson && !company) return "Who was it with?";
    if (needed.some((pick) => pick === null)) return "Answer the box above first.";
    if (card.kind !== "NOTE" && !card.type) return "Pick what kind of touch it was.";
    if (card.kind === "LOG" && card.day && card.day > today) return "That day is ahead. It can't be logged yet.";
    if (card.kind === "BOOK" && (!card.day || card.day < today)) return "Pick the day of the meeting.";
    if (card.kind === "SCHEDULE" && (!card.day || card.day <= today)) return "Pick a day ahead.";
    if (card.kind === "NOTE" && !card.notes.trim()) return "Write the note.";
    if (canDeal && card.deal === "PRICED" && !card.valueCents) return "Enter the price you gave them.";
    return null;
  })();

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4" data-testid="pai-card" data-kind={card.kind}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold" data-testid="pai-card-kind">
          {KIND_WORD[card.kind]}
        </p>
        <button type="button" onClick={onCancel} disabled={saving} className="btn btn-ghost btn-sm min-h-11 min-w-11 justify-center !px-2 sm:min-h-0" aria-label="Dismiss this card" data-testid="pai-cancel-x">
          <IconX size={14} />
        </button>
      </div>

      {card.kind !== "NOTE" && (
        <div role="group" aria-label="Kind of touch" className="mt-2 flex flex-wrap gap-1.5">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={card.type === type}
              onClick={() =>
                onChange({
                  type,
                  outcome: card.kind === "LOG" ? (type === "MEETING" ? "HELD" : card.outcome && OUTCOMES_BY_TYPE[type].includes(card.outcome) ? card.outcome : null) : null,
                })
              }
              className={chip(card.type === type)}
              data-testid={`pai-type-${type}`}
            >
              {TYPE_WORD[type]}
            </button>
          ))}
        </div>
      )}

      {outcomes.length > 0 && (
        <div role="group" aria-label="How it went" className="mt-2 flex flex-wrap gap-1.5">
          {outcomes.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={card.outcome === key}
              onClick={() => onChange({ outcome: card.outcome === key && card.type !== "MEETING" ? null : key })}
              className={chip(card.outcome === key)}
              data-testid={`pai-outcome-${key}`}
            >
              {ACTIVITY_OUTCOME_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      <dl className="mt-3 space-y-2 text-sm">
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
          <dt className="label !mb-0 sm:pt-1">With</dt>
          <dd className="min-w-0 space-y-2">
            {onCard.map((person) => (
              <PersonRow
                key={person.key}
                person={person}
                company={person.pick?.kind === "new" ? companyOf(person) : null}
                removable={onCard.length > 1 || Boolean(card.companyKey)}
                onPick={(pick) => onPickPerson(person.key, pick)}
                onPickCompany={onPickCompany}
                onRemove={() => onChange({ personKeys: card.personKeys.filter((key) => key !== person.key) })}
              />
            ))}
            {company && (
              <div data-testid="pai-company-only">
                <CompanyRow company={company} onPick={(pick) => onPickCompany(company.key, pick)} />
                <p className="faint mt-1 text-xs">Front desk / main line. Nobody named, so it waits on the company&apos;s page to be linked to a person.</p>
              </div>
            )}
            {!hasPerson && !company && <p className="text-[var(--danger)]">Nobody left on this card.</p>}
          </dd>
        </div>

        {card.kind !== "NOTE" && (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
            <dt className="label !mb-0 sm:pt-1">When</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={card.day ?? ""}
                max={card.kind === "LOG" ? today : undefined}
                min={card.kind === "BOOK" ? today : undefined}
                onChange={(event) => onChange({ day: event.target.value || null })}
                className="input input-sm w-auto"
                aria-label="Day"
                data-testid="pai-day"
              />
              <input
                type="time"
                value={card.time ?? ""}
                onChange={(event) => onChange({ time: event.target.value || null })}
                className="input input-sm w-auto"
                aria-label="Time"
                data-testid="pai-time"
              />
              {card.kind === "LOG" && card.day === today && <span className="faint text-xs">Today</span>}
            </dd>
          </div>
        )}

        {card.kind === "BOOK" && (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
            <dt className="label !mb-0 sm:pt-1">Where</dt>
            <dd>
              <input
                value={card.where ?? ""}
                onChange={(event) => onChange({ where: event.target.value || null })}
                className="input input-sm"
                maxLength={200}
                placeholder="Optional"
                aria-label="Where"
                data-testid="pai-where"
              />
            </dd>
          </div>
        )}

        <div className="grid grid-cols-1 gap-1 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
          <dt className="label !mb-0 sm:pt-1">{card.kind === "NOTE" ? "Note" : "Notes"}</dt>
          <dd className="min-w-0 space-y-2">
            <textarea
              value={card.notes}
              rows={2}
              maxLength={5000}
              onChange={(event) => onChange({ notes: event.target.value })}
              className="input min-h-11 w-full resize-y"
              aria-label={card.kind === "NOTE" ? "Note" : "Notes"}
              data-testid="pai-notes"
            />
            {card.kind === "NOTE" && (
              <select
                value={card.noteLabel ?? ""}
                onChange={(event) => onChange({ noteLabel: (event.target.value || null) as ActivityCard["noteLabel"] })}
                className="input input-sm w-auto"
                aria-label="Note label"
                data-testid="pai-note-label"
              >
                <option value="">No label</option>
                {NOTE_LABELS.map((key) => (
                  <option key={key} value={key}>
                    {NOTE_LABEL_NAMES[key]}
                  </option>
                ))}
              </select>
            )}
          </dd>
        </div>

        {card.kind === "LOG" && hasPerson && card.outcome !== "NO_SHOW" && (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
            <dt className="label !mb-0 sm:pt-1">Interest</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {(["INTERESTED", "NOT_INTERESTED"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={card.interest === key}
                  onClick={() => onChange({ interest: card.interest === key ? null : key, reason: null, ...(key === "NOT_INTERESTED" ? { deal: "NONE", valueCents: null } : {}) })}
                  className={chip(card.interest === key)}
                  data-testid={`pai-interest-${key}`}
                >
                  {key === "INTERESTED" ? "Interested" : "Not interested"}
                </button>
              ))}
              {card.interest === "NOT_INTERESTED" && (
                <select
                  value={card.reason ?? ""}
                  onChange={(event) => onChange({ reason: (event.target.value || null) as ActivityCard["reason"] })}
                  className="input input-sm w-auto"
                  aria-label="Why not"
                  data-testid="pai-reason"
                >
                  <option value="">Why not? (optional)</option>
                  {STATUS_REASONS.map((key) => (
                    <option key={key} value={key}>
                      {STATUS_REASON_LABELS[key]}
                    </option>
                  ))}
                </select>
              )}
            </dd>
          </div>
        )}

        <div className="grid grid-cols-1 gap-1 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
          <dt className="label !mb-0 sm:pt-1">Pipeline</dt>
          <dd className="min-w-0 space-y-2">
            <p data-testid="pai-pipeline-line">{pipelineLine(card, tiles, hasPerson, canDeal && card.deal !== "NONE")}</p>
            {card.kind === "LOG" && hasPerson && dealTile && (
              <p className="faint text-xs" data-testid="pai-already-deal">
                Already a deal on {dealTile.title} ({dealTile.column}).
              </p>
            )}
            {card.kind === "LOG" && hasPerson && !dealTile && setTile && (
              <p className="faint text-xs" data-testid="pai-meeting-ahead">
                {setTile.title} has a meeting still to come. Make it a deal from the tile after the meeting.
              </p>
            )}
            {canDeal && (
              <div className="space-y-2" data-testid="pai-deal">
                <div role="group" aria-label="Make it a deal" className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["NONE", "No deal yet"],
                      ["QUOTE", "Build Quote"],
                      ["PRICED", "I already gave them a price"],
                    ] as const
                  ).map(([key, words]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={card.deal === key}
                      onClick={() => onChange({ deal: key, dealTitle: card.dealTitle || defaultDealTitle(onCard, companies) })}
                      className={chip(card.deal === key)}
                      data-testid={`pai-deal-${key}`}
                    >
                      {words}
                    </button>
                  ))}
                </div>
                {card.deal !== "NONE" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={card.dealTitle}
                      onChange={(event) => onChange({ dealTitle: event.target.value })}
                      maxLength={160}
                      className="input input-sm min-w-0 flex-1 basis-48"
                      aria-label="Deal name"
                      placeholder="Deal name"
                      data-testid="pai-deal-title"
                    />
                    {card.deal === "PRICED" && (
                      <label className="flex items-center gap-1">
                        <span className="faint">$</span>
                        <input
                          inputMode="decimal"
                          value={centsToDollarText(card.valueCents)}
                          onChange={(event) => {
                            const dollars = Number(event.target.value.replace(/[$,\s]/g, ""));
                            onChange({ valueCents: event.target.value.trim() && Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : null });
                          }}
                          className="input input-sm w-32"
                          aria-label="Price you gave them"
                          data-testid="pai-deal-value"
                        />
                      </label>
                    )}
                  </div>
                )}
                {card.deal === "QUOTE" && <p className="faint text-xs">Opens a new quote with its lines drafted from your words, priced from your catalog.</p>}
                {card.deal === "PRICED" && <p className="faint text-xs">The deal goes to Quote Sent at that price.</p>}
              </div>
            )}
          </dd>
        </div>

        {anyNew && (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
            <dt className="label !mb-0 sm:pt-1">Rep</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <select value={rep} onChange={(event) => setRep(event.target.value)} className="input input-sm w-auto" aria-label="Rep on anything new" data-testid="pai-rep">
                {read.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.id === read.meId ? `You (${user.name})` : user.name}
                  </option>
                ))}
                <option value="">Unassigned</option>
              </select>
              <span className="faint text-xs">for the new {onCard.some((row) => row.pick?.kind === "new") ? "contact" : "company"}</span>
            </dd>
          </div>
        )}
      </dl>

      {error && (
        <p className="mt-3 text-sm text-[var(--danger)]" role="alert" data-testid="pai-card-error">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {blocker && (
          <span className="faint mr-auto text-xs" data-testid="pai-blocker">
            {blocker}
          </span>
        )}
        <button type="button" onClick={onCancel} disabled={saving} className="btn btn-ghost btn-sm min-h-11 sm:min-h-0" data-testid="pai-cancel">
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={Boolean(blocker) || busy} className="btn btn-primary btn-sm min-h-11 sm:min-h-0" data-testid="pai-save">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </article>
  );
}

function defaultDealTitle(people: CardPerson[], companies: CardCompany[]) {
  const first = people[0];
  if (!first) return "New deal";
  const found = shownPerson(first);
  if (found?.companyName) return found.companyName;
  const company = first.said.companyKey ? companies.find((row) => row.key === first.said.companyKey) : null;
  return (company ? (shownCompany(company)?.name ?? company.said.name) : null) ?? found?.name ?? first.said.name;
}

function PersonRow({
  person,
  company,
  removable,
  onPick,
  onPickCompany,
  onRemove,
}: {
  person: CardPerson;
  company: CardCompany | null;
  removable: boolean;
  onPick: (pick: Pick) => void;
  onPickCompany: (key: string, pick: Pick) => void;
  onRemove: () => void;
}) {
  const found = shownPerson(person);
  const state = person.pick === null ? "ask" : person.pick.kind === "found" ? "found" : "new";
  return (
    <div className="min-w-0" data-testid="pai-person" data-key={person.key} data-pick={state}>
      {state !== "ask" && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words font-medium">{found?.name ?? person.said.name}</span>
          {found?.companyName && <span className="faint">· {found.companyName}</span>}
          <span data-testid="pai-person-state">
            <Badge color={state === "found" ? "var(--ok)" : "var(--warn)"}>{state === "found" ? (found?.reason === "Just added" ? "Just added" : "Found") : "New"}</Badge>
          </span>
          {person.candidates.length > 0 && (
            <select
              value={person.pick?.kind === "found" ? person.pick.id : "new"}
              onChange={(event) => onPick(event.target.value === "new" ? { kind: "new", confirmed: true } : { kind: "found", id: event.target.value })}
              className="input input-sm w-auto max-w-full"
              aria-label={`Who ${person.said.name} is`}
              data-testid="pai-person-switch"
            >
              {person.candidates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {row.companyName ? ` · ${row.companyName}` : ""} ({row.reason})
                </option>
              ))}
              <option value="new">Someone new: {person.said.name}</option>
            </select>
          )}
          {removable && (
            <button type="button" onClick={onRemove} className="btn btn-ghost btn-sm min-h-11 min-w-11 justify-center !px-2 sm:min-h-0" aria-label={`Take ${person.said.name} off this card`} data-testid="pai-person-remove">
              <IconX size={12} />
            </button>
          )}
        </div>
      )}
      {state === "new" && (person.said.title || person.said.email || person.said.phone) && (
        <p className="faint mt-0.5 break-words text-xs">{[person.said.title, person.said.email, person.said.phone].filter(Boolean).join(" · ")}</p>
      )}
      {state === "ask" && (
        <SameBox
          what="person"
          said={person.said.name}
          rows={person.candidates.map((row) => ({ id: row.id, line: [row.name, row.companyName, row.email, row.phone].filter(Boolean).join(" · "), reason: row.reason }))}
          onUse={(id) => onPick({ kind: "found", id })}
          onNew={() => onPick({ kind: "new", confirmed: true })}
        />
      )}
      {state === "new" && company && (
        <div className="mt-1 pl-3">
          <p className="faint text-xs">at</p>
          <CompanyRow company={company} onPick={(pick) => onPickCompany(company.key, pick)} />
        </div>
      )}
      {state === "new" && !company && <p className="faint mt-0.5 text-xs">No company: a person on their own (Individual / Personal).</p>}
    </div>
  );
}

function CompanyRow({ company, onPick }: { company: CardCompany; onPick: (pick: Pick) => void }) {
  const found = shownCompany(company);
  const state = company.pick === null ? "ask" : company.pick.kind === "found" ? "found" : "new";
  if (state === "ask") {
    return (
      <div data-testid="pai-company" data-key={company.key} data-pick="ask">
        <SameBox
          what="company"
          said={company.said.name}
          rows={company.candidates.map((row) => ({ id: row.id, line: [row.name, place(row)].filter(Boolean).join(" · "), reason: row.reason }))}
          onUse={(id) => onPick({ kind: "found", id })}
          onNew={() => onPick({ kind: "new", confirmed: true })}
        />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="pai-company" data-key={company.key} data-pick={state}>
      <span className="min-w-0 break-words font-medium">{found?.name ?? company.said.name}</span>
      {found && place(found) && <span className="faint">· {place(found)}</span>}
      <span data-testid="pai-company-state">
        <Badge color={state === "found" ? "var(--ok)" : "var(--warn)"}>{state === "found" ? (found?.reason === "Just added" ? "Just added" : "Found") : "New"}</Badge>
      </span>
      {company.candidates.length > 0 && (
        <select
          value={company.pick?.kind === "found" ? company.pick.id : "new"}
          onChange={(event) => onPick(event.target.value === "new" ? { kind: "new", confirmed: true } : { kind: "found", id: event.target.value })}
          className="input input-sm w-auto max-w-full"
          aria-label={`Which ${company.said.name}`}
          data-testid="pai-company-switch"
        >
          {company.candidates.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
              {place(row) ? ` · ${place(row)}` : ""} ({row.reason})
            </option>
          ))}
          <option value="new">A new company: {company.said.name}</option>
        </select>
      )}
    </div>
  );
}
