import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { publicProofs } from "@/lib/proofs";
import { ProofAnswers } from "./answer-form";

export const metadata: Metadata = {
  title: "Proofs to approve",
  robots: { index: false, follow: false },
};

// The apparel pack (Nov 12, 2026): the customer's approval page. One link
// per quote shows every proof that has gone out, a big picture of each
// (their logo on the garment, front and back), what it is for, and no
// prices. Public, no login: the token is the only key. A paused workspace's
// link goes dark with it.
export default async function ProofApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 10 || token.length > 100) notFound();
  const quote = await prisma.quote.findUnique({
    where: { proofToken: token },
    select: {
      id: true,
      number: true,
      title: true,
      contact: { select: { name: true } },
      organization: { select: { id: true, name: true, logoUrl: true, primaryColor: true, timeZone: true, status: true } },
    },
  });
  if (!quote) notFound();
  const organization = quote.organization;
  const brand = organization.primaryColor;

  if (organization.status !== "ACTIVE") {
    return (
      <div className="doc-page relative z-10 px-4 py-16 sm:px-6">
        <div className="card mx-auto max-w-md p-8 text-center">
          <p className="text-sm font-semibold">This link is off.</p>
          <p className="faint mt-1 text-xs">Ask whoever sent it for a new one.</p>
        </div>
      </div>
    );
  }

  const proofs = await publicProofs(quote.id, organization.id);
  const waiting = proofs.filter((proof) => proof.version?.status === "SENT" && !proof.beingUpdated);
  const day = (iso: string | null) => (iso ? formatDate(new Date(iso), organization.timeZone) : "");

  return (
    <div className="doc-page relative z-10 px-4 py-10 sm:px-6" style={{ ["--brand" as string]: brand }}>
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="card card-lit flex flex-wrap items-center gap-3 p-5">
          {organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={organization.logoUrl} alt="" className="h-11 w-11 rounded-lg object-cover" />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-lg text-lg font-bold" style={{ background: brand, color: "#fff" }}>
              {organization.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <p className="eyebrow">Proofs from {organization.name}</p>
            <h1 className="text-xl font-semibold">
              QUO-{quote.number} {quote.title}
            </h1>
            <p className="faint text-xs">For {quote.contact.name}</p>
          </div>
        </header>

        {proofs.length === 0 ? (
          <div className="card p-8 text-center text-sm" data-testid="pf-empty">
            There&apos;s nothing to approve here right now.
          </div>
        ) : (
          <>
            <p className="muted text-sm">
              Check each one: the spelling, the colors, and where the logo sits. What you approve is what gets printed.
            </p>
            {proofs.map((proof) => {
              const version = proof.version!;
              return (
                <section key={proof.number} className="card card-lit overflow-hidden" data-testid="pf-proof" data-proof={proof.number}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hairline-3)] px-5 py-3">
                    <h2 className="text-sm font-semibold">
                      Proof {proof.number} · {proof.productName}
                      {proof.colorLabel ? ` · ${proof.colorLabel}` : ""}
                    </h2>
                    <span className="text-xs font-semibold" data-testid="pf-status">
                      {proof.beingUpdated
                        ? `Being updated by ${organization.name}`
                        : version.status === "APPROVED"
                          ? `Approved by ${version.approvedByName ?? "you"} · ${day(version.approvedAt)}`
                          : version.status === "CHANGES"
                            ? "Changes asked for"
                            : "Waiting for your answer"}
                    </span>
                  </div>
                  <div className="bg-white p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/files/${version.token}`}
                      alt={`Proof ${proof.number}: ${version.panels.map((panel) => `${panel.locationLabel}, ${panel.artworkName}`).join("; ")}`}
                      width={version.width ?? undefined}
                      height={version.height ?? undefined}
                      className="mx-auto h-auto max-h-[70vh] w-auto max-w-full"
                      data-testid="pf-picture"
                    />
                  </div>
                  <div className="space-y-1 px-5 py-3 text-sm">
                    {version.panels.map((panel) => (
                      <p key={panel.locationLabel}>
                        <span className="font-medium">{panel.locationLabel}:</span> {panel.artworkName}
                        {panel.inkNote ? ` · ${panel.inkNote}` : ""}
                        {panel.shownOn ? <span className="faint"> · shown on {panel.shownOn}, printed on {proof.colorLabel}</span> : null}
                      </p>
                    ))}
                    <p className="faint text-xs">For {proof.lines.join(", ")}</p>
                    {version.status === "CHANGES" && version.changesNote && (
                      <p className="text-xs" data-testid="pf-changes-note">
                        You asked: {version.changesNote}. We&apos;ll send a new proof.
                      </p>
                    )}
                    {proof.beingUpdated && <p className="text-xs">A new version is on its way.</p>}
                  </div>
                </section>
              );
            })}
            {/* Always mounted, so its thanks or its refusal stays on screen
                after the page refreshes with nothing left waiting. */}
            {(
              <ProofAnswers
                token={token}
                proofs={waiting.map((proof) => ({
                  versionId: proof.version!.id,
                  label: `Proof ${proof.number} · ${proof.productName}${proof.colorLabel ? ` · ${proof.colorLabel}` : ""}`,
                }))}
              />
            )}
          </>
        )}
        <p className="faint text-center text-xs">Questions? Reply to {organization.name} the way they sent you this link.</p>
      </div>
    </div>
  );
}
