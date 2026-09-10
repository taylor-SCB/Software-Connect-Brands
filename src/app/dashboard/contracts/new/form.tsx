"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { Card, CardHeader, Badge } from "@/components/ui";
import { IconEdit, IconExternal } from "@/components/icons";
import { MergeBody } from "@/components/merge-fields";
import { CustomerInfoPanel, type CustomerSelection } from "@/components/customer-info-panel";
import { mergeKeysIn, type MergeContext } from "@/lib/merge";
import type { ContractPickers } from "@/lib/contract-pickers";
import { createContract, previewMergeContext } from "../actions";

export type ComposerTemplate = {
  id: string;
  name: string;
  description: string;
  type: string;
  body: string;
};

// New contract: pick the agreement on the left, the customer on the right,
// same two columns as a template page. Preview fills the chips in with the
// customer's details before anything is generated.
export function NewContractComposer({
  templates,
  pickers,
  defaults,
}: {
  templates: ComposerTemplate[];
  pickers: ContractPickers;
  defaults?: { templateId?: string; contactId?: string; dealId?: string };
}) {
  const [templateId, setTemplateId] = useState(defaults?.templateId ?? templates[0]?.id ?? "");
  const template = templates.find((t) => t.id === templateId) ?? templates[0];

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

  const usedKeys = template ? mergeKeysIn(template.body) : [];
  const filled = context ? usedKeys.filter((key) => Boolean(context[key])).length : 0;
  const missing = usedKeys.length - filled;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
      <div className="min-w-0 flex-1">
        <Card lit>
          <CardHeader
            title="Agreement"
            subtitle="Pick the template. You can edit the text after it is generated."
            actions={
              <button
                type="button"
                onClick={togglePreview}
                aria-pressed={previewing}
                className={`btn btn-sm ${previewing ? "btn-primary" : "btn-ghost"}`}
              >
                {previewing ? <IconEdit size={13} /> : <IconExternal size={13} />}
                {previewing ? "Show fields" : "Preview"}
              </button>
            }
          />
          <div className="space-y-4 p-5">
            <div>
              <label className="label" htmlFor="pickTemplate">
                Template
              </label>
              <select
                id="pickTemplate"
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="select"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.type}
                  </option>
                ))}
              </select>
            </div>

            {template && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{template.type}</Badge>
                  {template.description && (
                    <span className="faint text-xs">{template.description}</span>
                  )}
                  {previewing && (
                    <span className="ml-auto text-xs" aria-live="polite">
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
                    </span>
                  )}
                </div>
                <div
                  data-testid="template-preview"
                  className="max-h-[36rem] overflow-y-auto rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4"
                >
                  <MergeBody body={template.body} context={previewing ? context : null} />
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="divider-silver-h lg:hidden" aria-hidden="true" />
      <div className="divider-silver hidden self-stretch lg:block" aria-hidden="true" />

      <div className="w-full lg:w-[340px] lg:shrink-0">
        <Card lit>
          <CardHeader
            title="Customer Information"
            subtitle="Who this agreement is for, and what fills it in."
          />
          <div className="p-5">
            <CustomerInfoPanel
              action={createContract}
              templateId={template?.id}
              contacts={pickers.contacts}
              deals={pickers.deals}
              quotes={pickers.quotes}
              defaults={{ contactId: defaults?.contactId, dealId: defaults?.dealId }}
              onSelectionChange={onSelectionChange}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
