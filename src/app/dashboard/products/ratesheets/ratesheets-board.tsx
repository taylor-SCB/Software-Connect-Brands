"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardHeader, EmptyState, StatusBadge, Badge } from "@/components/ui";
import { IconLayers, IconPower, IconDownload, IconFilter, IconUpload, IconPlus } from "@/components/icons";
import { DeleteButton } from "@/components/delete-button";
import { CopyLink } from "@/components/copy-link";
import { RATESHEET_VISIBILITY_LABELS, type RatesheetVisibilityValue } from "@/lib/constants";
import type { InviteState, RatesheetState } from "@/lib/ratesheets";
import { toggleRatesheetActive, deleteRatesheet, deleteLinkedRatesheet } from "./actions";

export type BoardSheet = {
  id: string;
  name: string;
  visibility: string;
  active: boolean;
  state: RatesheetState;
  createdAt: string;
  expiresOn: string | null;
  itemCount: number;
  approved: number;
  sent: number;
};

export type BoardInvite = {
  id: string;
  ratesheetId: string;
  ratesheetName: string;
  partnerLabel: string;
  partnerEmail: string;
  state: InviteState;
  sentAt: string;
  respondBy: string | null;
  path: string;
};

export type BoardFile = {
  id: string;
  name: string;
  fileName: string;
  size: string;
  uploadedAt: string;
  highlighted: boolean;
};

const VISIBILITY_COLORS: Record<string, string> = {
  PUBLIC: "#38bdf8",
  INVITE_APPROVE: "#fbbf24",
  PARTNER_SPECIFIC: "#a78bfa",
};

