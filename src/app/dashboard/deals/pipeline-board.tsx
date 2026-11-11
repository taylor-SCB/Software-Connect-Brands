"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PIPELINE_COLUMNS, PIPELINE_COLUMN_LABELS, STATUS_REASONS, STATUS_REASON_LABELS, type PipelineColumn } from "@/lib/constants";
import { formatCents, formatDay } from "@/lib/format";
import type { LeadHealth } from "@/lib/health";
import { LifecycleMeter } from "@/components/lifecycle-meter";
import { FloatingMenu } from "@/components/floating-menu";
import { LeadLabelChip, LeadLabelMenu, useMenuFocus } from "@/components/lead-label-chip";
import { undoLog } from "../contacts/actions";
import { markMeetingHeld, markMeetingNoShow, moveOpportunity, rescheduleMeeting, saveLostReason, setOpportunityLabel } from "./opportunity-actions";
import { ConvertDialog } from "./convert-dialog";
import { isMeetingColumn } from "./move-menu";
import { OpportunityPanel } from "./opportunity-panel";
import { FollowUpDialog } from "./ai-assist-ui";
import { useHowDidItGo, type SheetToast } from "@/components/how-did-it-go/how-did-it-go";
import { useBookMeeting } from "@/components/book-meeting/book-meeting";
import { dayChips, TIME_CHIPS } from "@/components/how-did-it-go/dates";
import type { MeetingFocus, TileAction, TileGroup, TileLine } from "./tile-line";

export type BoardTile = {
  id: string;
  title: string;
  // Where it sits: a column, or Archived (shown under Contract Sent when
  // archived deals are showing).
  column: PipelineColumn | "ARCHIVED";
  leadLabel: string | null;
  // Listed people, Primary first; `phone` is the mobile, else the phone.
  people: {
    id: string;
    name: string;
    company: string | null;
    primary: boolean;
    phone: string | null;
  }[];
  ownerId: string | null;
  ownerName: string | null;
  ownerInitials: string;
  // Days since anyone touched it, when that is past the workspace's
  // quietDays (src/lib/gone-quiet.ts); null when it isn't quiet.
  quietDays: number | null;
  // The rules' lead label for a tile with none (src/lib/lead-label-rules.ts),
  // shown in the panel only.
  suggestedLabel: { label: string; reason: string } | null;
  health: LeadHealth | null;
  // Meeting Set only: "coming" (Coming up) or "happened" (Happened — how did it go?).
  group: TileGroup | null;
  focus: MeetingFocus | null;
  sortKey: string;
  line: TileLine;
  action: TileAction;
  meetingCount: number;
  deal: {
    id: string;
    stage: string;
    valueCents: number;
    quotes: { id: string; number: number; title: string }[];
  } | null;
};

const DEAL_COLUMNS: readonly string[] = ["QUOTE_SENT", "CONTRACT_SENT", "WON", "LOST"];
// A deal past a draft quote can't go back to a meeting column.
const isDeal = (tile: BoardTile) => Boolean(tile.deal && (DEAL_COLUMNS.includes(tile.deal.stage) || tile.deal.stage === "ARCHIVED"));
const shownIn = (tile: BoardTile): PipelineColumn => (tile.column === "ARCHIVED" ? "CONTRACT_SENT" : tile.column);

// The board's three groups, in column order (Taylor, Nov 11, 2026).
const PIPELINE_GROUPS: { key: string; label: string; columns: PipelineColumn[] }[] = [
  { key: "bdr", label: "BDR", columns: ["MEETING_SET", "MEETING_COMPLETED"] },
  { key: "closer", label: "Closer", columns: ["QUOTE_SENT", "CONTRACT_SENT"] },
  { key: "closed", label: "Closed", columns: ["WON", "LOST"] },
];

// The phone's stage tabs: Set · Met · Quote · Contract · Closed.
const PHONE_TABS: { key: string; label: string; columns: PipelineColumn[] }[] = [
  { key: "MEETING_SET", label: "Set", columns: ["MEETING_SET"] },
  { key: "MEETING_COMPLETED", label: "Met", columns: ["MEETING_COMPLETED"] },
  { key: "QUOTE_SENT", label: "Quote", columns: ["QUOTE_SENT"] },
  { key: "CONTRACT_SENT", label: "Contract", columns: ["CONTRACT_SENT"] },
  { key: "CLOSED", label: "Closed", columns: ["WON", "LOST"] },
];

// The groups over the phone tabs: how many tabs each spans.
const PHONE_GROUP_SPANS = PIPELINE_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  span: new Set(PHONE_TABS.filter((tab) => tab.columns.some((column) => group.columns.includes(column))).map((tab) => tab.key)).size,
}));

// The phone tab a tile sits under (Set when there's none).
function tabOf(tile: BoardTile | undefined) {
  if (!tile) return "MEETING_SET";
  const column = shownIn(tile);
  return PHONE_TABS.find((tab) => tab.columns.includes(column))?.key ?? "MEETING_SET";
}

const subscribeNothing = () => () => {};

