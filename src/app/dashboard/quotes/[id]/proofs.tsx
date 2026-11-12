"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { IconCheck, IconCopy, IconDownload, IconPlus, IconSend } from "@/components/icons";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { dialNumber } from "@/lib/dial";
import { formatDate } from "@/lib/format";
import { PROOF_STATUS_TEXT, type ProofStatusValue } from "@/lib/proof-shared";
import type { ProofView, VersionView } from "@/lib/proofs";
import type { ArtworkOwner, ArtworkView } from "@/lib/artwork";
import {
  discardProofDraft,
  markProofApprovedAction,
  prepareProofSend,
  sendProofsAction,
} from "@/app/dashboard/proofs/actions";
import { ProofSheet } from "./proof-sheet";

// The apparel pack (Nov 12, 2026): proofs on a quote. Each product line
// shows its proof under its labels (or "+ Proof"); the Proofs card lists
// them with their versions and answers; Send proofs shares one link for the
// customer to approve them on, and never touches the quote's own status.

export type ProofLine = {
  id: string;
  productId: string;
  colorOptionId: string | null;
  label: string;
  proofId: string | null;
};

export type ProofProduct = {
  name: string;
  pictures: { id: string; token: string; colorOptionId: string | null }[];
};

export type ProofPageData = {
  quoteId: string;
  quoteNumber: number;
  quoteLabel: string;
  contact: { name: string; email: string | null; phone: string | null };
  storageOn: boolean;
  timeZone: string;
  colorGroupId: string | null;
  proofs: ProofView[];
  lines: ProofLine[];
  products: Record<string, ProofProduct>;
  colors: Record<string, string>;
  locations: { id: string; name: string; archived: boolean }[];
  artworks: ArtworkView[];
  artworkOwner: ArtworkOwner;
};

type Opened = { kind: "line"; lineId: string } | { kind: "proof"; proofId: string } | null;

const ProofsContext = createContext<{ data: ProofPageData; open: (opened: Opened) => void } | null>(null);

export function statusColor(status: ProofStatusValue) {
  if (status === "APPROVED") return "var(--ok)";
  if (status === "CHANGES") return "var(--danger)";
  if (status === "SENT") return "var(--warn)";
  return "var(--text-dim)";
}

export function ProofStatus({ status }: { status: ProofStatusValue }) {
  return <Badge color={statusColor(status)}>{PROOF_STATUS_TEXT[status]}</Badge>;
}

export function ProofsProvider({ data, children }: { data: ProofPageData; children: React.ReactNode }) {
  const [opened, setOpened] = useState<Opened>(null);
  return (
    <ProofsContext.Provider value={{ data, open: setOpened }}>
      {children}
      {opened && <ProofSheet data={data} opened={opened} onClose={() => setOpened(null)} />}
    </ProofsContext.Provider>
  );
}

