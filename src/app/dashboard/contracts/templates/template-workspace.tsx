"use client";

import { useActionState, useCallback, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Card, CardHeader, Field, FormError, FormSuccess } from "@/components/ui";
import { IconEdit, IconExternal } from "@/components/icons";
import { MergeBody, MergeFieldPalette } from "@/components/merge-fields";
import { SenderPicker } from "@/components/sender-picker";
import { CustomerInfoPanel, type CustomerSelection } from "@/components/customer-info-panel";
import { mergeKeysIn, type MergeContext } from "@/lib/merge";
import { NEW_TYPE_VALUE } from "@/lib/contracts";
import type { ActionState } from "@/lib/forms";
import type { ContractPickers } from "@/lib/contract-pickers";
import { createContract, previewMergeContext } from "../actions";

// A template page: the agreement on the left, a silver line, and Customer
// Information on the right. The right column is where a contract is
// generated from; the Preview button on the left fills the chips in with
// that customer's details so you can see what will go out before it does.
export function TemplateWorkspace({
  action,
  submitLabel,
  currentUserId,
  pickers,
  defaults,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  currentUserId: string;
  pickers: ContractPickers;
  defaults?: {
    id?: string;
    name?: string;
    type?: string;
    description?: string;
    body?: string;
    allUsersCanSend?: boolean;
    senderUserIds?: string[];
  };
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  const [body, setBody] = useState(defaults?.body ?? "");
  const [type, setType] = useState(defaults?.type ?? pickers.typeOptions[0] ?? "Custom");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [previewing, setPreviewing] = useState(false);
  const [context, setContext] = useState<MergeContext | null>(null);
  const [loadingPreview, startPreview] = useTransition();
  const selectionRef = useRef<CustomerSelection>({ contactId: "", dealId: "", quoteId: "" });

  const fetchPreview = useCallback(() => {
    const selection = selectionRef.current;
    startPreview(async () => {
      setContext(await previewMergeContext(selection));
    });
  }, []);

  // The Customer Information column reports every change; while the
  // preview is open it refreshes to match.
  const onSelectionChange = useCallback(
    (selection: CustomerSelection) => {
      const before = selectionRef.current;
      selectionRef.current = selection;
      const changed =
        before.contactId !== selection.contactId ||
        before.dealId !== selection.dealId ||
        before.quoteId !== selection.quoteId;
      if (changed && previewing) fetchPreview();
    },
    [previewing, fetchPreview],
  );

  function togglePreview() {
    if (previewing) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    fetchPreview();
  }

  // Drops a chip's token into the body where the cursor last was. The
  // caret is put back right after the new text is committed, so typing can
  // carry on where the chip landed.
  const pendingCaret = useRef<number | null>(null);
  function insertToken(token: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    pendingCaret.current = start + token.length;
  }
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const textarea = textareaRef.current;
    if (caret === null || !textarea || previewing) return;
    pendingCaret.current = null;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
  }, [body, previewing]);

  // Type options: the workspace's list, plus this template's own type if
  // it was removed from the list, plus "+ Add new type".
  const typeOptions = pickers.typeOptions.includes(type) || type === NEW_TYPE_VALUE
    ? pickers.typeOptions
    : [...pickers.typeOptions, type];

  const usedKeys = mergeKeysIn(body);
  const filled = context ? usedKeys.filter((key) => Boolean(context[key])).length : 0;
  const missing = usedKeys.length - filled;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
      {/* ---------------------------- Agreement ---------------------------- */}
      <div className="min-w-0 flex-1">
        <Card lit>
          <CardHeader
            title="Agreement"
            subtitle="The wording, and the fields that fill in for each customer."
          />
          <form action={formAction} className="space-y-4 p-5">
            {defaults?.id && <input type="hidden" name="templateId" value={defaults.id} />}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Template name"
                name="name"
                placeholder="Service Agreement"
                defaultValue={defaults?.name ?? ""}
                required
              />
              <div>
                <label className="label" htmlFor="type">
                  Type
                </label>
                <select
                  id="type"
                  name="type"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  className="select"
                >
                  {typeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={NEW_TYPE_VALUE}>+ Add new type…</option>
                </select>
                {type === NEW_TYPE_VALUE && (
                  <input
                    name="newType"
                    placeholder="Commission Agreement, mNDA, Tradeshow Sponsor…"
                    aria-label="New type name"
                    autoFocus
                    required
                    maxLength={60}
                    className="input mt-2"
                  />
                )}
              </div>
            </div>

            <Field
              label="Description"
              name="description"
              placeholder="Master agreement for a new engagement."
              defaultValue={defaults?.description ?? ""}
            />

            <SenderPicker
              users={pickers.users}
              currentUserId={currentUserId}
              defaultAllUsers={defaults?.allUsersCanSend ?? true}
              defaultSenderIds={defaults?.senderUserIds ?? []}
            />

            <MergeFieldPalette onInsert={insertToken} />

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="label mb-0" htmlFor="body">
                  Body
                </label>
                {previewing && (
                  <p className="text-xs" aria-live="polite">
                    {loadingPreview ? (
                      <span className="faint">Filling in…</span>
                    ) : (
                      <>
                        <span className="text-[var(--ok)]">{filled} filled</span>
                        <span className="faint"> · </span>
                        <span className={missing ? "text-[#f38b8b]" : "faint"}>
                          {missing} missing
                        </span>
                      </>
                    )}
                  </p>
                )}
              </div>
              <textarea
                ref={textareaRef}
                id="body"
                name="body"
                rows={22}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                className={previewing ? "hidden" : "textarea"}
              />
              {previewing && (
                <div
                  data-testid="template-preview"
                  className="min-h-[24rem] rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4"
                >
                  <MergeBody body={body} context={context} />
                </div>
              )}
            </div>

            <FormError message={state?.error} />
            <FormSuccess message={state?.success} />

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={pending} className="btn btn-primary">
                {pending ? "Saving…" : submitLabel}
              </button>
              <button
                type="button"
                onClick={togglePreview}
                aria-pressed={previewing}
                className={`btn ${previewing ? "btn-primary" : "btn-ghost"}`}
              >
                {previewing ? <IconEdit size={14} /> : <IconExternal size={14} />}
                {previewing ? "Back to editing" : "Preview"}
              </button>
              {previewing && (
                <span className="faint text-xs">
                  Chips show what each field fills in with for the customer on the right.
                </span>
              )}
            </div>
          </form>
        </Card>
      </div>

      {/* --------------------------- Silver line --------------------------- */}
      <div className="divider-silver-h lg:hidden" aria-hidden="true" />
      <div className="divider-silver hidden self-stretch lg:block" aria-hidden="true" />

      {/* ----------------------- Customer Information ---------------------- */}
      <div className="w-full lg:w-[340px] lg:shrink-0">
        <Card lit>
          <CardHeader
            title="Customer Information"
            subtitle="Who this agreement is for, and what fills it in."
          />
          <div className="p-5">
            <CustomerInfoPanel
              action={createContract}
              templateId={defaults?.id}
              contacts={pickers.contacts}
              deals={pickers.deals}
              quotes={pickers.quotes}
              onSelectionChange={onSelectionChange}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
