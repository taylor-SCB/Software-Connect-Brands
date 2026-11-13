"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { IconUpload, IconCheck, IconX, IconDownload } from "@/components/icons";
import { applyRedlines, type RedlineChange } from "@/lib/contract-checks";
import { readAgreementFile } from "@/lib/template-file";
import { pictureForAi, readPdf, readTrackedChanges } from "@/lib/redline-file";
import { setContractStatus } from "../actions";
import { addRedlineChunk, contractStatusOf, discardRedlineGroup, readRedline, startRedlineFile, type RedlineResult } from "../ai-actions";
import { useRedlineDraft } from "./redline-draft";

// B3, the redline reader (Release B, Nov 12, 2026): the customer's
// marked-up copy, as Word, PDF or photos of the pages, read against our
// wording into changes with Accept and Reject. Accepted ones go into the
// body as a draft; nothing is saved until Save, and a sent contract is
// pulled back to draft first, after a confirmation.

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS = 12;
const CHUNK = 2.5 * 1024 * 1024;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type RedlineFileGroup = { groupId: string; when: string; files: { id: string; fileName: string }[] };

type Decision = "accept" | "reject";

async function sendFile(contractId: string, blob: Blob, meta: { fileName: string; mimeType: string; position: number; groupId?: string }) {
  const started = await startRedlineFile({ contractId, groupId: meta.groupId, position: meta.position, fileName: meta.fileName, mimeType: meta.mimeType as "image/jpeg", sizeBytes: blob.size });
  if ("error" in started) return started;
  for (let at = 0; at < blob.size; at += CHUNK) {
    const form = new FormData();
    form.set("id", started.id);
    form.set("chunk", blob.slice(at, at + CHUNK));
    const sent = await addRedlineChunk(form);
    // The group goes back with the error, so the caller lets it go.
    if ("error" in sent) return { error: sent.error, groupId: started.groupId };
  }
  return started;
}

