import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatDate, formatDay } from "@/lib/format";
import { inviteState, ratesheetState, formatBytes } from "@/lib/ratesheets";
import { PageHeader } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { ProductsSubnav } from "../products-subnav";
import { LinkRatesheetButton } from "../link-ratesheet-button";
import { RatesheetsBoard, type BoardSheet, type BoardInvite, type BoardFile } from "./ratesheets-board";
import { uploadLinkedRatesheet } from "./actions";
import { loadRatesheetSuppliers } from "../lookups";
import { priceListFileKind } from "@/lib/price-list-file";

export default async function RatesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ uploaded?: string }>;
}) {
  const { organizationId } = await requireSession();
  const { uploaded } = await searchParams;
  const timeZone = await getTimeZone();
  const now = new Date();

  // Invites are loaded whole rather than counted in SQL so the counts and
  // the per-row state (which depends on the sheet's expiry and the
  // invite's own window) can't disagree. Same "every row" trade-off as the
  // other list pages; revisit with pagination.
  const [organization, ratesheets, invites, files, suppliers] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    }),
    prisma.ratesheet.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { items: true } } },
    }),
    prisma.ratesheetInvite.findMany({
      where: { organizationId },
      orderBy: { sentAt: "desc" },
      include: { ratesheet: { select: { id: true, name: true, active: true, expiresOn: true } } },
    }),
    prisma.linkedRatesheet.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { distributor: { select: { name: true } } },
    }),
    loadRatesheetSuppliers(organizationId),
  ]);

  const perSheet = new Map<string, { approved: number; sent: number }>();
  const boardInvites: BoardInvite[] = invites.map((invite) => {
    const state = inviteState(invite, invite.ratesheet, now);
    const tally = perSheet.get(invite.ratesheetId) ?? { approved: 0, sent: 0 };
    tally.sent += 1;
    if (state === "APPROVED") tally.approved += 1;
    perSheet.set(invite.ratesheetId, tally);
    return {
      id: invite.id,
      ratesheetId: invite.ratesheetId,
      ratesheetName: invite.ratesheet.name,
      partnerLabel: invite.partnerName ?? invite.partnerEmail,
      partnerEmail: invite.partnerEmail,
      state,
      sentAt: formatDate(invite.sentAt, timeZone),
      respondBy: invite.respondBy ? formatDate(invite.respondBy, timeZone) : null,
      path: `/r/${invite.token}`,
    };
  });

  const boardSheets: BoardSheet[] = ratesheets.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    visibility: sheet.visibility,
    active: sheet.active,
    state: ratesheetState(sheet, now),
    createdAt: formatDate(sheet.createdAt, timeZone),
    expiresOn: sheet.expiresOn ? formatDate(sheet.expiresOn, timeZone) : null,
    itemCount: sheet._count.items,
    approved: perSheet.get(sheet.id)?.approved ?? 0,
    sent: perSheet.get(sheet.id)?.sent ?? 0,
  }));

  const boardFiles: BoardFile[] = files.map((file) => ({
    id: file.id,
    name: file.name,
    fileName: file.fileName,
    size: formatBytes(file.sizeBytes),
    uploadedAt: formatDate(file.createdAt, timeZone),
    highlighted: file.id === uploaded,
    supplierId: file.distributorId,
    supplierName: file.distributor?.name ?? null,
    effectiveOn: file.effectiveOn ? formatDay(file.effectiveOn) : null,
    importSummary: file.importedAt
      ? `imported ${formatDate(file.importedAt, timeZone)}: ${file.addedCount ?? 0} new, ${file.updatedCount ?? 0} updated` +
        ((file.costUpCount ?? 0) || (file.costDownCount ?? 0)
          ? ` (${[file.costUpCount ? `${file.costUpCount} cost more` : "", file.costDownCount ? `${file.costDownCount} cost less` : ""].filter(Boolean).join(", ")})`
          : "")
      : null,
    importable: priceListFileKind(file.fileName) !== null,
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Ratesheets"
        subtitle="Price lists you publish to partners, and the ones you've linked in."
        actions={
          <>
            <LinkRatesheetButton uploadAction={uploadLinkedRatesheet} suppliers={suppliers} />
            <Link href="/dashboard/products/ratesheets/new" className="btn btn-neon btn-sm">
              <IconPlus size={14} />
              Create Ratesheet
            </Link>
          </>
        }
      />

      <ProductsSubnav current="ratesheets" />

      <RatesheetsBoard
        organizationName={organization.name}
        suppliers={suppliers}
        sheets={boardSheets}
        invites={boardInvites}
        files={boardFiles}
      />
    </div>
  );
}