const PHONE_QUERY = "(max-width: 767px)";
function usePhone() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(PHONE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

type Notice = {
  text: string;
  batchId?: string;
  lostFor?: string;
  error?: boolean;
};

// The Pipeline (rebuilt Oct 27, 2026; BDR redesign, Nov 11, 2026). One
// tile per opportunity, three lines under a 3px edge in its health colour:
// the Primary person with the company faint under them, the mini meter,
// and one next-step line. Meeting Set splits into "Coming up" (by meeting
// date) and "Happened — how did it go?" with Held / No-show / Reschedule.
// Drag a tile to another column, or use Move to… in its ⋯. A move forward
// out of Meeting Set means the meeting happened: one still ahead asks
// "This meeting is Tue Nov 17. Did it happen early?" first. Into Quote Sent
// or further with no deal asks "What happened after the meeting?"; a deal
// never goes back to a meeting. Click a tile to work it in the panel. On a
// phone: stage tabs with counts above one stage's cards, each ending with
// its one next-step button. ?open=<id> opens that tile's panel.
export function PipelineBoard({
  tiles,
  customLabels,
  timeZone,
  today,
  ai = false,
  openId = null,
}: {
  tiles: BoardTile[];
  customLabels: string[];
  timeZone: string;
  today: string;
  // ANTHROPIC_API_KEY is set: the AI helpers show.
  ai?: boolean;
  // The tile ?open= names, checked by the page as this workspace's (and
  // on the board even when the filters would leave it out).
  openId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const phone = usePhone();
  const [, startTransition] = useTransition();
  // Columns moved to and labels picked in this tab, until fresh tiles
  // come back from the server and replace them.
  const [local, setLocal] = useState<{
    base: BoardTile[];
    moved: Record<string, PipelineColumn>;
    labels: Record<string, string | null>;
  }>({
    base: tiles,
    moved: {},
    labels: {},
  });
  const current = local.base === tiles ? local : { base: tiles, moved: {}, labels: {} };
  const { moved, labels } = current;
  const setMoved = (change: (map: Record<string, PipelineColumn>) => Record<string, PipelineColumn>) =>
    setLocal((state) => {
      const fresh = state.base === tiles ? state : { base: tiles, moved: {}, labels: {} };
      return { ...fresh, moved: change(fresh.moved) };
    });
  const setLabels = (change: (map: Record<string, string | null>) => Record<string, string | null>) =>
    setLocal((state) => {
      const fresh = state.base === tiles ? state : { base: tiles, moved: {}, labels: {} };
      return { ...fresh, labels: change(fresh.labels) };
    });
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [converting, setConverting] = useState<{
    tile: BoardTile;
    stage: PipelineColumn;
    early: boolean;
  } | null>(null);
  const [early, setEarly] = useState<{
    tile: BoardTile;
    column: PipelineColumn;
    day: string;
  } | null>(null);
  const [panelId, setPanelId] = useState<string | null>(openId);
  const [followUp, setFollowUp] = useState<string | null>(null);
  // On a phone the opened tile's stage is the tab under its panel.
  const [tab, setTab] = useState(() => tabOf(tiles.find((tile) => tile.id === openId)));
  // ?open= opens its panel on load, and again if a link on this page names
  // another tile.
  const [openedFor, setOpenedFor] = useState(openId);
  if (openId !== openedFor) {
    setOpenedFor(openId);
    if (openId) {
      setPanelId(openId);
      setTab(tabOf(tiles.find((tile) => tile.id === openId)));
    }
  }

  // The panel is drawn on document.body, which the server doesn't have: one
  // ?open= asks for shows once the page is live in the browser.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);

  // Closing a panel ?open= opened takes it off the address, so a reload
  // doesn't open it again and a tile shown past the filters goes.
  function closePanel() {
    setPanelId(null);
    if (!params.has("open")) return;
    const query = new URLSearchParams(params.toString());
    query.delete("open");
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  useEffect(() => {
    if (!notice || notice.lostFor) return;
    const timer = setTimeout(() => setNotice(null), notice.batchId ? 10000 : 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // The shared sheets ("How did it go?" and Book meeting) live here, not in
  // the panel, so their "Saved · Undo" outlives a panel closed straight
  // after. They hand their toast to the board's notice (one toast slot on
  // the Pipeline, and no "Pipeline →": this is it), and anything they
  // write reloads the open panel and the board.
  const [reload, setReload] = useState(0);
  const changed = useCallback(() => {
    setReload((n) => n + 1);
    router.refresh();
  }, [router]);
  const sheetToast = useCallback((toast: SheetToast) => {
    setNotice({ text: toast.words, ...(toast.batchId ? { batchId: toast.batchId } : {}) });
  }, []);
  const how = useHowDidItGo({ dial: true, defaults: { onChanged: changed, onToast: sheetToast, opportunityId: panelId ?? undefined } });
  const book = useBookMeeting({ onChanged: changed, onToast: sheetToast });

  const columnOf = (tile: BoardTile) => moved[tile.id] ?? shownIn(tile);

  function say(text: string, extra: Omit<Notice, "text"> = {}) {
    setNotice({ text, ...extra });
  }

  function move(tile: BoardTile, column: PipelineColumn, options: { early?: boolean } = {}) {
    const from = columnOf(tile);
    if (from === column) return;
    if (isDeal(tile) && isMeetingColumn(column)) {
      say("A deal can't go back to a meeting column. Move it to Lost, or start a new opportunity.", { error: true });
      return;
    }
    // Out of Meeting Set means the meeting happened. The server decides
    // which meeting (the latest one gone by with no answer, else the next
    // one) and answers { confirmEarly } when that one is still ahead.
    // A Build Quote deal whose quote isn't sent is still a meeting tile.
    if (!isDeal(tile) && !isMeetingColumn(column)) {
      setConverting({ tile, stage: column, early: Boolean(options.early) });
      return;
    }
    setMoved((map) => ({ ...map, [tile.id]: column }));
    startTransition(async () => {
      const result = await moveOpportunity(tile.id, column, options);
      if (result.confirmEarly) {
        setMoved((map) => without(map, tile.id));
        setEarly({ tile, column, day: result.confirmEarly });
        return;
      }
      if (result.convert) {
        setMoved((map) => without(map, tile.id));
        setConverting({ tile, stage: column, early: Boolean(options.early) });
        return;
      }
      if (result.error) {
        setMoved((map) => without(map, tile.id));
        say(result.error, { error: true });
        return;
      }
      if (result.batchId) say(result.success ?? "Saved", { batchId: result.batchId });
      else if (column === "LOST") say("Moved to Lost. Why? (optional)", { lostFor: tile.id });
      router.refresh();
    });
  }

  function label(tile: BoardTile, next: string | null) {
    setLabels((map) => ({ ...map, [tile.id]: next }));
    startTransition(async () => {
      const result = await setOpportunityLabel(tile.id, next);
      if (result.error) {
        setLabels((map) => without(map, tile.id));
        say(result.error, { error: true });
        return;
      }
      router.refresh();
    });
  }

  // Held / No-show / Reschedule on a Happened tile.
  function held(tile: BoardTile, opts: { early?: boolean } = {}) {
    const meeting = tile.focus?.meeting;
    if (!meeting) return;
    startTransition(async () => {
      const result = await markMeetingHeld(meeting.id, opts);
      if (result.confirmEarly) {
        setEarly({
          tile,
          column: "MEETING_COMPLETED",
          day: result.confirmEarly,
        });
        return;
      }
      if (result.error) return say(result.error, { error: true });
      say(result.success ?? "Held", { batchId: result.batchId });
      router.refresh();
    });
  }
  function noShow(tile: BoardTile) {
    const meeting = tile.focus?.meeting;
    if (!meeting) return;
    startTransition(async () => {
      const result = await markMeetingNoShow(meeting.id);
      if (result.error) return say(result.error, { error: true });
      say(result.success ?? "No-show", { batchId: result.batchId });
      router.refresh();
    });
  }
  async function reschedule(tile: BoardTile, on: string, time: string | null) {
    const meeting = tile.focus?.meeting;
    if (!meeting) return "Nothing to reschedule";
    const result = await rescheduleMeeting(meeting.id, { on, time });
    if (result.error) return result.error;
    say(result.success ?? "Rescheduled", result.batchId ? { batchId: result.batchId } : {});
    router.refresh();
    return null;
  }

  function undo(batchId: string) {
    startTransition(async () => {
      const result = await undoLog(batchId);
      if (result.error) return say(result.error, { error: true });
      say("Undone");
      changed();
    });
  }

  const handlers: TileHandlers = {
    open: (tile) => setPanelId(tile.id),
    move,
    label,
    held,
    noShow,
    reschedule,
    followUp: (tile) => setFollowUp(tile.id),
    dragStart: (tile) => setDragging(tile.id),
    dragEnd: () => {
      setDragging(null);
      setOver(null);
    },
  };
  const tileProps = (tile: BoardTile) => ({
    tile,
    column: columnOf(tile),
    label: tile.id in labels ? labels[tile.id] : tile.leadLabel,
    customLabels,
    today,
    ai,
    phone,
    handlers,
  });

  return (
    <>
      {/* A mini meter's hover card opened as a tile was picked up stays open
          through the drag (the browser sends no mouse-leave while dragging)
          and sits over the columns: hidden until the drop. */}
      {dragging && <style>{"[data-testid=lifecycle-popover]{display:none!important}"}</style>}
      <HealthLegend />
      {phone ? (
        <PhoneBoard tiles={tiles} columnOf={columnOf} tab={tab} onTab={setTab} render={(tile) => <Tile key={tile.id} {...tileProps(tile)} />} />
      ) : (
        <TopScroll>
          {/* Three groups over the six columns (Taylor, Nov 11, 2026: Won
              and Lost stay two columns, with Closed over both). Each group is
              its own subgrid, so the heading spans its two columns and
              scrolls with them inside the same box as the top scrollbar. */}
          <div className="grid min-w-[1096px] gap-x-2" style={{ gridTemplateColumns: "repeat(6, minmax(176px, 1fr))" }}>
            {PIPELINE_GROUPS.map((group) => (
              <div
                key={group.key}
                role="group"
                aria-labelledby={`pipeline-group-${group.key}-label`}
                className="col-span-2 grid gap-y-2"
                style={{ gridTemplateColumns: "subgrid", gridTemplateRows: "auto 1fr" }}
                data-testid={`pipeline-group-${group.key}`}
              >
                <div
                  id={`pipeline-group-${group.key}-label`}
                  className="col-span-2 border-b border-[var(--hairline-3)] px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]"
                  data-testid="pipeline-group-heading"
                >
                  {group.label}
                </div>
                {group.columns.map((column) => {
                  const inColumn = tiles.filter((tile) => columnOf(tile) === column);
                  const value = inColumn.reduce((sum, tile) => sum + (tile.deal?.valueCents ?? 0), 0);
                  const meeting = isMeetingColumn(column);
                  const dropOk = dragging
                    ? canDrop(
                        tiles.find((tile) => tile.id === dragging),
                        column,
                      )
                    : false;
                  return (
                    <section
                      key={column}
                      aria-label={PIPELINE_COLUMN_LABELS[column]}
                      className={`card card-lit flex min-w-0 flex-col transition-shadow ${over === column && dropOk ? "ring-2 ring-[var(--brand)]" : ""}`}
                      data-testid={`pipeline-column-${column}`}
                      onDragOver={(event) => {
                        if (!dropOk) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setOver(column);
                      }}
                      onDragLeave={() => setOver((now) => (now === column ? null : now))}
                      onDrop={(event) => {
                        event.preventDefault();
                        const tile = tiles.find((row) => row.id === event.dataTransfer.getData("text/plain"));
                        setOver(null);
                        setDragging(null);
                        if (tile) move(tile, column);
                      }}
                    >
                      <div className="border-b border-[var(--hairline-3)] px-3 py-2.5">
                        <div className="flex items-baseline gap-2">
                          <h2 className="truncate text-sm font-semibold">{PIPELINE_COLUMN_LABELS[column]}</h2>
                          <span className="num text-xs text-[var(--text-dim)]" data-testid="pipeline-column-count">
                            {inColumn.length}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <HealthMix tiles={inColumn} />
                          {!meeting && value > 0 && (
                            <span className="num shrink-0 text-xs text-[var(--text-dim)]" data-testid="pipeline-column-value">
                              {formatCents(value)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="min-h-24 flex-1 space-y-2 p-2">
                        {inColumn.length === 0 && (
                          <p className="py-4 text-center text-xs text-[var(--text-dim)]">{meeting ? "Nobody here" : "No deals"}</p>
                        )}
                        {column === "MEETING_SET" ? (
                          <MeetingGroups tiles={inColumn} render={(tile) => <Tile key={tile.id} {...tileProps(tile)} />} />
                        ) : (
                          inColumn.map((tile) => <Tile key={tile.id} {...tileProps(tile)} />)
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            ))}
          </div>
        </TopScroll>
      )}

      {/* Drawn on the body, above the panel: the page's own layer would
          put "Saved · Undo" under an open panel. */}
      {notice &&
        createPortal(
          <div
            role="status"
            className="card popover fixed bottom-5 left-1/2 z-[90] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm"
            data-testid="pipeline-notice"
            data-kind={notice.error ? "error" : notice.lostFor ? "lost" : "ok"}
          >
            <span className={`min-w-0 flex-1 ${notice.error ? "text-[var(--danger)]" : ""}`}>{notice.text}</span>
            {notice.batchId && (
              <button type="button" onClick={() => undo(notice.batchId!)} className="btn btn-ghost btn-sm min-h-9 [@media(pointer:coarse)]:min-h-11" data-testid="pipeline-undo">
                Undo
              </button>
            )}
            {notice.lostFor && (
              <div className="flex w-full flex-wrap gap-1.5" data-testid="lost-reason">
                {STATUS_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => {
                      const id = notice.lostFor!;
                      startTransition(async () => {
                        const result = await saveLostReason(id, reason);
                        say(result.error ?? `Lost · ${STATUS_REASON_LABELS[reason]}`, result.error ? { error: true } : {});
                        router.refresh();
                      });
                    }}
                    className="btn btn-ghost btn-sm min-h-9 [@media(pointer:coarse)]:min-h-11"
                    data-testid={`lost-reason-${reason}`}
                  >
                    {STATUS_REASON_LABELS[reason]}
                  </button>
                ))}
                <button type="button" onClick={() => setNotice(null)} className="link ml-auto text-xs [@media(pointer:coarse)]:min-h-11" data-testid="lost-reason-skip">
                  Skip
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}

      {early && (
        <EarlyDialog
          day={early.day}
          onNo={() => setEarly(null)}
          onYes={() => {
            const { tile, column } = early;
            setEarly(null);
            if (column === "MEETING_COMPLETED" && tile.group === "happened") held(tile, { early: true });
            else move(tile, column, { early: true });
          }}
        />
      )}

      {converting && (
        <ConvertDialog
          tile={converting.tile}
          stage={converting.stage}
          today={today}
          early={converting.early}
          ai={ai}
          onClose={() => setConverting(null)}
          onDone={(quoteUrl, saved) => {
            setConverting(null);
            if (quoteUrl) router.push(quoteUrl);
            else {
              // Converting from Meeting Set held the meeting: say so, with Undo.
              // Undo takes back the Held; the deal stays (it can be moved on).
              if (saved?.batchId) say(`${saved.text ?? "Converted to a deal"} · the meeting is marked Held`, { batchId: saved.batchId });
              router.refresh();
            }
          }}
        />
      )}

      {followUp && <FollowUpDialog opportunityId={followUp} onClose={() => setFollowUp(null)} />}

      {panelId && hydrated && (
        <OpportunityPanel
          id={panelId}
          ai={ai}
          quietDays={tiles.find((row) => row.id === panelId)?.quietDays ?? null}
          suggestedLabel={tiles.find((row) => row.id === panelId)?.suggestedLabel ?? null}
          timeZone={timeZone}
          sheets={{ log: how.open, book: book.open }}
          reload={reload}
          onClose={closePanel}
          onSaved={(text, batchId) => {
            say(text, batchId ? { batchId } : {});
            router.refresh();
          }}
          onMove={(column, saved) => {
            const tile = tiles.find((row) => row.id === panelId);
            // A name just saved in the panel is the one the convert prompt offers.
            if (tile) move(saved ? { ...tile, title: saved.title } : tile, column);
          }}
        />
      )}
      {how.element}
      {book.element}
    </>
  );
}

function without<T>(map: Record<string, T>, key: string) {
  const rest = { ...map };
  delete rest[key];
  return rest;
}

function canDrop(tile: BoardTile | undefined, column: string) {
  if (!tile) return false;
  if (shownIn(tile) === column) return false;
  return !(isDeal(tile) && isMeetingColumn(column));
}

/* --------------------------- Columns and groups --------------------------- */

// Meeting Set in two groups: Coming up (by meeting date, no date last) and
// Happened — how did it go? (the longest waiting first).
function MeetingGroups({ tiles, render }: { tiles: BoardTile[]; render: (tile: BoardTile) => React.ReactNode }) {
  const coming = tiles.filter((tile) => tile.group !== "happened").sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const happened = tiles.filter((tile) => tile.group === "happened").sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return (
    <>
      {happened.length > 0 && (
        <div className="space-y-2" data-testid="meeting-group-happened">
          <h3 className="px-1 pt-1 text-xs font-semibold text-[var(--text-dim)]">
            Happened — how did it go? <span className="num">{happened.length}</span>
          </h3>
          {happened.map(render)}
        </div>
      )}
      {coming.length > 0 && (
        <div className="space-y-2" data-testid="meeting-group-coming">
          <h3 className="px-1 pt-1 text-xs font-semibold text-[var(--text-dim)]">
            Coming up <span className="num">{coming.length}</span>
          </h3>
          {coming.map(render)}
        </div>
      )}
    </>
  );
}

const MIX: { tone: "good" | "warn" | "risk" | "none" }[] = [{ tone: "good" }, { tone: "warn" }, { tone: "risk" }, { tone: "none" }];

// The thin 6px bar under a column's name: how its tiles split by health.
function HealthMix({ tiles }: { tiles: BoardTile[] }) {
  const byTone = { good: 0, warn: 0, risk: 0, none: 0 };
  const byWord = new Map<string, number>();
  for (const tile of tiles) {
    const tone = tile.health?.tone ?? "none";
    byTone[tone] += 1;
    const word = tile.health ? (tile.health.stalled ? "Trying, stalled" : tile.health.word) : "New";
    byWord.set(word, (byWord.get(word) ?? 0) + 1);
  }
  const label = [...byWord].map(([word, n]) => `${n} ${word}`).join(" · ");
  return (
    <div
      className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--tint-2)]"
      role="img"
      aria-label={tiles.length ? `Health: ${label}` : "No tiles"}
      title={label}
      data-testid="column-health"
      data-mix={MIX.map((row) => `${row.tone}:${byTone[row.tone]}`).join(",")}
    >
      {MIX.map((row) =>
        byTone[row.tone] ? (
          <span key={row.tone} data-health={row.tone} className="h-full" style={{ flexGrow: byTone[row.tone], background: "var(--hc)" }} />
        ) : null,
      )}
    </div>
  );
}

// One legend for every column's bar.
function HealthLegend() {
  const items = [
    { tone: "good", text: "Warm / Won" },
    { tone: "warn", text: "Cooling / stalled" },
    { tone: "risk", text: "Cold / owes" },
    { tone: "none", text: "Trying / new / closed" },
  ];
  return (
    <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-dim)]" data-testid="health-legend">
      <span>Health:</span>
      {items.map((item) => (
        <span key={item.tone} className="inline-flex items-center gap-1" data-health={item.tone}>
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--hc)" }} aria-hidden="true" />
          {item.text}
        </span>
      ))}
    </p>
  );
}

function PhoneBoard({
  tiles,
  columnOf,
  tab,
  onTab,
  render,
}: {
  tiles: BoardTile[];
  columnOf: (tile: BoardTile) => PipelineColumn;
  tab: string;
  onTab: (key: string) => void;
  render: (tile: BoardTile) => React.ReactNode;
}) {
  const current = PHONE_TABS.find((row) => row.key === tab) ?? PHONE_TABS[0];
  const counts = new Map(PHONE_TABS.map((row) => [row.key, tiles.filter((tile) => row.columns.includes(columnOf(tile))).length]));
  // The tabs stick under the phone's own sticky top bar (layout.tsx), not
  // at the top of the screen where that bar covered them (audit, Nov 11,
  // 2026). Its height is read, so a bar that wraps or grows still fits.
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("[data-testid=phone-top-bar]");
    if (!bar) return;
    const read = () => setBarHeight(getComputedStyle(bar).position === "sticky" ? bar.getBoundingClientRect().height : 0);
    read();
    const watch = new ResizeObserver(read);
    watch.observe(bar);
    return () => watch.disconnect();
  }, []);
  return (
    <div data-testid="pipeline-phone">
      <div
        role="tablist"
        aria-label="Stages"
        style={{ top: barHeight }}
        className="sticky top-0 z-20 -mx-5 mb-3 grid grid-cols-5 gap-1 border-b border-[var(--hairline-3)] bg-[var(--bg)] px-5 py-2"
        data-testid="pipeline-tabs"
      >
        {/* The group names over the tabs, in the same five-column grid:
            BDR over Set and Met, Closer over Quote and Contract, Closed over
            Closed. Words only, so screen readers hear the tabs alone. */}
        {PHONE_GROUP_SPANS.map((group) => (
          <span
            key={group.key}
            aria-hidden="true"
            className={`${group.span === 2 ? "col-span-2" : ""} truncate border-b border-[var(--hairline-3)] px-1 text-center text-[11px] font-semibold uppercase leading-4 tracking-wide text-[var(--text-dim)]`}
            data-testid="pipeline-phone-group"
          >
            {group.label}
          </span>
        ))}
        {PHONE_TABS.map((row) => (
          <button
            key={row.key}
            type="button"
            role="tab"
            aria-selected={row.key === current.key}
            onClick={() => onTab(row.key)}
            className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg px-1 text-xs font-medium leading-tight ${
              row.key === current.key ? "bg-[var(--brand)] text-white" : "text-[var(--text-dim)] hover:bg-[var(--hover)]"
            }`}
            data-testid={`pipeline-tab-${row.key}`}
          >
            <span className="truncate">{row.label}</span> <span className="num text-sm font-semibold">{counts.get(row.key) ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="space-y-2" role="tabpanel" data-testid={`pipeline-column-${current.key}`}>
        {current.columns.map((column) => {
          const inColumn = tiles.filter((tile) => columnOf(tile) === column);
          return (
            <div key={column} className="space-y-2">
              {current.columns.length > 1 && (
                <h2 className="px-1 pt-1 text-sm font-semibold">
                  {PIPELINE_COLUMN_LABELS[column]} <span className="num text-xs text-[var(--text-dim)]">{inColumn.length}</span>
                </h2>
              )}
              {column === "MEETING_SET" ? <MeetingGroups tiles={inColumn} render={render} /> : inColumn.map(render)}
              {inColumn.length === 0 && <p className="py-4 text-center text-xs text-[var(--text-dim)]">Nobody here</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------- Tile ---------------------------------- */

type TileHandlers = {
  open: (tile: BoardTile) => void;
  move: (tile: BoardTile, column: PipelineColumn) => void;
  label: (tile: BoardTile, label: string | null) => void;
  held: (tile: BoardTile) => void;
  noShow: (tile: BoardTile) => void;
  reschedule: (tile: BoardTile, on: string, time: string | null) => Promise<string | null>;
  followUp: (tile: BoardTile) => void;
  dragStart: (tile: BoardTile) => void;
  dragEnd: () => void;
};

function Tile({
  tile,
  column,
  label,
  customLabels,
  today,
  ai,
  phone,
  handlers,
}: {
  tile: BoardTile;
  column: PipelineColumn;
  label: string | null;
  customLabels: string[];
  today: string;
  ai: boolean;
  phone: boolean;
  handlers: TileHandlers;
}) {
  const more = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);
  useMenuFocus(menu, `tile-menu-${tile.id}`, more);
  const labelButton = useRef<HTMLButtonElement>(null);
  const person = tile.people[0] ?? null;
  const others = tile.people.slice(1);
  const name = person?.name ?? tile.title;
  // The company under the name, and the tile's own name when it says
  // something else (a renamed opportunity, a deal's name).
  const sub = [person?.company, tile.title !== name && tile.title !== person?.company ? tile.title : null].filter(Boolean).join(" · ");
  const tone = tile.health?.tone ?? "none";
  const decide = column === "MEETING_SET" && tile.focus && (tile.focus.kind === "due" || tile.focus.kind === "noshow");
  const quietSuffix = column === "MEETING_SET" && tile.quietDays !== null && tile.focus?.kind !== "ahead" ? ` · quiet ${tile.quietDays}d` : "";

  return (
    <article
      draggable={!phone}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", tile.id);
        event.dataTransfer.effectAllowed = "move";
        handlers.dragStart(tile);
      }}
      onDragEnd={handlers.dragEnd}
      onClick={(event) => {
        // Links, menus and pickers on the tile do their own thing.
        if ((event.target as HTMLElement).closest("a,button,select,input,label,[role=dialog]")) return;
        handlers.open(tile);
      }}
      className={`group relative min-w-0 rounded-lg border border-t-[3px] border-[var(--border)] border-t-[var(--hc)] bg-[var(--tint-1)] p-2.5 hover:border-[var(--border-strong)] hover:border-t-[var(--hc)] ${
        phone ? "" : "cursor-grab active:cursor-grabbing"
      }`}
      data-health={tone}
      data-testid="pipeline-tile"
      data-id={tile.id}
      data-title={tile.title}
      data-group={tile.group ?? undefined}
      data-quiet={tile.quietDays ?? undefined}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <button
          type="button"
          onClick={() => handlers.open(tile)}
          className="min-w-0 flex-1 text-left"
          aria-label={`Open ${name}${sub ? `, ${sub}` : ""}`}
          data-testid="tile-open"
        >
          <span className="flex min-w-0 items-baseline gap-1">
            <span className="truncate text-sm font-semibold" data-testid="tile-person">
              {name}
            </span>
            {others.length > 0 && (
              <span
                className="num shrink-0 text-xs text-[var(--text-dim)]"
                title={`Also: ${others.map((row) => row.name).join(", ")}`}
                data-testid="tile-others"
                data-names={others.map((row) => row.name).join("|")}
              >
                +{others.length}
              </span>
            )}
          </span>
          {sub && (
            <span className="block truncate text-xs text-[var(--text-dim)]" data-testid="tile-company">
              {sub}
            </span>
          )}
        </button>
        {tile.ownerInitials && (
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[0.58rem] font-semibold text-[var(--text-dim)]"
            title={`Rep: ${tile.ownerName}`}
            aria-label={`Rep: ${tile.ownerName}`}
            data-testid="tile-rep"
            data-owner-id={tile.ownerId ?? ""}
          >
            {tile.ownerInitials}
          </span>
        )}
        <button
          ref={more}
          type="button"
          onClick={() => setMenu(!menu)}
          aria-label={`More for ${name}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          className="-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base leading-none text-[var(--text-dim)] hover:bg-[var(--hover)] hover:text-[var(--text)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          data-testid="tile-more"
        >
          ⋯
        </button>
      </div>

      {tile.health && (
        <div className="mt-1.5 min-w-0">
          <LifecycleMeter health={tile.health} size="mini" testId="tile-meter" />
        </div>
      )}

      {/* The next-step line, then the lead label only when one is set. A tile
          with none offers "+ label" in its corner on hover or keyboard focus
          (and Lead label… under ⋯), drawn over the tile so nothing moves. */}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-x-1.5 gap-y-1">
        {tile.line.text && (
          <p
            className={`min-w-0 text-xs ${tile.line.tone === "warn" ? "font-medium text-[var(--text)]" : "text-[var(--text-dim)]"}`}
            data-testid="tile-line"
            data-key={tile.line.key}
          >
            {tile.line.text}
            {quietSuffix}
          </p>
        )}
        {label && (
          <button
            ref={labelButton}
            type="button"
            onClick={() => setLabelMenu(!labelMenu)}
            className="ml-auto min-w-0 max-w-full"
            aria-label={`Lead label: ${label}. Change it`}
            data-testid="lead-label-picker"
          >
            <LeadLabelChip label={label} size="xs" />
          </button>
        )}
      </div>
      {!label && (
        <button
          ref={labelButton}
          type="button"
          onClick={() => setLabelMenu(!labelMenu)}
          className="absolute bottom-1.5 right-1.5 rounded-md border border-[var(--border)] bg-[var(--overlay)] px-1.5 py-0.5 text-xs text-[var(--text-dim)] opacity-0 hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:hidden"
          aria-label="Add a lead label"
          data-testid="tile-add-label"
        >
          + label
        </button>
      )}

      {decide && (
        <div className="mt-2 grid grid-cols-2 gap-1.5" data-testid="tile-decide">
          {tile.focus?.kind === "due" ? (
            <>
              <button
                type="button"
                onClick={() => handlers.held(tile)}
                className={`btn btn-primary btn-sm justify-center !px-1 ${phone ? "min-h-11" : ""}`}
                data-testid="tile-held"
              >
                Held
              </button>
              <button
                type="button"
                onClick={() => handlers.noShow(tile)}
                className={`btn btn-ghost btn-sm justify-center !px-1 ${phone ? "min-h-11" : ""}`}
                data-testid="tile-noshow"
              >
                No-show
              </button>
              <div className="col-span-2">
                <Reschedule tile={tile} today={today} phone={phone} full onSave={(on, time) => handlers.reschedule(tile, on, time)} />
              </div>
            </>
          ) : (
            <>
              <Reschedule tile={tile} today={today} primary phone={phone} full onSave={(on, time) => handlers.reschedule(tile, on, time)} />
              <button
                type="button"
                onClick={() => handlers.held(tile)}
                className={`btn btn-ghost btn-sm justify-center !px-1 ${phone ? "min-h-11" : ""}`}
                data-testid="tile-held"
              >
                It did happen
              </button>
            </>
          )}
        </div>
      )}

      {phone && !decide && (
        <div className="mt-2.5" data-testid="tile-action">
          {tile.action.kind === "reschedule" ? (
            <Reschedule
              tile={tile}
              today={today}
              primary
              phone
              wide
              label={tile.action.label}
              onSave={(on, time) => handlers.reschedule(tile, on, time)}
            />
          ) : tile.action.kind === "move" ? (
            <button
              type="button"
              onClick={() => handlers.move(tile, (tile.action as { column: PipelineColumn }).column)}
              className="btn btn-primary min-h-11 w-full justify-center"
              data-testid="tile-action-button"
            >
              {tile.action.label}
            </button>
          ) : tile.action.kind === "link" ? (
            <Link href={tile.action.href} className="btn btn-primary min-h-11 w-full justify-center" data-testid="tile-action-button">
              {tile.action.label}
            </Link>
          ) : tile.action.kind === "open" ? (
            <button
              type="button"
              onClick={() => handlers.open(tile)}
              className="btn btn-ghost min-h-11 w-full justify-center"
              data-testid="tile-action-button"
            >
              {tile.action.label}
            </button>
          ) : null}
        </div>
      )}

      <FloatingMenu anchor={more} open={menu} onClose={() => setMenu(false)} width={230} testId="tile-menu" label={`More for ${name}`}>
        <div data-testid={`tile-menu-${tile.id}`}>
        <div className="py-1" role="menu">
          <p className="px-3 pb-1 pt-1.5 text-xs font-semibold text-[var(--text-dim)]">Move to…</p>
          <ul aria-label="Move to" className="pb-1" data-testid="tile-move-menu">
            {PIPELINE_COLUMNS.map((target) => {
              const blocked = isDeal(tile) && isMeetingColumn(target);
              return (
                <li key={target}>
                  <button
                    type="button"
                    role="menuitem"
                    aria-current={target === column ? "true" : undefined}
                    disabled={blocked || target === column}
                    title={blocked ? "A deal can't go back to a meeting" : undefined}
                    onClick={() => {
                      setMenu(false);
                      handlers.move(tile, target);
                    }}
                    className={`flex min-h-9 [@media(pointer:coarse)]:min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:text-[var(--text-dim)] [@media(pointer:coarse)]:min-h-11 ${
                      target === column ? "font-semibold" : ""
                    }`}
                    data-testid={`tile-move-${target}`}
                  >
                    {PIPELINE_COLUMN_LABELS[target]}
                    {target === column && <span className="ml-auto text-xs text-[var(--text-dim)]">here</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[var(--hairline-3)] pt-1">
            <MenuItem
              testId="tile-menu-label"
              onClick={() => {
                setMenu(false);
                setLabelMenu(true);
              }}
            >
              Lead label…
            </MenuItem>
            {ai && (
              <MenuItem
                testId="follow-up-draft"
                onClick={() => {
                  setMenu(false);
                  handlers.followUp(tile);
                }}
              >
                Draft follow-up
              </MenuItem>
            )}
            {tile.deal && (
              <Link
                href={`/dashboard/deals/tracker?dealId=${tile.deal.id}`}
                role="menuitem"
                className="flex min-h-9 [@media(pointer:coarse)]:min-h-11 w-full items-center px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)] [@media(pointer:coarse)]:min-h-11"
                data-testid="tile-menu-coordinator"
              >
                Contract Coordinator
              </Link>
            )}
            <MenuItem
              testId="tile-menu-open"
              onClick={() => {
                setMenu(false);
                handlers.open(tile);
              }}
            >
              Open
            </MenuItem>
          </div>
        </div>
        </div>
      </FloatingMenu>
      <LeadLabelMenu
        anchor={label ? labelButton : more}
        open={labelMenu}
        onClose={() => setLabelMenu(false)}
        value={label}
        customLabels={customLabels}
        onChange={(next) => {
          setLabelMenu(false);
          handlers.label(tile, next);
        }}
      />
    </article>
  );
}

function MenuItem({ children, onClick, testId }: { children: React.ReactNode; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex min-h-9 [@media(pointer:coarse)]:min-h-11 w-full items-center px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)] [@media(pointer:coarse)]:min-h-11"
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/* ------------------------------- Reschedule ------------------------------- */

// Day chips (Tomorrow · the working day after · Next week · Pick) and time
// chips or No time; a meeting still ahead moves, a missed one is a no-show
// and a new one is booked (rescheduleMeeting).
function Reschedule({
  tile,
  today,
  primary = false,
  phone,
  wide = false,
  full = false,
  label = "Reschedule",
  onSave,
}: {
  tile: BoardTile;
  today: string;
  primary?: boolean;
  phone: boolean;
  wide?: boolean;
  // Fills its grid cell.
  full?: boolean;
  label?: string;
  onSave: (on: string, time: string | null) => Promise<string | null>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // The same day and time chips as the sheets (@/components/how-did-it-go/dates),
  // starting at the meeting's own time.
  const chips = dayChips(today);
  const [on, setOn] = useState(chips[0].on);
  const [time, setTime] = useState<string | null>(tile.focus?.meeting.time ?? "10:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chip = (active: boolean) =>
    `min-h-9 [@media(pointer:coarse)]:min-h-11 rounded-lg border px-2.5 text-xs font-medium [@media(pointer:coarse)]:min-h-11 ${
      active ? "border-[var(--brand)] bg-[var(--hover)] text-[var(--text)]" : "border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)]"
    }`;
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        className={`btn ${primary ? "btn-primary" : "btn-ghost"} ${wide ? "min-h-11 w-full" : "btn-sm !px-1"} ${full ? "w-full" : ""} justify-center ${phone ? "min-h-11" : ""}`}
        data-testid="tile-reschedule"
      >
        {label}
      </button>
      <FloatingMenu anchor={button} open={open} onClose={() => setOpen(false)} width={300} testId="reschedule-menu" label="Reschedule">
        <div className="space-y-2.5 p-3">
          <p className="text-sm font-semibold">New day</p>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((row) => (
              <button key={row.key} type="button" onClick={() => setOn(row.on)} className={chip(on === row.on)} title={row.sub} data-testid="reschedule-day" data-on={row.on}>
                {row.label}
              </button>
            ))}
            <input
              type="date"
              value={on}
              min={today}
              onChange={(event) => event.target.value && setOn(event.target.value)}
              aria-label="Pick a day"
              className="input input-sm w-auto"
              data-testid="reschedule-pick"
            />
          </div>
          <p className="text-sm font-semibold">Time</p>
          <div className="flex flex-wrap gap-1.5">
            {TIME_CHIPS.map((row) => (
              <button key={row.value} type="button" onClick={() => setTime(row.value)} className={chip(time === row.value)} data-testid="reschedule-time">
                {row.label}
              </button>
            ))}
            <button type="button" onClick={() => setTime(null)} className={chip(time === null)} data-testid="reschedule-time-none">
              No time
            </button>
          </div>
          {error && (
            <p className="text-xs text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const problem = await onSave(on, time);
                if (problem) setError(problem);
                else setOpen(false);
              })
            }
            className="btn btn-primary btn-sm min-h-9 [@media(pointer:coarse)]:min-h-11 w-full justify-center"
            data-testid="reschedule-save"
          >
            {pending ? "Saving…" : `Move to ${formatDay(`${on}T12:00:00Z`)}`}
          </button>
        </div>
      </FloatingMenu>
    </>
  );
}

/* --------------------------------- Dialogs -------------------------------- */

// "This meeting is Tue Nov 17. Did it happen early?"
function EarlyDialog({ day, onYes, onNo }: { day: string; onYes: () => void; onNo: () => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => yes.current?.focus());
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onNo();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onNo]);
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
  return createPortal(
    <div
      className="modal-backdrop"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onNo();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="early-title"
        className="card card-lit popover w-full max-w-sm p-5"
        data-testid="early-dialog"
      >
        <h2 id="early-title" className="text-base font-semibold">
          This meeting is {when}. Did it happen early?
        </h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">Yes marks it held today and moves it to Meeting Completed.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onNo} className="btn btn-ghost btn-sm min-h-9 [@media(pointer:coarse)]:min-h-11" data-testid="early-no">
            No, it&apos;s still ahead
          </button>
          <button ref={yes} type="button" onClick={onYes} className="btn btn-primary btn-sm min-h-9 [@media(pointer:coarse)]:min-h-11" data-testid="early-yes">
            Yes, it happened
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// A second sideways scrollbar above the board, kept in step with the one
// under it, so the far columns are reachable without going to the bottom.
function TopScroll({ children }: { children: React.ReactNode }) {
  const top = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    // The content's own width: the top bar adds the same side padding.
    const measure = () => {
      const style = getComputedStyle(element);
      setWidth(element.scrollWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(element);
    if (element.firstElementChild) watcher.observe(element.firstElementChild);
    return () => watcher.disconnect();
  }, []);
  return (
    <div className="-mx-5 sm:-mx-8">
      <div
        ref={top}
        className="overflow-x-auto px-5 sm:px-8"
        onScroll={() => {
          if (body.current && top.current && body.current.scrollLeft !== top.current.scrollLeft) body.current.scrollLeft = top.current.scrollLeft;
        }}
        data-testid="pipeline-top-scroll"
        aria-hidden="true"
      >
        <div style={{ width: Math.max(0, width), height: 1 }} />
      </div>
      <div
        ref={body}
        className="overflow-x-auto px-5 pb-2 pt-2 sm:px-8"
        onScroll={() => {
          if (body.current && top.current && top.current.scrollLeft !== body.current.scrollLeft) top.current.scrollLeft = body.current.scrollLeft;
        }}
        data-testid="pipeline-scroll"
      >
        {children}
      </div>
    </div>
  );
}