export function RedlineReader({
  contractId,
  body,
  status,
  initial,
  files,
}: {
  contractId: string;
  body: string;
  status: string;
  initial: RedlineResult | null;
  files: RedlineFileGroup[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RedlineResult | null>(initial);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { setDraft } = useRedlineDraft();

  const accepted = result ? result.changes.filter((change) => decisions[change.id] === "accept") : [];

  function choose(fileList: FileList | null) {
    const picked = Array.from(fileList ?? []);
    if (picked.length === 0) return;
    setError(null);
    setNotice(null);
    start(async () => {
      let groupId: string | undefined;
      try {
        const first = picked[0];
        const name = first.name.toLowerCase();
        const photos = picked.every((file) => file.type.startsWith("image/"));
        let wordText: string | undefined;
        let tracked: { inserted: string[]; deleted: string[] } | undefined;
        if (photos) {
          if (picked.length > MAX_PHOTOS) throw new Error(`Up to ${MAX_PHOTOS} photos at a time.`);
          for (const [position, file] of picked.entries()) {
            start(() => setStage(`Making photo ${position + 1} of ${picked.length} small…`));
            const small = await pictureForAi(file, 1568, 0.8);
            start(() => setStage(`Sending photo ${position + 1} of ${picked.length}…`));
            const sent = await sendFile(contractId, small, { fileName: file.name || `page-${position + 1}.jpg`, mimeType: "image/jpeg", position, groupId });
            groupId = ("groupId" in sent ? sent.groupId : undefined) ?? groupId;
            if ("error" in sent) throw new Error(sent.error);
          }
        } else if (picked.length > 1) {
          throw new Error("Upload one Word or PDF file, or photos of the pages.");
        } else if (name.endsWith(".pdf")) {
          if (first.size > MAX_BYTES) throw new Error("Keep the PDF under 10 MB.");
          const pdf = await readPdf(first, 100);
          if ("error" in pdf) throw new Error(pdf.error);
          if (pdf.pages > 100) throw new Error(`That PDF is ${pdf.pages} pages. The AI reads up to 100: send just the agreement.`);
          start(() => setStage("Sending the PDF…"));
          const sent = await sendFile(contractId, first, { fileName: first.name, mimeType: "application/pdf", position: 0 });
          groupId = ("groupId" in sent ? sent.groupId : undefined) ?? groupId;
          if ("error" in sent) throw new Error(sent.error);
        } else if (name.endsWith(".docx")) {
          if (first.size > MAX_BYTES) throw new Error("Keep the Word file under 10 MB.");
          const read = await readAgreementFile(first, 80_000);
          if ("error" in read) throw new Error(read.error);
          wordText = read.text;
          tracked = readTrackedChanges(new Uint8Array(await first.arrayBuffer()));
          start(() => setStage("Sending the Word file…"));
          const sent = await sendFile(contractId, first, { fileName: first.name, mimeType: DOCX, position: 0 });
          groupId = ("groupId" in sent ? sent.groupId : undefined) ?? groupId;
          if ("error" in sent) throw new Error(sent.error);
        } else if (name.endsWith(".doc")) {
          throw new Error("That's the old Word format. Open it in Word and Save As .docx, then upload that.");
        } else {
          throw new Error("Upload a Word (.docx) or PDF file, or photos of the pages.");
        }
        start(() => setStage("Reading their changes against your wording…"));
        const read = await readRedline({ contractId, groupId: groupId!, wordText, tracked });
        if ("error" in read) throw new Error(read.error);
        start(() => {
          setResult(read);
          setDecisions({});
          setStage(null);
        });
        router.refresh();
      } catch (problem) {
        if (groupId) await discardRedlineGroup(contractId, groupId).catch(() => {});
        const message = problem instanceof Error ? problem.message : "That couldn't be read. Try again.";
        start(() => {
          setError(message);
          setStage(null);
        });
      } finally {
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  }

  function putIn() {
    if (!result || accepted.length === 0) return;
    // Onto what is in the editor now, typed and not yet saved included
    // (audit fix), else the saved wording.
    const editor = document.querySelector<HTMLTextAreaElement>("textarea[name=body]");
    const applied = applyRedlines(editor?.value ?? body, accepted);
    if (applied.applied.length === 0) {
      setError("None of the accepted changes fit the wording any more.");
      return;
    }
    setDraft(applied.body, applied.applied.length);
    setNotice(
      `${applied.applied.length === 1 ? "One change is" : `${applied.applied.length} changes are`} in the body as a draft. Save to keep ${applied.applied.length === 1 ? "it" : "them"}, then send again.` +
        (applied.missed.length ? ` ${applied.missed.length} no longer fit the wording and ${applied.missed.length === 1 ? "was" : "were"} left out.` : ""),
    );
    setConfirming(false);
  }

  function pullBackAndPutIn() {
    start(async () => {
      const form = new FormData();
      form.set("contractId", contractId);
      form.set("status", "DRAFT");
      await setContractStatus(form);
      // Signed or changed in the meantime: nothing to put the changes in.
      const now = await contractStatusOf(contractId);
      // A refresh would take this card away from a signed or cancelled
      // contract before the reason could be read; the message says reload.
      if (now === "DRAFT") router.refresh();
      start(() => {
        if (now !== "DRAFT") {
          setConfirming(false);
          setError("It couldn't go back to draft: it was signed or changed in the meantime. Reload the page.");
          return;
        }
        putIn();
      });
    });
  }

  return (
    <div className="space-y-4 p-5" data-testid="redline-reader">
      <div className="flex flex-wrap items-center gap-2">
        <label className={`btn btn-ghost btn-sm min-h-11 sm:min-h-0 ${pending ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
          <IconUpload size={13} />
          {pending ? "Reading…" : "Read their marked-up copy"}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".docx,.pdf,image/*,application/pdf"
            className="sr-only"
            disabled={pending}
            onChange={(event) => choose(event.target.files)}
            data-testid="redline-file"
          />
        </label>
        <p className="faint text-xs">Word, PDF (up to 10 MB, 100 pages) or photos of the pages (up to {MAX_PHOTOS}).</p>
      </div>
      {stage && <p className="muted text-xs" role="status" data-testid="redline-stage">{stage}</p>}
      {error && <p role="alert" className="text-sm text-[var(--danger)]" data-testid="redline-error">{error}</p>}

      {result && (
        <div className="space-y-3" data-testid="redline-result">
          {result.changes.length === 0 && result.unplaced.length === 0 && (
            <p className="muted text-sm">No changes found in their copy.</p>
          )}
          {result.changes.length > 0 && (
            <ul className="space-y-3">
              {result.changes.map((change) => (
                <ChangeRow
                  key={change.id}
                  change={change}
                  decision={decisions[change.id]}
                  onDecide={(decision) => setDecisions((all) => ({ ...all, [change.id]: decision }))}
                />
              ))}
            </ul>
          )}
          {result.unplaced.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] p-3" data-testid="redline-unplaced">
              <p className="text-sm font-semibold">Couldn&apos;t place {result.unplaced.length === 1 ? "this one" : `these ${result.unplaced.length}`}</p>
              <p className="faint text-xs">Their words don&apos;t match one spot in your wording. Read them and change the body by hand if you agree.</p>
              <ul className="mt-2 space-y-2">
                {result.unplaced.map((row, index) => (
                  <li key={index} className="text-sm" data-testid="redline-unplaced-item">
                    <span className="whitespace-pre-wrap text-[var(--text-strong)]">“{row.theirWords}”</span>
                    {row.explanation && <span className="muted block text-xs">{row.explanation}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.changes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={accepted.length === 0 || pending}
                onClick={() => (status === "SENT" ? setConfirming(true) : putIn())}
                className="btn btn-primary btn-sm min-h-11 sm:min-h-0"
                data-testid="redline-put-in"
              >
                Put {accepted.length === 1 ? "1 accepted change" : `${accepted.length} accepted changes`} in the body
              </button>
              <span className="faint text-xs">Nothing is saved until you press Save changes on the Agreement.</span>
            </div>
          )}
          {notice && <p role="status" className="text-sm text-[var(--ok)]" data-testid="redline-notice">{notice}</p>}
        </div>
      )}

      {files.length > 0 && (
        <div className="border-t border-[var(--hairline-3)] pt-3">
          <p className="eyebrow mb-1">Their copies on file</p>
          <ul className="space-y-1 text-xs" data-testid="redline-files">
            {files.map((group) => (
              <li key={group.groupId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="faint">{group.when}</span>
                {group.files.map((file) => (
                  <a key={file.id} href={`/dashboard/contracts/${contractId}/files/${file.id}`} className="link inline-flex items-center gap-1">
                    <IconDownload size={11} />
                    {file.fileName}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirming &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="modal-backdrop" onClick={() => setConfirming(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="redline-pull-title"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.key === "Escape" && setConfirming(false)}
              className="card card-lit popover w-full max-w-md p-5"
              data-testid="redline-pull-back"
            >
              <h2 id="redline-pull-title" className="text-sm font-semibold">Pull it back to draft?</h2>
              <p className="muted mt-2 text-sm">
                The contract is out for signature. To change its wording it goes back to draft, and the customer&apos;s link
                stops working until you send it again.
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" autoFocus onClick={() => setConfirming(false)} className="btn btn-ghost btn-sm min-h-11 sm:min-h-0">
                  Keep it out
                </button>
                <button type="button" onClick={pullBackAndPutIn} disabled={pending} className="btn btn-primary btn-sm min-h-11 sm:min-h-0" data-testid="redline-pull-back-yes">
                  Pull back and put them in
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ChangeRow({ change, decision, onDecide }: { change: RedlineChange; decision?: Decision; onDecide: (decision: Decision) => void }) {
  return (
    <li className="rounded-lg border border-[var(--border)] p-3" data-testid="redline-change" data-decision={decision ?? ""}>
      <p className="text-sm text-[var(--text-strong)]">{change.explanation || (change.deleted ? "They struck this out." : "They changed this.")}</p>
      <div className="mt-2 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <p className="eyebrow">Your wording</p>
          <p className="muted whitespace-pre-wrap break-words line-through decoration-[var(--danger)]">{change.snippet}</p>
        </div>
        <div className="min-w-0">
          <p className="eyebrow">They want</p>
          <p className="whitespace-pre-wrap break-words text-[var(--text-strong)]">{change.deleted ? "(deleted)" : change.replacement}</p>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          aria-pressed={decision === "accept"}
          onClick={() => onDecide("accept")}
          className={`btn btn-sm min-h-11 sm:min-h-0 ${decision === "accept" ? "btn-primary" : "btn-ghost"}`}
          data-testid="redline-accept"
        >
          <IconCheck size={12} />
          Accept
        </button>
        <button
          type="button"
          aria-pressed={decision === "reject"}
          onClick={() => onDecide("reject")}
          className={`btn btn-sm min-h-11 sm:min-h-0 ${decision === "reject" ? "btn-primary" : "btn-ghost"}`}
          data-testid="redline-reject"
        >
          <IconX size={12} />
          Reject
        </button>
      </div>
    </li>
  );
}
