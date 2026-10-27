"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PIPELINE_COLUMNS,
  PIPELINE_COLUMN_COLORS,
  PIPELINE_COLUMN_LABELS,
  type PipelineColumn,
} from "@/lib/constants";
import { formatCents, formatDate } from "@/lib/format";
import { LeadLabelPicker } from "@/components/lead-label-chip";
import { IconCalendar, IconClock, IconFileText, IconUsers } from "@/components/icons";
import { moveOpportunity, setOpportunityLabel } from "./opportunity-actions";
import { OwnerSelect } from "./owner-select";
import { ConvertDialog } from "./convert-dialog";
import { MoveMenu, isMeetingColumn } from "./move-menu";
import { OpportunityPanel } from "./opportunity-panel";

export type BoardTile = {
  id: string;
  title: string;
  // Where it sits: a column, or Archived (shown under Contract Sent when
  // archived deals are showing).
  column: PipelineColumn | "ARCHIVED";
  leadLabel: string | null;
  // Listed people, Primary first.
  people: { id: string; name: string; company: string | null; primary: boolean }[];
  ownerId: string | null;
  ownerName: string | null;
  meetingCount: number;
  lastMeetingOn: string | null;
  deal: { id: string; stage: string; valueCents: number; quotes: { id: string; number: number; title: string }[] } | null;
};

const DEAL_COLUMNS: readonly string[] = ["QUOTE_SENT", "CONTRACT_SENT", "WON", "LOST"];
// A deal past a draft quote can't go back to a meeting column.
const isDeal = (tile: BoardTile) => Boolean(tile.deal && (DEAL_COLUMNS.includes(tile.deal.stage) || tile.deal.stage === "ARCHIVED"));
const shownIn = (tile: BoardTile): PipelineColumn => (tile.column === "ARCHIVED" ? "CONTRACT_SENT" : tile.column);