// Two columns: Summary (every partner send, with its status) on the left,
// the ratesheet tiles on the right. Clicking a tile filters the summary
// to that sheet's sends; clicking it again clears the filter. On a phone
// the tiles come first so the filtered list lands right under the tap.
export function RatesheetsBoard({
  organizationName,
  sheets,
  invites,
  files,
}: {
  organizationName: string;
  sheets: BoardSheet[];
  invites: BoardInvite[];
  files: BoardFile[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sheets.find((sheet) => sheet.id === selectedId) ?? null;
  const visibleInvites = selected
    ? invites.filter((invite) => invite.ratesheetId === selected.id)
    : invites;

  // The four boxes describe whatever the list below them is showing, so a
  // selected tile narrows the numbers as well as the rows.
  const counts = { pending: 0, approved: 0, declined: 0, sent: visibleInvites.length };
  for (const invite of visibleInvites) {
    if (invite.state === "PENDING") counts.pending += 1;
    else if (invite.state === "APPROVED") counts.approved += 1;
    else if (invite.state === "DECLINED") counts.declined += 1;
  }

  function toggle(id: string) {
    setSelectedId((current) => (current === id ? null : id));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* ---------- Left column ---------- */}
      <div className="order-2 space-y-5 lg:order-1 lg:col-span-2">
        <Card lit id="summary">
          <CardHeader
            title="Summary"
            subtitle={organizationName}
            actions={
              selected ? (
                <button type="button" onClick={() => setSelectedId(null)} className="btn btn-ghost btn-sm">
                  Clear filter
                </button>
              ) : undefined
            }
          />

          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
            <Stat label="Pending approvals" value={counts.pending} color="#fbbf24" />
            <Stat label="Approved" value={counts.approved} color="#34d399" />
            <Stat label="Declines" value={counts.declined} color="#fb7185" />
            <Stat label="Ratesheets sent" value={counts.sent} color="#38bdf8" />
          </div>

          {selected && (
            <p className="muted border-t border-[var(--border)] px-5 py-2 text-xs">
              Showing sends for <span className="font-medium text-[var(--text)]">{selected.name}</span>
            </p>
          )}

          {visibleInvites.length === 0 ? (
            <div className="border-t border-[var(--border)]">
              <EmptyState
                title={selected ? "Nothing sent from this ratesheet yet" : "No ratesheets sent yet"}
                body="Send a ratesheet to a partner from its page and the status shows up here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[rgb(255_255_255/0.045)] border-t border-[var(--border)]">
              {visibleInvites.map((invite) => (
                <li key={invite.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{invite.partnerLabel}</p>
                      {invite.partnerLabel !== invite.partnerEmail && (
                        <p className="faint truncate text-xs">{invite.partnerEmail}</p>
                      )}
                      <p className="faint mt-0.5 text-xs">
                        <Link href={`/dashboard/products/ratesheets/${invite.ratesheetId}`} className="link">
                          {invite.ratesheetName}
                        </Link>{" "}
                        · sent {invite.sentAt}
                        {invite.respondBy && invite.state === "PENDING" && ` · respond by ${invite.respondBy}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusBadge status={invite.state} />
                      {invite.state === "PENDING" && <CopyLink path={invite.path} label="Copy link" />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card lit id="linked-files">
          <CardHeader
            title="Linked ratesheets"
            subtitle="Files you've uploaded. Download them any time from here."
          />
          {files.length === 0 ? (
            <EmptyState
              icon={<IconUpload size={18} />}
              title="No files linked yet"
              body="Use + Link Ratesheet on the Products page to upload a distributor's price list."
            />
          ) : (
            <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                  style={
                    file.highlighted
                      ? { background: "color-mix(in srgb, var(--brand) 8%, transparent)" }
                      : undefined
                  }
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {file.name}
                      {file.highlighted && (
                        <span className="ml-2 text-xs font-normal text-[var(--ok)]">Saved</span>
                      )}
                    </p>
                    <p className="faint truncate text-xs">
                      {file.fileName} · {file.size} · uploaded {file.uploadedAt}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={`/dashboard/products/ratesheets/files/${file.id}`}
                      className="btn btn-ghost btn-sm"
                      title="Download"
                    >
                      <IconDownload size={12} />
                      Download
                    </a>
                    <DeleteButton
                      action={deleteLinkedRatesheet}
                      hiddenName="linkedRatesheetId"
                      hiddenValue={file.id}
                      label={`Delete ${file.name}`}
                      question={`Delete ${file.name}?`}
                      note="The file is removed. Nothing else changes."
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ---------- Right column: tiles ---------- */}
      <div className="order-1 lg:order-2 lg:col-span-3">
        <Card lit>
          <CardHeader
            title="Ratesheets"
            subtitle="Click a tile to filter the summary to that sheet."
            actions={
              <Link href="/dashboard/products/ratesheets/new" className="btn btn-neon btn-sm">
                <IconPlus size={13} />
                Create Ratesheet
              </Link>
            }
          />
          {sheets.length === 0 ? (
            <EmptyState
              icon={<IconLayers size={20} />}
              title="No ratesheets yet"
              body="Pick products from your catalog, name the sheet, and publish it for partners to approve."
              action={
                <Link href="/dashboard/products/ratesheets/new" className="btn btn-neon btn-sm">
                  <IconPlus size={14} />
                  Create Ratesheet
                </Link>
              }
            />
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {sheets.map((sheet) => {
                const isSelected = sheet.id === selectedId;
                return (
                  <div
                    key={sheet.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => toggle(sheet.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggle(sheet.id);
                      }
                    }}
                    className="card card-hover cursor-pointer p-4 text-left"
                    style={
                      isSelected
                        ? {
                            // Soft 10% tint in the workspace brand colour —
                            // the same colour as the "+ Add product" button.
                            background: "color-mix(in srgb, var(--brand) 10%, transparent)",
                            borderColor: "color-mix(in srgb, var(--brand) 55%, transparent)",
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold">{sheet.name}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge color={VISIBILITY_COLORS[sheet.visibility] ?? "var(--text-dim)"}>
                            {RATESHEET_VISIBILITY_LABELS[sheet.visibility as RatesheetVisibilityValue] ??
                              sheet.visibility}
                          </Badge>
                          <StatusBadge status={sheet.state} />
                        </div>
                      </div>
                      {isSelected && (
                        <span
                          className="badge pulse-soft shrink-0"
                          style={{
                            color: "var(--brand-contrast)",
                            background: "var(--brand)",
                            borderColor: "var(--brand)",
                          }}
                        >
                          <IconFilter size={10} />
                          Filter Applied
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div className="faint space-y-0.5 text-xs">
                        <p>Created {sheet.createdAt}</p>
                        <p>
                          Expires on{" "}
                          <span className={sheet.expiresOn ? "text-[var(--text-dim)]" : ""}>
                            {sheet.expiresOn ?? "—"}
                          </span>
                        </p>
                        <p>
                          {sheet.itemCount} {sheet.itemCount === 1 ? "product" : "products"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="num text-xl font-semibold leading-none">
                          {sheet.approved}/{sheet.sent}
                        </p>
                        <p className="faint mt-1 text-[0.68rem]">approved / sent</p>
                      </div>
                    </div>

                    {/* Buttons stop the click so using them doesn't toggle the filter. */}
                    <div
                      className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Link href={`/dashboard/products/ratesheets/${sheet.id}`} className="btn btn-ghost btn-sm">
                        Edit
                      </Link>
                      <form action={toggleRatesheetActive}>
                        <input type="hidden" name="ratesheetId" value={sheet.id} />
                        <button
                          type="submit"
                          className="btn btn-ghost btn-sm"
                          title={sheet.active ? "Mark inactive" : "Mark active"}
                        >
                          <IconPower size={12} />
                          {sheet.active ? "Inactive" : "Active"}
                        </button>
                      </form>
                      <div className="ml-auto">
                        <DeleteButton
                          action={deleteRatesheet}
                          hiddenName="ratesheetId"
                          hiddenValue={sheet.id}
                          label={`Delete ${sheet.name}`}
                          question={`Delete ${sheet.name}?`}
                          note="Partner links for this sheet stop working."
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        borderColor: `color-mix(in srgb, ${color} 28%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <p className="text-[0.68rem] font-semibold" style={{ color }}>
        {label}
      </p>
      <p className="num mt-0.5 text-lg font-semibold leading-tight">{value}</p>
    </div>
  );
}
