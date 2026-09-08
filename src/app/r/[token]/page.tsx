import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { formatCents, formatDate } from "@/lib/format";
import { inviteState, ratesheetState, type InviteState } from "@/lib/ratesheets";
import {
  UNIT_LABELS,
  SOFTWARE_RATE_LABELS,
  SOFTWARE_TERM_NOUNS,
  type UnitOfMeasureValue,
  type SoftwareRateValue,
} from "@/lib/constants";
import { StatusBadge } from "@/components/ui";
import { RespondForm } from "./respond-form";

export const metadata: Metadata = {
  title: "Ratesheet",
  robots: { index: false, follow: false },
};

// Only the columns a partner may see. COGS, SKU, manufacturer, distributor
// and its contacts are the workspace's own business and never leave it;
// keeping the select explicit is what guarantees that.
const productSelect = {
  id: true,
  name: true,
  description: true,
  unitPriceCents: true,
  unitOfMeasure: true,
  softwareRate: true,
  softwareTerm: true,
} as const;

const ratesheetSelect = {
  id: true,
  name: true,
  visibility: true,
  active: true,
  expiresOn: true,
  publicToken: true,
  organization: {
    select: { id: true, name: true, logoUrl: true, primaryColor: true, timeZone: true, status: true },
  },
  // A product switched off in the catalog drops off every live price list.
  items: {
    where: { product: { active: true } },
    orderBy: { position: "asc" as const },
    select: { product: { select: productSelect } },
  },
} as const;

