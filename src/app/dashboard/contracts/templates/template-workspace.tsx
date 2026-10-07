"use client";

import Link from "next/link";
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
import type { TemplateSibling } from "@/lib/contract-templates";
import { createContract, previewMergeContext, importTemplateFile, suggestTemplateFields } from "../actions";
import type { FieldSuggestion } from "@/lib/template-import";

// A form posts line breaks as \r\n, so a saved body and the built-in can
// differ only in those and still be the same wording.
function sameWording(a: string, b: string) {
  const clean = (text: string) => text.replace(/\r\n/g, "\n").trim();
  return clean(a) === clean(b);
}

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
  templatesByType,
  baselineBody,
  aiEnabled = false,
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
    isDefault?: boolean;
  };
  // The workspace's other templates, by type, for the "already have one"
  // note and the in-use box.
  templatesByType: Record<string, TemplateSibling[]>;
  // The built-in wording this template started as, when it did.
  baselineBody?: string | null;
  // Suggest fields needs the AI key set on the site.
  aiEnabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  const [body, setBody] = useState(defaults?.body ?? "");
  const [type, setType] = useState(defaults?.type ?? pickers.typeOptions[0] ?? "Custom");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);

  // Replace with my own / Restore the original swap the whole body in the
  // editor; nothing is saved until Save, and Undo puts the last one back.
  const [swap, setSwap] = useState<{ previous: string; note: string } | null>(null);
  function swapBody(next: string, note: string) {
    setSwap({ previous: body, note });
    setBody(next);
    setPreviewing(false);
    pendingCaret.current = 0;
  }
  // Upload a Word / PDF / text agreement into the editor.
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, startImport] = useTransition();
  const [importError, setImportError] = useState<string | null>(null);
  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError(null);
    const data = new FormData();
    data.set("file", file);
    startImport(async () => {
      const result = await importTemplateFile(data);
      if ("error" in result) setImportError(result.error);
      else {
        setSuggestions(null);
        swapBody(result.text, `Read from ${file.name}. Check it over, place the fields, then Save.`);
      }
    });
  }

  // Suggest fields: Claude proposes where fields go; each is a tick box and
  // nothing changes until "Put ticked fields in".
  const [suggesting, startSuggest] = useTransition();
  const [suggestions, setSuggestions] = useState<{ list: FieldSuggestion[]; ticked: boolean[] } | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  function suggest() {
    setSuggestError(null);
    startSuggest(async () => {
      const result = await suggestTemplateFields(body);
      if ("error" in result) {
        setSuggestError(result.error);
        setSuggestions(null);
      } else {
        setSuggestions({ list: result.suggestions, ticked: result.suggestions.map(() => true) });
      }
    });
  }
  function applySuggestions() {
    if (!suggestions) return;
    let next = body;
    let placed = 0;
    suggestions.list.forEach((item, index) => {
      if (!suggestions.ticked[index]) return;
      const at = next.indexOf(item.find);
      if (at === -1) return;
      next = next.slice(0, at) + item.replaceWith + next.slice(at + item.find.length);
      placed += 1;
    });
    setSuggestions(null);
    swapBody(next, `Put ${placed} field${placed === 1 ? "" : "s"} in. Check them with Preview, then Save.`);
  }

  const siblings = templatesByType[type] ?? [];
  const inUse = siblings.find((sibling) => sibling.isDefault) ?? siblings[0];

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

            {siblings.length > 0 && (
              <div className="rounded-lg border border-[var(--border)] p-3 text-sm" data-testid="template-in-use">
                {!defaults?.id && (
                  <p className="faint mb-2 text-xs">
                    You already have {siblings.length === 1 ? "a" : siblings.length} {type} template
                    {siblings.length === 1 ? "" : "s"}
                    {inUse && (
                      <>
                        {" "}
                        (
                        <Link href={`/dashboard/contracts/templates/${inUse.id}`} className="underline">
                          {inUse.name}
                        </Link>
                        )
                      </>
                    )}
                    . To put your own wording in its place, open it and click Replace with my own.
                  </p>
                )}
                <input type="hidden" name="isDefaultShown" value="1" />
                <label className="flex items-start gap-2">
                  <input
                    key={type}
                    type="checkbox"
                    name="isDefault"
                    data-testid="template-is-default"
                    defaultChecked={Boolean(defaults?.isDefault) && type === defaults?.type}
                    className="mt-0.5"
                  />
                  <span>
                    Use this one for every {type} the app makes on its own
                    <span className="faint block text-xs">
                      Contract Coordinator, Award without paperwork, Order materials and change orders.
                      {inUse && !(defaults?.isDefault && type === defaults?.type) && (
                        <> In use now: {inUse.name}.</>
                      )}
                    </span>
                  </span>
                </label>
              </div>
            )}

            <MergeFieldPalette onInsert={insertToken} />

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="label mb-0" htmlFor="body">
                    Body
                  </label>
                  <button
                    type="button"
                    data-testid="template-replace"
                    onClick={() => swapBody("", "Paste or type your own agreement, then Save.")}
                    className="btn btn-ghost btn-sm"
                  >
                    Replace with my own
                  </button>
                  <button
                    type="button"
                    data-testid="template-upload"
                    disabled={importing}
                    onClick={() => fileRef.current?.click()}
                    className="btn btn-ghost btn-sm"
                  >
                    {importing ? "Reading…" : "Upload Word or PDF"}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".docx,.pdf,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    data-testid="template-upload-input"
                    onChange={onFile}
                    className="hidden"
                  />
                  {aiEnabled && (
                    <button
                      type="button"
                      data-testid="template-suggest"
                      disabled={suggesting || body.trim().length < 20}
                      onClick={suggest}
                      className="btn btn-ghost btn-sm"
                    >
                      {suggesting ? "Reading the agreement…" : "Suggest fields"}
                    </button>
                  )}
                  {baselineBody && !sameWording(body, baselineBody) && (
                    <button
                      type="button"
                      data-testid="template-restore"
                      onClick={() => swapBody(baselineBody, "The original wording is back. Save to keep it.")}
                      className="btn btn-ghost btn-sm"
                    >
                      Restore the original
                    </button>
                  )}
                </div>
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
              {(importError || suggestError) && (
                <p className="mb-1.5 text-xs text-[#f38b8b]" role="alert" data-testid="template-import-error">
                  {importError ?? suggestError}
                </p>
              )}
              {suggestions && (
                <div className="mb-3 rounded-lg border border-[var(--border)] p-3" data-testid="template-suggestions">
                  {suggestions.list.length === 0 ? (
                    <p className="faint text-sm">
                      No spots for fields found. Place them with the chips above.{" "}
                      <button type="button" className="underline" onClick={() => setSuggestions(null)}>
                        Close
                      </button>
                    </p>
                  ) : (
                    <>
                      <p className="mb-2 text-sm font-medium">
                        {suggestions.list.length} suggested field{suggestions.list.length === 1 ? "" : "s"}. Untick any that are wrong.
                      </p>
                      <ul className="max-h-72 space-y-2 overflow-y-auto">
                        {suggestions.list.map((item, index) => (
                          <li key={item.find}>
                            <label className="flex items-start gap-2 text-xs">
                              <input
                                type="checkbox"
                                data-testid="template-suggestion"
                                checked={suggestions.ticked[index]}
                                onChange={(event) =>
                                  setSuggestions({
                                    ...suggestions,
                                    ticked: suggestions.ticked.map((tick, i) => (i === index ? event.target.checked : tick)),
                                  })
                                }
                                className="mt-0.5"
                              />
                              <span className="min-w-0">
                                <span className="font-medium">{item.label}</span>
                                <span className="faint block break-words">
                                  {item.find} → {item.replaceWith}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          data-testid="template-apply-suggestions"
                          disabled={!suggestions.ticked.some(Boolean)}
                          onClick={applySuggestions}
                          className="btn btn-primary btn-sm"
                        >
                          Put ticked fields in
                        </button>
                        <button type="button" onClick={() => setSuggestions(null)} className="btn btn-ghost btn-sm">
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {swap && (
                <p className="faint mb-1.5 text-xs" aria-live="polite" data-testid="template-swap-note">
                  {swap.note}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setBody(swap.previous);
                      setSwap(null);
                    }}
                  >
                    Undo
                  </button>
                </p>
              )}
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
              templateType={type}
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
