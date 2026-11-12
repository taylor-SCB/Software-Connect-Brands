"use client";

import { useState } from "react";
import { Badge } from "@/components/ui";
import { IconDownload, IconPlus, IconTrash } from "@/components/icons";
import { FLAG_WORDS, type ComplianceLimit } from "@/lib/compliance-shared";
import type { ComplianceFlag } from "@/lib/contract-checks";
import { DocumentUploadForm } from "@/app/dashboard/settings/document-upload-form";
import { ComplianceDetails } from "@/app/dashboard/settings/compliance-details";
import { deleteDocument } from "@/app/dashboard/settings/actions";

// A subcontractor's COI, license and W-9 on their crew card (Release B,
// Taylor's call 4): what each says, flagged when it has run out, runs out
// within 30 days, or names somebody other than the company that bills you.
// Owners and Admins add and remove them, as for every company file.

export type CrewComplianceView = {
  id: string;
  name: string;
  fileName: string;
  category: string | null;
  expiresOn: string | null;
  publicToken: string;
  namedInsured: string | null;
  insurer: string | null;
  policyNumber: string | null;
  limits: ComplianceLimit[];
  flags: ComplianceFlag[];
};

const flagColor = (flag: ComplianceFlag) => (flag === "EXPIRING" ? "var(--warn)" : "var(--danger)");

export function ComplianceFlagBadge({ flag, category }: { flag: ComplianceFlag; category: string | null }) {
  const what = category && category !== "Other" ? category : "Paperwork";
  const words = flag === "EXPIRED" ? `${what} expired` : flag === "EXPIRING" ? `${what} runs out soon` : `${what} names someone else`;
  return (
    <span data-testid="crew-compliance-flag" data-flag={flag}>
      <Badge color={flag === "EXPIRING" ? "#f59e0b" : "#f43f5e"}>{words}</Badge>
    </span>
  );
}

export function CrewCompliance({
  crewId,
  docs,
  canManageFiles,
  aiOn,
  expectedName,
}: {
  crewId: string;
  docs: CrewComplianceView[];
  canManageFiles: boolean;
  aiOn: boolean;
  expectedName: string;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="border-t border-[var(--hairline-3)] pt-3" data-testid="crew-compliance">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="eyebrow">Compliance{docs.length > 0 && ` · ${docs.length}`}</p>
        {canManageFiles && (
          <button type="button" onClick={() => setAdding(!adding)} className="btn btn-ghost btn-sm min-h-11 sm:min-h-0" data-testid="crew-compliance-add">
            <IconPlus size={13} />
            {adding ? "Close" : "Add COI, license or W-9"}
          </button>
        )}
      </div>
      {docs.length === 0 ? (
        <p className="faint text-xs">No COI on file. Ask them for one before they go on a job.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((doc) => (
            <li key={doc.id} className="flex min-w-0 items-start justify-between gap-2 text-sm" data-testid="crew-compliance-doc">
              <div className="min-w-0">
                <p className="font-medium">
                  {doc.name} {doc.category && <span className="faint text-xs">· {doc.category}</span>}
                </p>
                {doc.expiresOn && (
                  <p
                    className="text-xs"
                    style={{ color: doc.flags.includes("EXPIRED") || doc.flags.includes("EXPIRING") ? flagColor(doc.flags.includes("EXPIRED") ? "EXPIRED" : "EXPIRING") : undefined }}
                  >
                    Expires {new Date(`${doc.expiresOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                    {doc.flags.includes("EXPIRED") ? ` · ${FLAG_WORDS.EXPIRED}` : doc.flags.includes("EXPIRING") ? ` · ${FLAG_WORDS.EXPIRING}` : ""}
                  </p>
                )}
                <ComplianceDetails doc={{ compliance: doc }} expectedName={expectedName} />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a href={`/files/${doc.publicToken}`} className="btn btn-ghost btn-sm" title="Download" aria-label={`Download ${doc.name}`}>
                  <IconDownload size={13} />
                </a>
                {canManageFiles && (
                  <form action={deleteDocument}>
                    <input type="hidden" name="uploadId" value={doc.id} />
                    <button type="submit" className="btn btn-icon-danger btn-sm" aria-label={`Delete ${doc.name}`}>
                      <IconTrash size={13} />
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && canManageFiles && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--tint-1)]">
          <DocumentUploadForm kind="COMPLIANCE" aiOn={aiOn} crewId={crewId} idPrefix={`crew-${crewId}`} />
        </div>
      )}
    </div>
  );
}