// Public, unauthenticated. One route serves two kinds of link: a partner
// invite (approve / decline) and the sheet's own share link (read-only).
// Both tokens are random, so a lookup miss on one is tried on the other.
export default async function PartnerRatesheetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const now = new Date();

  const invite = await prisma.ratesheetInvite.findUnique({
    where: { token },
    select: {
      id: true,
      token: true,
      partnerName: true,
      status: true,
      sentAt: true,
      respondBy: true,
      respondedAt: true,
      ratesheet: { select: ratesheetSelect },
    },
  });

  const ratesheet = invite
    ? invite.ratesheet
    : await prisma.ratesheet.findUnique({ where: { publicToken: token }, select: ratesheetSelect });
  if (!ratesheet) notFound();

  // A paused or rejected workspace's links go dark with it.
  if (ratesheet.organization.status !== "ACTIVE") notFound();

  const sheetState = ratesheetState(ratesheet, now);
  const state: InviteState | null = invite ? inviteState(invite, ratesheet, now) : null;

  // The sheet's own share link is a public thing only for a Public sheet.
  // Invite/Approve and Partner Specific sheets reach partners through
  // their invite links alone, so on those the share token is just the
  // owner's preview — anyone else gets a 404, not the prices.
  const viaShareLink = !invite;
  const needsOwner = sheetState !== "ACTIVE" || (viaShareLink && ratesheet.visibility !== "PUBLIC");
  let isOwnerPreview = false;
  if (needsOwner) {
    const session = await auth();
    isOwnerPreview = session?.user?.organizationId === ratesheet.organization.id;
  }
  if (viaShareLink && ratesheet.visibility !== "PUBLIC" && !isOwnerPreview) notFound();

  const organization = ratesheet.organization;
  const brand = organization.primaryColor;

  return (
    <div
      className="doc-page relative z-10 px-4 py-10 sm:px-6"
      style={{ ["--brand" as string]: brand }}
    >
      <div className="mx-auto max-w-3xl">
        {isOwnerPreview && (
          <div className="no-print mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs">
            <span className="font-semibold">Owner preview.</span>{" "}
            <span className="muted">
              {sheetState !== "ACTIVE"
                ? `This sheet is ${sheetState.toLowerCase()}, so partners see "no longer available".`
                : "Only you can open this link. Partners use the links on the Partners card."}
            </span>
          </div>
        )}

        <header className="card card-lit mb-5 flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            {organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={organization.logoUrl} alt="" className="h-11 w-11 rounded-lg object-cover" />
            ) : (
              <div
                className="flex h-11 w-11 items-center justify-center rounded-lg text-lg font-bold"
                style={{ background: brand, color: "#fff" }}
              >
                {organization.name.charAt(0)}
              </div>
            )}
            <div>
              <p className="eyebrow">Ratesheet from {organization.name}</p>
              <h1 className="text-xl font-semibold">{ratesheet.name}</h1>
            </div>
          </div>
          <div className="text-right text-xs">
            {state && <StatusBadge status={state} />}
            {ratesheet.expiresOn && (
              <p className="faint mt-1.5">Expires on {formatDate(ratesheet.expiresOn, organization.timeZone)}</p>
            )}
          </div>
        </header>

        {sheetState !== "ACTIVE" && !isOwnerPreview ? (
          <div className="card p-8 text-center">
            <p className="text-sm font-semibold">This ratesheet is no longer available.</p>
            <p className="faint mt-1 text-xs">Ask {organization.name} for a current one.</p>
          </div>
        ) : (
          <>
            <p className="muted mb-4 text-sm">
              {invite
                ? `${organization.name} wants to share this price list with ${invite.partnerName ?? "you"}. Approve it if you'd like to use these items.`
                : `${organization.name} has published this price list.`}
            </p>

            <div className="card card-lit overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-right">Unit price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ratesheet.items.length === 0 && (
                      <tr>
                        <td colSpan={2} className="faint py-8 text-center text-xs">
                          This sheet has no products on it yet.
                        </td>
                      </tr>
                    )}
                    {ratesheet.items.map(({ product }) => {
                      const unit = product.unitOfMeasure
                        ? UNIT_LABELS[product.unitOfMeasure as UnitOfMeasureValue]
                        : null;
                      const rate = product.softwareRate
                        ? SOFTWARE_RATE_LABELS[product.softwareRate as SoftwareRateValue]
                        : null;
                      const term =
                        product.softwareRate && product.softwareTerm
                          ? `${product.softwareTerm} ${SOFTWARE_TERM_NOUNS[product.softwareRate as SoftwareRateValue]}${product.softwareTerm === 1 ? "" : "s"}`
                          : null;
                      return (
                        <tr key={product.id}>
                          <td>
                            <p className="font-medium">{product.name}</p>
                            {product.description && (
                              <p className="faint mt-0.5 text-xs leading-relaxed">{product.description}</p>
                            )}
                          </td>
                          <td className="num text-right font-medium">
                            {formatCents(product.unitPriceCents)}
                            {(unit || rate) && (
                              <p className="faint text-[0.7rem] font-normal">
                                {[unit, rate, term].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {invite && (
              <div className="mt-5">
                {state === "PENDING" ? (
                  <>
                    <RespondForm token={invite.token} senderName={organization.name} />
                    {invite.respondBy && (
                      <p className="faint mt-2 text-center text-xs">
                        Please answer by {formatDate(invite.respondBy, organization.timeZone)}.
                      </p>
                    )}
                  </>
                ) : state === "EXPIRED" ? (
                  <div className="card p-5 text-center">
                    <p className="text-sm font-semibold">This link has expired.</p>
                    <p className="faint mt-1 text-xs">Ask {organization.name} to send it again.</p>
                  </div>
                ) : (
                  <div className="card p-5 text-center">
                    <p className="text-sm font-semibold">
                      {state === "APPROVED" ? "Approved." : "Declined."}
                    </p>
                    <p className="faint mt-1 text-xs">
                      {organization.name} can see your answer in their dashboard
                      {invite.respondedAt && ` (${formatDate(invite.respondedAt, organization.timeZone)})`}.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <p className="faint mt-6 text-center text-xs">
          Questions about these prices? Contact {organization.name} directly.
        </p>
      </div>
    </div>
  );
}