// Under a product line's labels in the editor. Needs the line saved: a
// proof is made for the line as the customer's copy shows it.
export function LineProofChip({
  lineId,
  productId,
  picks,
  unsaved,
}: {
  lineId: string | null;
  productId: string | null;
  // The row's label picks as the editor holds them (group id → option id).
  picks: Record<string, string>;
  unsaved: boolean;
}) {
  const context = useContext(ProofsContext);
  if (!context || !productId) return null;
  const { data, open } = context;
  const colorOptionId = data.colorGroupId ? (picks[data.colorGroupId] ?? null) || null : null;
  const saved = lineId ? data.lines.find((line) => line.id === lineId) : undefined;
  const proof = saved ? data.proofs.find((item) => item.lineIds.includes(saved.id)) : undefined;
  const changed = !saved || saved.productId !== productId || saved.colorOptionId !== colorOptionId;
  if (proof && !changed) {
    const newest = proof.versions[0];
    return (
      <button
        type="button"
        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--hairline-2)] px-1.5 py-1 text-[0.68rem] hover:bg-[var(--hover)]"
        onClick={() => open({ kind: "proof", proofId: proof.id })}
        data-testid="line-proof"
        data-proof={proof.number}
      >
        {newest && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/files/${newest.token}?v=thumb`} alt="" className="h-6 w-6 rounded bg-white object-contain" />
        )}
        <span className="font-medium">Proof {proof.number}</span>
        {newest && <ProofStatus status={newest.status} />}
      </button>
    );
  }
  if (unsaved || changed) {
    return (
      <p className="faint mt-1.5 text-[0.68rem]" data-testid="line-proof-save-first">
        Save to add a proof
      </p>
    );
  }
  return (
    <button
      type="button"
      className="link mt-1.5 inline-flex items-center gap-1 text-[0.68rem]"
      onClick={() => open({ kind: "line", lineId: saved!.id })}
      data-testid="line-proof-add"
    >
      <IconPlus size={11} />
      Proof
    </button>
  );
}

// The workspace's own calendar day, the same on the server and in the
// browser (a browser's own zone or language made the page disagree with
// itself; audit, Nov 12).
function when(iso: string | null, timeZone: string) {
  return iso ? formatDate(iso, timeZone) : "";
}

function versionWords(version: VersionView, timeZone: string) {
  if (version.status === "APPROVED") {
    return `Approved by ${version.approvedByName ?? "them"}${version.approvedOffline ? " (marked by the team)" : ""} · ${when(version.approvedAt, timeZone)}`;
  }
  if (version.status === "CHANGES") return `${version.changesByName ?? "They"} asked for changes: ${version.changesNote ?? ""}`;
  if (version.status === "SENT") return `Sent ${when(version.sentAt, timeZone)} · waiting for their answer`;
  if (version.status === "SUPERSEDED") return "Replaced by a newer version";
  return version.copiedFrom ? `Draft · ${version.copiedFrom}` : "Draft · not sent yet";
}

function MarkApproved({ versionId }: { versionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="link text-xs" onClick={() => setOpen(true)} data-testid="proof-mark-approved">
        Mark approved
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        className="input input-sm !w-44"
        value={name}
        maxLength={80}
        placeholder="Who approved it?"
        onChange={(event) => setName(event.target.value)}
        aria-label="Who approved it"
        data-testid="proof-mark-approved-name"
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await markProofApprovedAction(versionId, name);
            if ("error" in result && result.error) {
              setError(result.error);
              return;
            }
            setOpen(false);
            router.refresh();
          })
        }
        data-testid="proof-mark-approved-save"
      >
        Save
      </button>
      <button type="button" className="link text-xs" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </span>
  );
}

export function ProofsCard() {
  const context = useContext(ProofsContext);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  if (!context) return null;
  const { data, open } = context;
  const lineLabel = new Map(data.lines.map((line) => [line.id, line.label]));

  return (
    <div className="card card-lit" data-testid="proofs-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline-3)] px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold">Proofs</h2>
          <p className="faint mt-0.5 text-xs">Their logo on each garment, for them to approve before you print.</p>
        </div>
        <SendProofsButton />
      </div>
      {data.proofs.length === 0 ? (
        <p className="faint px-5 py-4 text-sm">
          No proofs yet. Use <span className="font-medium">+ Proof</span> under a product line to make one.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--hairline-3)]">
          {data.proofs.map((proof) => {
            const newest = proof.versions[0];
            const shown = proof.versions.find((version) => version.status !== "DRAFT" && version.status !== "SUPERSEDED");
            return (
              <li key={proof.id} className="flex gap-3 px-5 py-4" data-testid="proof-row" data-proof={proof.number}>
                {newest && (
                  <button type="button" onClick={() => open({ kind: "proof", proofId: proof.id })} className="shrink-0" aria-label={`Open proof ${proof.number}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/files/${newest.token}?v=thumb`} alt="" className="h-20 w-28 rounded-md border border-[var(--hairline-2)] bg-white object-contain" />
                  </button>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">
                      Proof {proof.number} · {proof.productName}
                      {proof.colorLabel ? ` · ${proof.colorLabel}` : ""}
                    </span>
                    {newest && <ProofStatus status={newest.status} />}
                    {newest && newest.version > 1 && <span className="faint text-xs">v{newest.version}</span>}
                  </p>
                  {newest && <p className="faint text-xs" data-testid="proof-words">{versionWords(newest, data.timeZone)}</p>}
                  {shown && newest && shown.id !== newest.id && (
                    <p className="faint text-xs">They still see v{shown.version}: {PROOF_STATUS_TEXT[shown.status].toLowerCase()}.</p>
                  )}
                  <p className="text-xs">
                    {proof.lineIds.length ? (
                      <span className="muted">For {proof.lineIds.map((id) => lineLabel.get(id) ?? "a line").join(", ")}</span>
                    ) : (
                      <span className="text-[var(--warn)]" data-testid="proof-no-lines">Not on any line of this quote. It won&apos;t be sent.</span>
                    )}
                  </p>
                  {newest && (
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {newest.panels.map((panel) =>
                        panel.artworkId && panel.hasPrintFile ? (
                          <a key={panel.position} href={`/dashboard/artwork/${panel.artworkId}/print`} className="link inline-flex items-center gap-1" download>
                            <IconDownload size={11} />
                            {panel.locationLabel}: {panel.artworkName}
                          </a>
                        ) : (
                          <span key={panel.position} className="faint">
                            {panel.locationLabel}: {panel.artworkName}
                          </span>
                        ),
                      )}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                    <button type="button" className="link" onClick={() => open({ kind: "proof", proofId: proof.id })} data-testid="proof-open">
                      {newest?.status === "DRAFT" ? "Edit" : "Make changes"}
                    </button>
                    {newest && newest.status !== "APPROVED" && newest.status !== "SUPERSEDED" && proof.lineIds.length > 0 && (
                      <MarkApproved versionId={newest.id} />
                    )}
                    {newest?.status === "DRAFT" && (
                      <button
                        type="button"
                        className="link text-[var(--danger)]"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const result = await discardProofDraft(newest.id);
                            if ("error" in result && result.error) setError(result.error);
                            else router.refresh();
                          })
                        }
                        data-testid="proof-discard"
                      >
                        {proof.versions.length > 1 ? "Throw this draft away" : "Delete proof"}
                      </button>
                    )}
                    {proof.versions.length > 1 && (
                      <button type="button" className="link" onClick={() => setHistory(history === proof.id ? null : proof.id)}>
                        {history === proof.id ? "Hide versions" : `${proof.versions.length} versions`}
                      </button>
                    )}
                  </div>
                  {history === proof.id && (
                    <ul className="mt-2 space-y-1 text-xs" data-testid="proof-history">
                      {proof.versions.map((version) => (
                        <li key={version.id} className="flex items-center gap-2">
                          <a href={`/files/${version.token}`} target="_blank" rel="noopener noreferrer" className="link">
                            v{version.version}
                          </a>
                          <span className="faint">{versionWords(version, data.timeZone)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="px-5 pb-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type Prepared = Awaited<ReturnType<typeof prepareProofSend>>;
type Way = "copy" | "text" | "email" | "mark";

// "Send proofs": one link for every proof on the quote. Whichever way is
// used marks the drafts sent; the quote itself is never marked sent here.
export function SendProofsButton() {
  const context = useContext(ProofsContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState("");
  if (typeof window !== "undefined" && origin === "") setOrigin(window.location.origin);
  if (!context) return null;
  const { data } = context;
  const drafts = data.proofs.filter((proof) => proof.versions[0]?.status === "DRAFT" && proof.lineIds.length > 0).length;
  const sentAny = data.proofs.some((proof) => proof.versions.some((version) => version.status !== "DRAFT"));
  if (!drafts && !sentAny) return null;

  const ready = prepared && !("error" in prepared) ? prepared : null;
  const url = ready?.token ? `${origin}/pf/${ready.token}` : "";
  const firstName = data.contact.name.split(/\s+/)[0] || data.contact.name;
  const message = `Hi ${firstName}, here are the proofs for ${data.quoteLabel} to approve: ${url}`;
  const smsHref = `sms:${data.contact.phone ? dialNumber(data.contact.phone).main : ""}?&body=${encodeURIComponent(message)}`;
  const mailHref = `mailto:${data.contact.email ?? ""}?subject=${encodeURIComponent(`Proofs to approve: ${data.quoteLabel}`)}&body=${encodeURIComponent(`${message}\n`)}`;

  function openSheet() {
    setOpen(true);
    setPrepared(null);
    setError(null);
    setCopied(false);
    start(async () => {
      const result = await prepareProofSend(data.quoteId);
      setPrepared(result);
    });
  }

  function send(way: Way) {
    setError(null);
    start(async () => {
      if (way === "copy" && url) {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        } catch {
          // The link is on screen.
        }
      }
      const result = await sendProofsAction(data.quoteId);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      if (way === "text") window.location.href = smsHref;
      if (way === "email") window.location.href = mailHref;
      router.refresh();
      if (way !== "copy") setOpen(false);
    });
  }

  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={openSheet} data-testid="send-proofs">
        <IconSend size={13} />
        {drafts ? `Send proofs (${drafts})` : "Share proofs link"}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Send proofs"
        title={data.quoteLabel}
        testId="send-proofs-sheet"
        footer={
          <button type="button" className="btn btn-ghost w-full sm:w-auto" disabled={pending || !ready} onClick={() => send("mark")} data-testid="send-proofs-mark">
            {drafts ? "Just mark them sent" : "Close"}
          </button>
        }
      >
        <div className="space-y-4">
          {!prepared && <p className="faint text-sm" role="status">Getting the proofs ready…</p>}
          {prepared && "error" in prepared && <p className="text-sm text-[var(--danger)]">{prepared.error}</p>}
          {ready && (
            <>
              <p className="muted text-sm">
                {ready.drafts.length
                  ? `${ready.drafts.length === 1 ? "This proof goes" : `These ${ready.drafts.length} proofs go`} to ${data.contact.name} to approve. The quote itself isn't sent.`
                  : `Nothing new to send. Share the link to ${data.contact.name} again.`}
              </p>
              {ready.drafts.length > 0 && (
                <ul className="space-y-1 text-sm" data-testid="send-proofs-list">
                  {ready.drafts.map((proof) => (
                    <li key={proof.number}>
                      Proof {proof.number} · {proof.productName}
                      {proof.colorLabel ? ` · ${proof.colorLabel}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {ready.noLines.length > 0 && (
                <p className="text-xs text-[var(--warn)]">
                  Proof {ready.noLines.join(", ")} isn&apos;t on any line, so it stays here.
                </p>
              )}
              {ready.warnings.map((warning) => (
                <p key={warning.name} className="rounded-lg border border-[var(--warn)] px-3 py-2 text-xs" data-testid="send-proofs-warning">
                  <span className="font-medium">{warning.name}:</span> {warning.note}
                </p>
              ))}
              <input
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="input input-sm num w-full text-xs"
                aria-label="Approval link"
                data-testid="send-proofs-link"
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <button type="button" className="btn btn-primary min-h-11 w-full" disabled={pending} onClick={() => send("copy")} data-testid="send-proofs-copy">
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button type="button" className="btn btn-ghost min-h-11 w-full" disabled={pending} onClick={() => send("text")} data-testid="send-proofs-text">
                  Text
                </button>
                <button type="button" className="btn btn-ghost min-h-11 w-full" disabled={pending} onClick={() => send("email")} data-testid="send-proofs-email">
                  Email
                </button>
              </div>
              <p className="faint text-xs">Text and Email open your own messages and mail with the link written in. Nothing is emailed from here.</p>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]" data-testid="send-proofs-error">
              {error}
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}