// The Pipeline (rebuilt Oct 27, 2026): one tile per opportunity. Drag a
// tile to another column, or use the stage menu on it. Meeting Set and
// Meeting Completed move freely; into Quote Sent or further with no deal
// asks "convert this to a deal?"; a deal never goes back to a meeting.
// Click a tile to work it in the panel.
export function PipelineBoard({
  tiles,
  users,
  customLabels,
  timeZone,
  today,
}: {
  tiles: BoardTile[];
  users: { id: string; name: string }[];
  customLabels: string[];
  timeZone: string;
  today: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Columns moved to and labels picked in this tab, until fresh tiles
  // come back from the server and replace them.
  const [local, setLocal] = useState<{ base: BoardTile[]; moved: Record<string, PipelineColumn>; labels: Record<string, string | null> }>({
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
  const [notice, setNotice] = useState<string | null>(null);
  const [converting, setConverting] = useState<{ tile: BoardTile; stage: PipelineColumn } | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const columnOf = (tile: BoardTile) => moved[tile.id] ?? shownIn(tile);

  function move(tile: BoardTile, column: PipelineColumn) {
    if (columnOf(tile) === column) return;
    if (isDeal(tile) && isMeetingColumn(column)) {
      setNotice("A deal can't go back to a meeting column. Move it to Lost, or start a new opportunity.");
      return;
    }
    if (!tile.deal && !isMeetingColumn(column)) {
      setConverting({ tile, stage: column });
      return;
    }
    setMoved((current) => ({ ...current, [tile.id]: column }));
    startTransition(async () => {
      const result = await moveOpportunity(tile.id, column);
      if (result.convert) {
        setMoved((map) => without(map, tile.id));
        setConverting({ tile, stage: column });
        return;
      }
      if (result.error) {
        setMoved((map) => without(map, tile.id));
        setNotice(result.error);
        return;
      }
      router.refresh();
    });
  }

  function label(tile: BoardTile, next: string | null) {
    setLabels((current) => ({ ...current, [tile.id]: next }));
    startTransition(async () => {
      const result = await setOpportunityLabel(tile.id, next);
      if (result.error) {
        setLabels((map) => without(map, tile.id));
        setNotice(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <TopScroll>
        <div className="grid min-w-[1320px] grid-cols-6 gap-3">
          {PIPELINE_COLUMNS.map((column) => {
            const inColumn = tiles.filter((tile) => columnOf(tile) === column);
            const accent = PIPELINE_COLUMN_COLORS[column];
            const value = inColumn.reduce((sum, tile) => sum + (tile.deal?.valueCents ?? 0), 0);
            const meeting = isMeetingColumn(column);
            const dropOk = dragging ? canDrop(tiles.find((tile) => tile.id === dragging), column) : false;
            return (
              <div
                key={column}
                className={`card card-lit flex flex-col transition-shadow ${over === column && dropOk ? "ring-2 ring-[var(--brand)]" : ""}`}
                data-testid={`pipeline-column-${column}`}
                onDragOver={(event) => {
                  if (!dropOk) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setOver(column);
                }}
                onDragLeave={() => setOver((current) => (current === column ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  const tile = tiles.find((row) => row.id === event.dataTransfer.getData("text/plain"));
                  setOver(null);
                  setDragging(null);
                  if (tile) move(tile, column);
                }}
              >
                <div className="border-b border-[var(--border)] px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent, boxShadow: `0 0 10px ${accent}` }} />
                    <h2 className="whitespace-nowrap text-sm font-semibold">{PIPELINE_COLUMN_LABELS[column]}</h2>
                    <span className="faint num text-xs" data-testid="pipeline-column-count">{inColumn.length}</span>
                  </div>
                  <p className="num faint mt-1 pl-4 text-xs">
                    {meeting ? (inColumn.length === 1 ? "1 opportunity" : `${inColumn.length} opportunities`) : formatCents(value)}
                  </p>
                </div>
                <div className="min-h-24 flex-1 space-y-2 p-2.5">
                  {inColumn.length === 0 && (
                    <p className="faint py-4 text-center text-xs">{meeting ? "Nobody here" : "No deals"}</p>
                  )}
                  {inColumn.map((tile) => (
                    <Tile
                      key={tile.id}
                      tile={tile}
                      column={column}
                      label={tile.id in labels ? labels[tile.id] : tile.leadLabel}
                      users={users}
                      customLabels={customLabels}
                      timeZone={timeZone}
                      onOpen={() => setPanelId(tile.id)}
                      onMove={(next) => move(tile, next)}
                      onLabel={(next) => label(tile, next)}
                      onDragStart={() => setDragging(tile.id)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </TopScroll>

      {notice && (
        <div
          role="status"
          className="card popover fixed bottom-5 left-1/2 z-[90] max-w-md -translate-x-1/2 px-4 py-2.5 text-sm"
          data-testid="pipeline-notice"
        >
          {notice}
        </div>
      )}

      {converting && (
        <ConvertDialog
          tile={converting.tile}
          stage={converting.stage}
          today={today}
          onClose={() => setConverting(null)}
          onDone={(quoteUrl) => {
            setConverting(null);
            if (quoteUrl) router.push(quoteUrl);
            else router.refresh();
          }}
        />
      )}

      {panelId && (
        <OpportunityPanel
          id={panelId}
          timeZone={timeZone}
          onClose={() => setPanelId(null)}
          onMove={(column) => {
            const tile = tiles.find((row) => row.id === panelId);
            if (tile) move(tile, column);
          }}
        />
      )}
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

function Tile({
  tile,
  column,
  label,
  users,
  customLabels,
  timeZone,
  onOpen,
  onMove,
  onLabel,
  onDragStart,
  onDragEnd,
}: {
  tile: BoardTile;
  column: PipelineColumn;
  label: string | null;
  users: { id: string; name: string }[];
  customLabels: string[];
  timeZone: string;
  onOpen: () => void;
  onMove: (column: PipelineColumn) => void;
  onLabel: (label: string | null) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const shown = tile.people.slice(0, 4);
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", tile.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={(event) => {
        // Links, menus and pickers on the tile do their own thing.
        if ((event.target as HTMLElement).closest("a,button,select,input,label")) return;
        onOpen();
      }}
      className="cursor-grab rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3 hover:border-[var(--border-strong)] active:cursor-grabbing"
      data-testid="pipeline-tile"
      data-id={tile.id}
      data-title={tile.title}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 text-left text-sm font-medium hover:underline" data-testid="tile-open">
          {tile.title}
        </button>
        <LeadLabelPicker value={label} customLabels={customLabels} onChange={onLabel} />
      </div>

      <ul className="mt-1.5 space-y-0.5" data-testid="tile-people">
        {shown.map((person) => (
          <li key={person.id} className="flex min-w-0 items-center gap-1 text-xs">
            <IconUsers size={11} className="faint shrink-0" />
            <Link href={`/dashboard/contacts/${person.id}`} className="truncate hover:underline">
              {person.name}
            </Link>
            {person.primary && tile.people.length > 1 && <span className="faint shrink-0 text-[0.6rem]">Primary</span>}
          </li>
        ))}
        {tile.people.length > shown.length && <li className="faint text-[0.7rem]">and {tile.people.length - shown.length} more</li>}
        {tile.people.length === 0 && <li className="faint text-[0.7rem]">Nobody listed</li>}
      </ul>

      {tile.deal ? (
        <div className="mb-1 mt-1.5 flex">
          <OwnerSelect dealId={tile.deal.id} ownerId={tile.ownerId} users={users} />
        </div>
      ) : (
        <p className="mt-1.5 flex items-center gap-1 text-[0.7rem]">
          <span className="faint">Rep:</span>
          <span className="font-medium" data-testid="tile-rep">{tile.ownerName ?? "Unassigned"}</span>
        </p>
      )}
      {tile.lastMeetingOn && (
        <p className="faint mt-0.5 flex items-center gap-1 text-[0.7rem]">
          <IconCalendar size={11} />
          {tile.meetingCount > 1 ? `${tile.meetingCount} meetings · last ` : "Meeting "}
          {formatDate(tile.lastMeetingOn, timeZone)}
        </p>
      )}

      {tile.deal && tile.deal.quotes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {tile.deal.quotes.map((quote) => (
            <li key={quote.id}>
              <Link href={`/dashboard/quotes/${quote.id}`} className="faint flex max-w-full items-center gap-1 text-[0.7rem] hover:text-[var(--text)]">
                <IconFileText size={11} className="shrink-0" />
                <span className="num shrink-0 whitespace-nowrap">QUO-{quote.number}</span>
                <span className="truncate">{quote.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}


      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        {tile.deal ? <span className="num text-xs font-medium">{formatCents(tile.deal.valueCents)}</span> : <span />}
        <MoveMenu current={column} archived={tile.column === "ARCHIVED"} locked={isDeal(tile)} onMove={onMove} />
      </div>
      {tile.deal && (
        <Link href={`/dashboard/deals/tracker?dealId=${tile.deal.id}`} className="faint mt-2 flex items-center gap-1 text-[0.7rem] hover:text-[var(--text)]">
          <IconClock size={11} />
          Contract Coordinator
        </Link>
      )}
    </div>
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
