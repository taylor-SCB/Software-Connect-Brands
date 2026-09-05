import { formatDate, formatDateTime } from "@/lib/format";
import { CONTRACT_TYPE_LABELS, type ContractTypeValue } from "@/lib/constants";

export type ContractDocumentData = {
  number: number;
  title: string;
  type: string;
  body: string;
  status: string;
  createdAt: Date;
  signedAt: Date | null;
  signerName: string | null;
  organization: { name: string; logoUrl: string | null; primaryColor: string };
  contact: { name: string; company: string | null; email: string | null };
};

// Contract bodies are plain text by design — rendering them as HTML would
// mean trusting template authors with markup inside a legal document, so
// the text is escaped by React and whitespace is preserved instead.
export function ContractDocument({ contract }: { contract: ContractDocumentData }) {
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-[#111827] shadow-2xl sm:p-12 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e5e7eb] pb-6">
        <div className="flex items-center gap-3">
          {contract.organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contract.organization.logoUrl}
              alt=""
              className="h-11 w-11 rounded object-cover"
            />
          ) : (
            <div
              className="flex h-11 w-11 items-center justify-center rounded text-sm font-bold text-white"
              style={{ background: contract.organization.primaryColor }}
            >
              {contract.organization.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-lg font-semibold">{contract.organization.name}</p>
            <p className="text-xs text-[#6b7280]">
              {CONTRACT_TYPE_LABELS[contract.type as ContractTypeValue] ?? "Agreement"}
            </p>
          </div>
        </div>
        <div className="text-right text-xs text-[#6b7280]">
          <p className="font-mono text-sm font-semibold text-[#111827]">
            CON-{contract.number}
          </p>
          <p className="mt-1">Issued {formatDate(contract.createdAt)}</p>
        </div>
      </header>

      <h1 className="mt-6 text-xl font-semibold">{contract.title}</h1>
      <p className="mt-1 text-sm text-[#6b7280]">
        Between {contract.organization.name} and{" "}
        {contract.contact.company || contract.contact.name}
      </p>

      <div className="mt-6 whitespace-pre-wrap text-[0.86rem] leading-relaxed text-[#1f2937]">
        {contract.body}
      </div>

      <div className="mt-10 border-t border-[#e5e7eb] pt-6">
        {contract.status === "SIGNED" && contract.signedAt ? (
          <div className="rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] p-4">
            <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#047857]">
              Signed
            </p>
            <p
              className="mt-1 text-2xl text-[#065f46]"
              style={{ fontFamily: "cursive" }}
            >
              {contract.signerName}
            </p>
            <p className="mt-1 text-xs text-[#047857]">
              Accepted electronically on {formatDateTime(contract.signedAt)} UTC
              {contract.contact.email ? ` · ${contract.contact.email}` : ""}
            </p>
          </div>
        ) : (
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <div className="h-10 border-b border-[#9ca3af]" />
              <p className="mt-1 text-xs text-[#6b7280]">
                {contract.contact.company || contract.contact.name}
              </p>
            </div>
            <div>
              <div className="h-10 border-b border-[#9ca3af]" />
              <p className="mt-1 text-xs text-[#6b7280]">
                {contract.organization.name}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
