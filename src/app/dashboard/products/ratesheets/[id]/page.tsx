import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatDate } from "@/lib/format";
import { inviteState, ratesheetState, toDateInput } from "@/lib/ratesheets";
import { Card, CardHeader, BackLink, PageHeader, StatusBadge, Badge } from "@/components/ui";
import { IconTrash, IconExternal, IconPower } from "@/components/icons";
import { PublicLinkField } from "@/components/copy-link";
import { RATESHEET_VISIBILITY_LABELS, type RatesheetVisibilityValue } from "@/lib/constants";
import { RatesheetForm } from "../ratesheet-form";
import { SendInviteForm } from "./send-invite-form";
import { updateRatesheet, deleteRatesheet, toggleRatesheetActive } from "../actions";

export default async function EditRatesheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const { created } = await searchParams;
  const { organizationId } = await requireSession();
  const timeZone = await getTimeZone();
  const now = new Date();

  const [ratesheet, products] = await Promise.all([
    prisma.ratesheet.findFirst({
      where: { id, organizationId },
      include: {
        items: { select: { productId: true }, orderBy: { position: "asc" } },
        invites: { orderBy: { sentAt: "desc" } },
      },
    }),
    prisma.product.findMany({
      where: { organizationId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, name: true, sku: true, unitPriceCents: true, defaultTag: true, active: true },
    }),
  ]);
  if (!ratesheet) notFound();

  const state = ratesheetState(ratesheet, now);
  const sharePath = `/r/${ratesheet.publicToken}`;
  const approved = ratesheet.invites.filter(
    (invite) => inviteState(invite, ratesheet, now) === "APPROVED",
  ).length;

  return (
    <div className="max-w-6xl">
      <BackLink href="/dashboard/products/ratesheets" label="Ratesheets" />
      <PageHeader
        eyebrow={`${RATESHEET_VISIBILITY_LABELS[ratesheet.visibility as RatesheetVisibilityValue]} · created ${formatDate(ratesheet.createdAt, timeZone)}`}
        title={ratesheet.name}
        subtitle={`${approved}/${ratesheet.invites.length} approved / sent`}
        actions={
          <>
            <StatusBadge status={state} />
            <Link
              href={sharePath}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
            >
              <IconExternal size={13} />
              Preview
            </Link>
            <form action={toggleRatesheetActive}>
              <input type="hidden" name="ratesheetId" value={ratesheet.id} />
              <button type="submit" className="btn btn-ghost btn-sm">
                <IconPower size={12} />
                {ratesheet.active ? "Inactive" : "Active"}
              </button>
            </form>
          </>
        }
      />

      {created && (
        <Card className="mb-5 border-[rgb(52_211_153/0.3)] p-4">
          <p className="text-sm font-semibold">Ratesheet created.</p>
          <p className="muted mt-1 text-xs">
            {ratesheet.invites.length > 0
              ? "Nothing is emailed yet — copy the partner link below and text or email it yourself."
              : "Share the link below, or send it to a partner from the Partners card."}
          </p>
        </Card>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card lit>
          <CardHeader
            title="Partners"
            subtitle="Each send gets its own link. Copy it and pass it on — the app doesn't email yet."
          />
          <SendInviteForm ratesheetId={ratesheet.id} disabled={state !== "ACTIVE"} />
          {ratesheet.invites.length > 0 && (
            <ul className="divide-y divide-[rgb(255_255_255/0.045)] border-t border-[var(--border)]">
              {ratesheet.invites.map((invite) => {
                const inviteStatus = inviteState(invite, ratesheet, now);
                return (
                  <li key={invite.id} className="space-y-2 px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {invite.partnerName ?? invite.partnerEmail}
                        </p>
                        {invite.partnerName && (
                          <p className="faint truncate text-xs">{invite.partnerEmail}</p>
                        )}
                        <p className="faint mt-0.5 text-xs">
                          Sent {formatDate(invite.sentAt, timeZone)}
                          {invite.respondBy && inviteStatus === "PENDING" && ` · respond by ${formatDate(invite.respondBy, timeZone)}`}
                          {invite.respondedAt && ` · answered ${formatDate(invite.respondedAt, timeZone)}`}
                        </p>
                      </div>
                      <StatusBadge status={inviteStatus} />
                    </div>
                    {inviteStatus === "PENDING" && <PublicLinkField path={`/r/${invite.token}`} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card lit>
          <CardHeader
            title={ratesheet.visibility === "PUBLIC" ? "Share link" : "Who can see it"}
            subtitle={
              ratesheet.visibility === "PUBLIC"
                ? "A read-only view of this sheet — no approve or decline buttons."
                : "Only partners you send it to. The Preview button above is just for you."
            }
          />
          <div className="space-y-2 p-5">
            {ratesheet.visibility === "PUBLIC" ? (
              <>
                <PublicLinkField path={sharePath} />
                <p className="faint text-xs">
                  {state === "ACTIVE"
                    ? "Anyone with the link can open it until the sheet expires or is made inactive."
                    : "The sheet is inactive or expired, so only you can open this link right now."}
                </p>
              </>
            ) : (
              <p className="muted text-xs">
                Each partner gets their own link from the Partners card, and answers it there.
                Switch the sheet to Public if you want one link anyone can open.
              </p>
            )}
            <Badge color="#38bdf8">{ratesheet.items.length} products</Badge>
          </div>
        </Card>
      </div>

      <RatesheetForm
        action={updateRatesheet}
        products={products}
        submitLabel="Save changes"
        defaults={{
          id: ratesheet.id,
          name: ratesheet.name,
          visibility: ratesheet.visibility,
          expiresOn: toDateInput(ratesheet.expiresOn),
          respondWithinDays: ratesheet.respondWithinDays,
          productIds: ratesheet.items.map((item) => item.productId),
        }}
      />

      <Card className="mt-5 border-[rgb(251_113_133/0.25)]">
        <CardHeader
          title="Danger zone"
          subtitle="Deleting a ratesheet stops every partner link for it. Products are untouched."
        />
        <form action={deleteRatesheet} className="p-5">
          <input type="hidden" name="ratesheetId" value={ratesheet.id} />
          <button type="submit" className="btn btn-danger btn-sm">
            <IconTrash size={13} />
            Delete ratesheet
          </button>
        </form>
      </Card>
    </div>
  );
}
