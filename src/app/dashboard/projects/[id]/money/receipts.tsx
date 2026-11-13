"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/how-did-it-go/sheet";
import { IconUpload } from "@/components/icons";
import { centsToDollarInput, dollarsToCents, formatCents } from "@/lib/format";
import { pictureForAi } from "@/lib/ai-picture";
import { approveReceipt, declineReceipt, readReceipt, saveReceipt } from "../../receipt-actions";

type Scope = { id: string; name: string };
type Item = { name: string; quantity: number; amountCents: number };

export type PendingReceipt = {
  id: string;
  photoSrc: string | null;
  sentBy: string;
  sentOn: string;
  storeName: string;
  purchasedOn: string | null;
  totalCents: number;
  taxCents: number;
  items: Item[];
  aiRead: boolean;
};

// The fields every receipt is checked in: which scope, which store, the
// day, the total and the tax. Shared by Add receipt and the approval list.
function BillFields({
  prefix,
  scopes,
  suppliers,
  values,
  onChange,
  match,
}: {
  prefix: string;
  scopes: Scope[];
  suppliers: string[];
  values: { scopeId: string; storeName: string; purchasedOn: string; total: string; tax: string };
  onChange: (next: Partial<{ scopeId: string; storeName: string; purchasedOn: string; total: string; tax: string }>) => void;
  match?: string | null;
}) {
  const known = suppliers.some((name) => name.toLowerCase() === values.storeName.trim().toLowerCase());
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0">
        <label className="label" htmlFor={`${prefix}-scope`}>
          Scope
        </label>
        <select id={`${prefix}-scope`} value={values.scopeId} onChange={(event) => onChange({ scopeId: event.target.value })} className="input min-h-11 w-full" data-testid={`${prefix}-scope`}>
          {scopes.map((scope) => (
            <option key={scope.id} value={scope.id}>
              {scope.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <label className="label" htmlFor={`${prefix}-store`}>
          Store / supplier
        </label>
        <input
          id={`${prefix}-store`}
          value={values.storeName}
          onChange={(event) => onChange({ storeName: event.target.value })}
          list={`${prefix}-stores`}
          maxLength={120}
          className="input min-h-11 w-full"
          data-testid={`${prefix}-store`}
        />
        <datalist id={`${prefix}-stores`}>
          {suppliers.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <p className="faint mt-1 text-xs" data-testid={`${prefix}-store-note`}>
          {!values.storeName.trim()
            ? "Pick one of your suppliers or type the store's name."
            : known || match
              ? `Filed under ${match ?? values.storeName.trim()}, already in your companies.`
              : "New: it will be added to your companies as a supplier."}
        </p>
      </div>
      <div className="min-w-0">
        <label className="label" htmlFor={`${prefix}-date`}>
          Date on the receipt
        </label>
        <input id={`${prefix}-date`} type="date" value={values.purchasedOn} onChange={(event) => onChange({ purchasedOn: event.target.value })} className="input min-h-11 w-full" data-testid={`${prefix}-date`} />
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <div className="min-w-0">
          <label className="label" htmlFor={`${prefix}-total`}>
            Total paid
          </label>
          <input id={`${prefix}-total`} inputMode="decimal" value={values.total} onChange={(event) => onChange({ total: event.target.value })} className="input num min-h-11 w-full" data-testid={`${prefix}-total`} />
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor={`${prefix}-tax`}>
            Of which tax
          </label>
          <input id={`${prefix}-tax`} inputMode="decimal" value={values.tax} onChange={(event) => onChange({ tax: event.target.value })} className="input num min-h-11 w-full" data-testid={`${prefix}-tax`} />
        </div>
      </div>
    </div>
  );
}

function ItemsList({ items }: { items: Item[] }) {
  if (!items.length) return null;
  return (
    <details className="text-xs" data-testid="receipt-items">
      <summary className="muted cursor-pointer">
        {items.length} {items.length === 1 ? "item" : "items"} read from the receipt
      </summary>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, index) => (
          <li key={index} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {item.quantity} × {item.name}
            </span>
            <span className="num">{formatCents(item.amountCents)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// "Add receipt": snap or pick the photo; with AI on it is read into the
// form, without it the form starts empty. Nothing is saved until Save.
export function AddReceipt({
  projectId,
  scopes,
  suppliers,
  aiOn,
  today,
}: {
  projectId: string;
  scopes: Scope[];
  suppliers: string[];
  aiOn: boolean;
  today: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [aiRead, setAiRead] = useState(false);
  const [match, setMatch] = useState<string | null>(null);
  const [values, setValues] = useState({ scopeId: scopes[0]?.id ?? "", storeName: "", purchasedOn: today, total: "", tax: "" });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [done, setDone] = useState("");

  function reset() {
    setPhoto(null);
    setItems([]);
    setAiRead(false);
    setMatch(null);
    setMessage(null);
    setValues({ scopeId: scopes[0]?.id ?? "", storeName: "", purchasedOn: today, total: "", tax: "" });
  }

  function picked(file: File) {
    // A new photo starts clean: the last one's items and match don't carry
    // over into this bill (audit fix).
    setMessage(null);
    setItems([]);
    setAiRead(false);
    setMatch(null);
    start(async () => {
      let base64: string;
      try {
        base64 = await pictureForAi(file, 1568, 0.8);
      } catch (caught) {
        start(() => setMessage({ text: caught instanceof Error ? caught.message : "That photo couldn't be read.", error: true }));
        return;
      }
      start(() => setPhoto(base64));
      if (!aiOn) return;
      const result = await readReceipt(projectId, base64);
      start(() => {
        if ("error" in result) {
          setMessage({ text: `${result.error} Fill it in by hand below.`, error: true });
          return;
        }
        const read = result.read;
        setItems(read.items);
        setAiRead(true);
        setMatch(result.match?.name ?? null);
        setValues((current) => ({
          ...current,
          storeName: result.match?.name ?? read.storeName,
          purchasedOn: read.purchasedOn ?? current.purchasedOn,
          total: read.totalCents ? centsToDollarInput(read.totalCents) : "",
          tax: read.taxCents ? centsToDollarInput(read.taxCents) : "",
        }));
        setMessage({ text: "Read from the photo. Check every figure against the receipt, then save." });
      });
    });
  }

  function save() {
    if (!photo) return;
    setMessage(null);
    start(async () => {
      const result = await saveReceipt(
        projectId,
        {
          scopeId: values.scopeId,
          storeName: values.storeName,
          purchasedOn: values.purchasedOn,
          totalCents: dollarsToCents(values.total),
          taxCents: dollarsToCents(values.tax),
          items,
          aiRead,
        },
        photo,
      );
      start(() => {
        if (result.error) return setMessage({ text: result.error, error: true });
        setDone(result.success ?? "Saved");
        setOpen(false);
        reset();
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => {
          reset();
          setDone("");
          setOpen(true);
        }}
        className="btn btn-primary btn-sm"
        data-testid="receipt-add"
      >
        Add receipt
      </button>
      {done && (
        <span className="text-xs text-[var(--ok)]" role="status" data-testid="receipt-done">
          {done}
        </span>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Add receipt"
        title="A receipt from a store"
        testId="receipt-sheet"
        footer={
          photo ? (
            <button type="button" onClick={save} disabled={pending} className="btn btn-primary min-h-11 w-full sm:w-auto" data-testid="receipt-save">
              {pending ? "Working…" : "Save as a paid bill"}
            </button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            capture="environment"
            className="sr-only"
            data-testid="receipt-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) picked(file);
              event.target.value = "";
            }}
          />
          {!photo ? (
            <>
              <button type="button" onClick={() => input.current?.click()} disabled={pending} className="btn btn-primary min-h-11 w-full justify-center py-4" data-testid="receipt-pick">
                <IconUpload size={16} />
                {pending ? "Getting it ready…" : "Take or pick the receipt photo"}
              </button>
              <p className="faint text-xs">
                {aiOn ? "It's read for the store, date, total and tax. You check them before anything is saved." : "You'll type the store, date and total from it."}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/jpeg;base64,${photo}`} alt="The receipt" className="h-24 w-20 rounded object-cover" data-testid="receipt-preview" />
                <div className="min-w-0 space-y-1">
                  {pending && <p className="muted text-sm" role="status">Reading the receipt…</p>}
                  <button type="button" onClick={() => input.current?.click()} disabled={pending} className="btn btn-ghost btn-sm">
                    Use another photo
                  </button>
                </div>
              </div>
              <BillFields
                prefix="receipt"
                scopes={scopes}
                suppliers={suppliers}
                values={values}
                onChange={(next) => {
                  // Retyped store: the read's match no longer applies (audit fix).
                  if (next.storeName !== undefined && next.storeName.trim().toLowerCase() !== match?.toLowerCase()) setMatch(null);
                  setValues((current) => ({ ...current, ...next }));
                }}
                match={match}
              />
              <ItemsList items={items} />
              <p className="faint text-xs">Saved as a paid bill from the store on that scope, counted in Spent, with the photo in Files → Receipts.</p>
            </>
          )}
          {message && (
            <p className={`text-sm ${message.error ? "text-[var(--danger)]" : "muted"}`} role={message.error ? "alert" : "status"} data-testid="receipt-message">
              {message.text}
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
}

// "Receipts waiting for approval": sent through the crew photo link. They
// count nowhere until an Owner or Admin approves one.
export function PendingReceipts({
  receipts,
  scopes,
  suppliers,
  canApprove,
  today,
}: {
  receipts: PendingReceipt[];
  scopes: Scope[];
  suppliers: string[];
  canApprove: boolean;
  today: string;
}) {
  return (
    <ul className="divide-y divide-[var(--hairline)]" data-testid="pending-receipts">
      {receipts.map((receipt) => (
        <PendingRow key={receipt.id} receipt={receipt} scopes={scopes} suppliers={suppliers} canApprove={canApprove} today={today} />
      ))}
    </ul>
  );
}

function PendingRow({
  receipt,
  scopes,
  suppliers,
  canApprove,
  today,
}: {
  receipt: PendingReceipt;
  scopes: Scope[];
  suppliers: string[];
  canApprove: boolean;
  today: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    scopeId: scopes[0]?.id ?? "",
    storeName: receipt.storeName,
    purchasedOn: receipt.purchasedOn ?? today,
    total: receipt.totalCents ? centsToDollarInput(receipt.totalCents) : "",
    tax: receipt.taxCents ? centsToDollarInput(receipt.taxCents) : "",
  });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  function act(kind: "approve" | "decline") {
    setMessage(null);
    start(async () => {
      const result =
        kind === "approve"
          ? await approveReceipt(receipt.id, {
              scopeId: values.scopeId,
              storeName: values.storeName,
              purchasedOn: values.purchasedOn,
              totalCents: dollarsToCents(values.total),
              taxCents: dollarsToCents(values.tax),
            })
          : await declineReceipt(receipt.id);
      start(() => setMessage(result.error ? { text: result.error, error: true } : { text: result.success ?? "Done" }));
      if (!result.error) router.refresh();
    });
  }

  return (
    <li className="space-y-3 px-5 py-4" data-testid="pending-receipt" data-id={receipt.id}>
      <div className="flex items-start gap-3">
        {receipt.photoSrc && (
          <a href={receipt.photoSrc} target="_blank" rel="noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={receipt.photoSrc} alt="Receipt photo" className="h-20 w-16 rounded object-cover" />
          </a>
        )}
        <div className="min-w-0 text-sm">
          <p className="font-medium">
            {receipt.storeName || "Store not read"} · {receipt.totalCents ? formatCents(receipt.totalCents) : "total not read"}
          </p>
          <p className="faint text-xs" data-testid="pending-receipt-who">
            Sent by {receipt.sentBy} on the crew link · {receipt.sentOn}
            {receipt.aiRead ? " · read by AI, check it" : " · typed in by the office"}
          </p>
          <ItemsList items={receipt.items} />
        </div>
      </div>
      {canApprove ? (
        <>
          <BillFields prefix={`pending-${receipt.id}`} scopes={scopes} suppliers={suppliers} values={values} onChange={(next) => setValues((current) => ({ ...current, ...next }))} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => act("approve")} disabled={pending} className="btn btn-primary btn-sm min-h-11" data-testid="pending-approve">
              Approve
            </button>
            <button type="button" onClick={() => act("decline")} disabled={pending} className="btn btn-ghost btn-sm min-h-11" data-testid="pending-decline">
              Decline
            </button>
          </div>
        </>
      ) : (
        <p className="faint text-xs">Waiting for an owner or admin to approve it.</p>
      )}
      {message && (
        <p className={`text-sm ${message.error ? "text-[var(--danger)]" : "muted"}`} role={message.error ? "alert" : "status"} data-testid="pending-message">
          {message.text}
        </p>
      )}
    </li>
  );
}
