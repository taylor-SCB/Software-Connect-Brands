import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { publicToken } from "@/lib/tokens";
import { lockQuote } from "@/lib/quote-payments";
import { readSnapshot } from "@/lib/variation-shared";
import { checkArtwork, sweepUnusedArtwork } from "@/lib/artwork";
import { syncProofEvents, type ProofAnswerState } from "@/lib/calendar-auto";
import { formatDay } from "@/lib/format";
import {
  deleteObject,
  proofBase,
  readUploadTicket,
  statObject,
  storageDriver,
  streamStoredFile,
  uploadTicket,
  type StorageDriver,
  type UploadTicket,
} from "@/lib/storage";
import {
  BASE_KINDS,
  HEX_COLOR,
  MAX_PANELS,
  MAX_PROOFS_PER_QUOTE,
  MAX_VERSIONS,
  PROOF_MAX_BYTES,
  PROOF_TYPES,
  cleanPlacement,
  type BaseKind,
  type Placement,
  type ProofStatusValue,
} from "@/lib/proof-shared";

// The apparel pack (Nov 12, 2026). A proof is one design on one garment
// colour on one quote, shown as a panel per print location; the customer
// answers a version of it on /pf/<token>. Lines are joined to a proof
// (QuoteLineItem.proofId) and count only while their product and Color
// still match the proof's: every reader checks that, so a line changed by
// older code, or edited since, never shows another garment's proof.
//
// A version's picture is drawn in the proof sheet (the artwork exactly as
// uploaded, on the product's picture or a plain garment in the colour) and
// sent straight to the private store with tickets signed here. A DRAFT is
// edited in place with new files and a new token; once sent a version never
// changes, and editing it makes the next version. Sending replaces every
// older version (SUPERSEDED), so only one version of a proof can ever be
// answered.

const STORAGE_OFF = "Picture storage isn't switched on for this site yet.";
const OFF = "Apparel is switched off for this workspace. An owner or admin can turn it on in Settings → General.";
const ROLES = ["display", "thumb", "doc"] as const;
type Role = (typeof ROLES)[number];

class Refusal extends Error {}

/* -------------------------------- Keys ----------------------------------- */

export async function colorGroupIdOf(organizationId: string) {
  const group = await prisma.variationGroup.findFirst({
    where: { organizationId, kind: "COLOR" },
    select: { id: true },
  });
  return group?.id ?? null;
}

export function lineColorOf(variations: unknown, colorGroupId: string | null) {
  if (!colorGroupId) return null;
  return readSnapshot(variations).find((entry) => entry.groupId === colorGroupId)?.optionId ?? null;
}

type KeyedLine = { productId: string | null; variations: unknown };
type KeyedProof = { productId: string | null; colorOptionId: string | null };

export function keyMatches(line: KeyedLine, proof: KeyedProof, colorGroupId: string | null) {
  return (
    Boolean(line.productId) &&
    line.productId === proof.productId &&
    lineColorOf(line.variations, colorGroupId) === proof.colorOptionId
  );
}

/* -------------------------------- Reads ---------------------------------- */

export type PanelView = {
  position: number;
  locationOptionId: string | null;
  locationLabel: string;
  artworkId: string | null;
  artworkName: string;
  inkNote: string | null;
  hasPrintFile: boolean;
  baseKind: BaseKind;
  baseImageId: string | null;
  baseImageToken: string | null;
  baseColor: string | null;
  shownOn: string | null;
  placement: Placement;
};

export type VersionView = {
  id: string;
  version: number;
  status: ProofStatusValue;
  token: string;
  width: number | null;
  height: number | null;
  copiedFrom: string | null;
  sentAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvedOffline: boolean;
  changesByName: string | null;
  changesNote: string | null;
  changesAt: string | null;
  panels: PanelView[];
};

export type ProofView = {
  id: string;
  number: number;
  productId: string | null;
  productName: string;
  colorOptionId: string | null;
  colorLabel: string | null;
  lineIds: string[];
  // Newest first.
  versions: VersionView[];
};

const PANEL_SELECT = {
  position: true,
  locationOptionId: true,
  locationLabel: true,
  artworkId: true,
  artworkName: true,
  inkNote: true,
  baseKind: true,
  baseImageId: true,
  baseColor: true,
  shownOn: true,
  placement: true,
  artwork: { select: { printKey: true } },
  baseImage: { select: { publicToken: true } },
} as const;

const VERSION_SELECT = {
  id: true,
  version: true,
  status: true,
  publicToken: true,
  width: true,
  height: true,
  copiedFrom: true,
  sentAt: true,
  approvedByName: true,
  approvedAt: true,
  approvedOffline: true,
  changesByName: true,
  changesNote: true,
  changesAt: true,
  panels: { orderBy: { position: "asc" as const }, select: PANEL_SELECT },
} as const;

type VersionRow = Prisma.ProofVersionGetPayload<{ select: typeof VERSION_SELECT }>;

function versionView(row: VersionRow): VersionView {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: row.id,
    version: row.version,
    status: row.status as ProofStatusValue,
    token: row.publicToken,
    width: row.width,
    height: row.height,
    copiedFrom: row.copiedFrom,
    sentAt: iso(row.sentAt),
    approvedByName: row.approvedByName,
    approvedAt: iso(row.approvedAt),
    approvedOffline: row.approvedOffline,
    changesByName: row.changesByName,
    changesNote: row.changesNote,
    changesAt: iso(row.changesAt),
    panels: row.panels.map((panel) => ({
      position: panel.position,
      locationOptionId: panel.locationOptionId,
      locationLabel: panel.locationLabel,
      artworkId: panel.artworkId,
      artworkName: panel.artworkName,
      inkNote: panel.inkNote,
      hasPrintFile: Boolean(panel.artwork?.printKey),
      baseKind: (BASE_KINDS as readonly string[]).includes(panel.baseKind) ? (panel.baseKind as BaseKind) : "plain-front",
      baseImageId: panel.baseImageId,
      baseImageToken: panel.baseImage?.publicToken ?? null,
      baseColor: panel.baseColor,
      shownOn: panel.shownOn,
      placement: cleanPlacement(panel.placement) ?? { x: 0.35, y: 0.3, w: 0.3, h: 0.3 },
    })),
  };
}

// Every proof on a quote with every version, and the lines that count.
export async function quoteProofs(organizationId: string, quoteId: string): Promise<ProofView[]> {
  const [proofs, lines, colorGroupId] = await Promise.all([
    prisma.proof.findMany({
      where: { organizationId, quoteId },
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        productId: true,
        productName: true,
        colorOptionId: true,
        colorLabel: true,
        versions: { orderBy: { version: "desc" }, select: VERSION_SELECT },
      },
    }),
    prisma.quoteLineItem.findMany({
      where: { quoteId, proofId: { not: null } },
      orderBy: { position: "asc" },
      select: { id: true, productId: true, variations: true, proofId: true },
    }),
    colorGroupIdOf(organizationId),
  ]);
  return proofs.map((proof) => ({
    id: proof.id,
    number: proof.number,
    productId: proof.productId,
    productName: proof.productName,
    colorOptionId: proof.colorOptionId,
    colorLabel: proof.colorLabel,
    lineIds: lines.filter((line) => line.proofId === proof.id && keyMatches(line, proof, colorGroupId)).map((line) => line.id),
    versions: proof.versions.map(versionView),
  }));
}

// The version a customer or a document sees: sent and not replaced.
export function answerableVersion(proof: ProofView) {
  return proof.versions.find((version) => version.status !== "DRAFT" && version.status !== "SUPERSEDED") ?? null;
}

// Each line's proof picture for the customer's copy: the answerable
// version of a proof the line still matches. Drafts never print.
export async function lineProofPictures(organizationId: string, quoteId: string) {
  const proofs = await quoteProofs(organizationId, quoteId);
  const out = new Map<string, { token: string; status: ProofStatusValue; number: number }>();
  for (const proof of proofs) {
    const version = answerableVersion(proof);
    if (!version) continue;
    for (const lineId of proof.lineIds) out.set(lineId, { token: version.token, status: version.status, number: proof.number });
  }
  return out;
}

// The calendar follows the answerable version of every proof still on a line.
export async function refreshProofEvents(organizationId: string, quoteId: string) {
  const proofs = await quoteProofs(organizationId, quoteId);
  const states: ProofAnswerState[] = [];
  for (const proof of proofs) {
    const version = answerableVersion(proof);
    if (!version || !proof.lineIds.length) continue;
    states.push({
      number: proof.number,
      status: version.status as ProofAnswerState["status"],
      approvedAt: version.approvedAt ? new Date(version.approvedAt) : null,
      changesAt: version.changesAt ? new Date(version.changesAt) : null,
      changesByName: version.changesByName,
      changesNote: version.changesNote,
    });
  }
  await syncProofEvents(organizationId, quoteId, states);
}

/* ------------------------------- Uploads --------------------------------- */

export type StartedProof =
  | { error: string }
  | { driver: StorageDriver; files: { role: Role; key: string; type: string; ticket: string }[] };

async function apparelAllowed(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { apparelOn: true } });
  return Boolean(org?.apparelOn);
}

export async function startProofVersion(
  organizationId: string,
  userId: string,
  input: { quoteId: string; type: string },
): Promise<StartedProof> {
  const driver = storageDriver();
  if (!driver) return { error: STORAGE_OFF };
  if (!(await apparelAllowed(organizationId))) return { error: OFF };
  if (!(PROOF_TYPES as readonly string[]).includes(input.type)) return { error: "That proof couldn't be drawn." };
  const quote = await prisma.quote.findFirst({ where: { id: input.quoteId, organizationId }, select: { id: true } });
  if (!quote) return { error: "This quote is gone. Reload the page." };
  const base = proofBase(organizationId, quote.id);
  const ext = input.type === "image/webp" ? "webp" : "jpg";
  const plan: { role: Role; key: string; type: string }[] = [
    { role: "display", key: `${base}.${ext}`, type: input.type },
    { role: "thumb", key: `${base}-thumb.${ext}`, type: input.type },
    { role: "doc", key: `${base}-doc.jpg`, type: "image/jpeg" },
  ];
  return {
    driver,
    files: plan.map((file) => ({
      ...file,
      ticket: uploadTicket({
        organizationId,
        purpose: "proof",
        quoteId: quote.id,
        role: file.role,
        key: file.key,
        type: file.type,
        maxBytes: PROOF_MAX_BYTES[file.role],
        userId,
      }),
    })),
  };
}

function readTickets(raw: unknown[], organizationId: string, quoteId: string) {
  if (raw.length !== 3) return null;
  const tickets = raw.map((item) => readUploadTicket(item));
  for (let i = 0; i < 3; i += 1) {
    const ticket = tickets[i];
    if (
      !ticket ||
      ticket.purpose !== "proof" ||
      ticket.quoteId !== quoteId ||
      ticket.organizationId !== organizationId ||
      ticket.role !== ROLES[i]
    ) {
      return null;
    }
  }
  const [display, thumb, doc] = tickets as UploadTicket[];
  const base = display.key.replace(/\.(webp|jpg)$/, "");
  const ext = display.key.slice(base.length);
  if (
    base === display.key ||
    !base.startsWith(`org/${organizationId}/proofs/${quoteId}/`) ||
    thumb.key !== `${base}-thumb${ext}` ||
    doc.key !== `${base}-doc.jpg` ||
    thumb.type !== display.type
  ) {
    return null;
  }
  return { display, thumb, doc };
}

type FileKeys = { displayKey: string; thumbKey: string; docKey: string };

// Files go only once no version holds them: a proof brought over from an
// earlier order shares the original's.
async function deleteUnheldFiles(driver: StorageDriver | string | null, rows: FileKeys[]) {
  for (const row of rows) {
    const held = await prisma.proofVersion.count({ where: { displayKey: row.displayKey } });
    if (held) continue;
    await deleteObject(driver, row.displayKey);
    await deleteObject(driver, row.thumbKey);
    await deleteObject(driver, row.docKey);
  }
}

export type PanelInput = {
  locationOptionId: string;
  artworkId: string;
  baseKind: BaseKind;
  baseImageId?: string | null;
  baseColor?: string | null;
  placement: unknown;
};

export type FinishProofInput = {
  quoteId: string;
  // Null for a new proof.
  proofId: string | null;
  // The newest version the sheet was opened on, so a second tab's save in
  // between is never written over.
  baseVersionId: string | null;
  productId: string;
  colorOptionId: string | null;
  lineIds: string[];
  panels: PanelInput[];
  tickets: unknown[];
  width?: number;
  height?: number;
};

// What the panels may hold, checked against this workspace. Artwork or a
// base picture since removed is allowed only when this proof already used it.
async function checkPanels(
  organizationId: string,
  input: FinishProofInput,
  colorLabel: string | null,
): Promise<{ error: string } | { panels: Omit<Prisma.ProofPanelCreateManyInput, "versionId">[] }> {
  if (!Array.isArray(input.panels) || input.panels.length < 1) return { error: "Add at least one print location." };
  if (input.panels.length > MAX_PANELS) return { error: `Up to ${MAX_PANELS} print locations on one proof.` };
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { printLocationGroupId: true } });
  if (!org?.printLocationGroupId) return { error: OFF };

  const locationIds = input.panels.map((panel) => String(panel.locationOptionId ?? ""));
  if (new Set(locationIds).size !== locationIds.length) return { error: "Each print location once per proof." };
  const artworkIds = [...new Set(input.panels.map((panel) => String(panel.artworkId ?? "")))];
  const imageIds = [...new Set(input.panels.flatMap((panel) => (panel.baseImageId ? [String(panel.baseImageId)] : [])))];

  const used = input.proofId
    ? await prisma.proofPanel.findMany({
        where: { version: { proofId: input.proofId, organizationId } },
        select: { artworkId: true, baseImageId: true },
      })
    : [];
  const usedArtwork = new Set(used.flatMap((row) => (row.artworkId ? [row.artworkId] : [])));
  const usedImages = new Set(used.flatMap((row) => (row.baseImageId ? [row.baseImageId] : [])));

  const [locations, artworks, images] = await Promise.all([
    prisma.variationOption.findMany({
      where: { id: { in: locationIds }, organizationId, groupId: org.printLocationGroupId },
      select: { id: true, name: true },
    }),
    prisma.artwork.findMany({
      where: { id: { in: artworkIds }, organizationId },
      select: { id: true, name: true, inkNote: true, removedAt: true },
    }),
    imageIds.length
      ? prisma.productImage.findMany({
          where: { id: { in: imageIds }, organizationId, productId: input.productId },
          select: { id: true, position: true, colorOptionId: true, colorOption: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const locationById = new Map(locations.map((row) => [row.id, row]));
  const artworkById = new Map(artworks.map((row) => [row.id, row]));
  const imageById = new Map(images.map((row) => [row.id, row]));

  const panels: Omit<Prisma.ProofPanelCreateManyInput, "versionId">[] = [];
  for (const [position, panel] of input.panels.entries()) {
    const location = locationById.get(String(panel.locationOptionId));
    if (!location) return { error: "Pick a print location from the list." };
    const artwork = artworkById.get(String(panel.artworkId));
    if (!artwork) return { error: "That artwork is gone. Pick another." };
    if (artwork.removedAt && !usedArtwork.has(artwork.id)) return { error: `“${artwork.name}” was removed. Pick another.` };
    const kind = String(panel.baseKind) as BaseKind;
    if (!BASE_KINDS.includes(kind)) return { error: "Pick what to draw it on." };
    const placement = cleanPlacement(panel.placement);
    if (!placement) return { error: "Place the artwork on the picture." };
    let baseImageId: string | null = null;
    let baseColor: string | null = null;
    let shownOn: string | null = null;
    if (kind === "picture") {
      const image = panel.baseImageId ? imageById.get(String(panel.baseImageId)) : undefined;
      if (!image || (image.position === null && !usedImages.has(image.id))) {
        return { error: "That product picture is gone. Pick another." };
      }
      baseImageId = image.id;
      // A picture of another colour is captioned, never passed off as this one.
      if (input.colorOptionId && image.colorOptionId !== input.colorOptionId) {
        shownOn = image.colorOption?.name ?? "another colour";
      }
    } else {
      baseColor = typeof panel.baseColor === "string" && HEX_COLOR.test(panel.baseColor) ? panel.baseColor.toLowerCase() : null;
      if (!baseColor) return { error: "Pick the garment's colour." };
    }
    panels.push({
      position,
      locationOptionId: location.id,
      locationLabel: location.name,
      artworkId: artwork.id,
      artworkName: artwork.name,
      inkNote: artwork.inkNote,
      baseKind: kind,
      baseImageId,
      baseColor,
      shownOn: colorLabel ? shownOn : null,
      placement,
    });
  }
  return { panels };
}

// Step two: the picture arrived; write the version, its panels and which
// lines it covers, in one short transaction under the quote's lock. A
// retry after a dropped answer finds its own row and writes nothing.
export async function finishProofVersion(
  organizationId: string,
  userId: string,
  input: FinishProofInput,
): Promise<{ ok: true; proofId: string; versionId: string } | { error: string }> {
  const tickets = readTickets(Array.isArray(input.tickets) ? input.tickets : [], organizationId, input.quoteId);
  if (!tickets) return { error: "This proof took too long and expired. Save it again." };
  const driver = storageDriver();
  if (!driver) return { error: STORAGE_OFF };
  const files = { displayKey: tickets.display.key, thumbKey: tickets.thumb.key, docKey: tickets.doc.key };

  const already = await prisma.proofVersion.findFirst({
    where: { organizationId, displayKey: files.displayKey },
    select: { id: true, proofId: true },
  });
  if (already) return { ok: true, proofId: already.proofId, versionId: already.id };

  const sizes = await Promise.all(ROLES.map((role) => statObject(driver, tickets[role].key)));
  if (sizes.some((size) => !size)) return { error: "The proof didn't arrive. Save it again." };
  const refuse = async (error: string) => {
    await deleteUnheldFiles(driver, [files]);
    return { error };
  };
  if (!(await apparelAllowed(organizationId))) return refuse(OFF);

  const [quote, product, colorGroupId] = await Promise.all([
    prisma.quote.findFirst({ where: { id: input.quoteId, organizationId }, select: { id: true } }),
    prisma.product.findFirst({ where: { id: String(input.productId ?? ""), organizationId }, select: { id: true, name: true } }),
    colorGroupIdOf(organizationId),
  ]);
  if (!quote) return refuse("This quote is gone. Reload the page.");
  if (!product) return refuse("This product is gone. Reload the page.");
  let colorLabel: string | null = null;
  if (input.colorOptionId) {
    const color = await prisma.variationOption.findFirst({
      where: { id: input.colorOptionId, organizationId, groupId: colorGroupId ?? "" },
      select: { name: true },
    });
    if (!color) return refuse("That color is gone. Reload the page.");
    colorLabel = color.name;
  }
  const key = { productId: product.id, colorOptionId: input.colorOptionId ?? null };

  const lineIds = [...new Set((Array.isArray(input.lineIds) ? input.lineIds : []).map(String))].slice(0, 200);
  if (!lineIds.length) return refuse("Tick at least one line this proof is for.");
  const lines = await prisma.quoteLineItem.findMany({
    where: { id: { in: lineIds }, quoteId: quote.id },
    select: { id: true, productId: true, variations: true },
  });
  if (lines.length !== lineIds.length || lines.some((line) => !keyMatches(line, key, colorGroupId))) {
    return refuse("Those lines changed. Save the quote and open the proof again.");
  }

  const checked = await checkPanels(organizationId, input, colorLabel);
  if ("error" in checked) return refuse(checked.error);

  const width = Number.isInteger(input.width) && input.width! > 0 && input.width! < 100_000 ? input.width! : null;
  const height = Number.isInteger(input.height) && input.height! > 0 && input.height! < 100_000 ? input.height! : null;
  const versionData = {
    ...files,
    contentType: tickets.display.type,
    sizeBytes: sizes[0]!.size,
    width,
    height,
    publicToken: publicToken(),
  };

  let replaced: FileKeys | null = null;
  let result: { proofId: string; versionId: string };
  try {
    result = await prisma.$transaction(
      async (tx) => {
        await lockQuote(tx, quote.id);
        let proofId: string;
        let versionId: string;
        if (input.proofId) {
          const proof = await tx.proof.findFirst({
            where: { id: input.proofId, organizationId, quoteId: quote.id },
            select: {
              id: true,
              productId: true,
              colorOptionId: true,
              versions: {
                orderBy: { version: "desc" },
                take: 1,
                select: { id: true, version: true, status: true, displayKey: true, thumbKey: true, docKey: true },
              },
            },
          });
          if (!proof) throw new Refusal("This proof is gone. Reload the page.");
          if (proof.productId !== key.productId || proof.colorOptionId !== key.colorOptionId) {
            throw new Refusal("This proof is for another product or color. Make a new proof.");
          }
          const newest = proof.versions[0];
          if ((newest?.id ?? null) !== (input.baseVersionId ?? null)) {
            throw new Refusal("Someone else just changed this proof. Close it and open it again.");
          }
          proofId = proof.id;
          if (newest && newest.status === "DRAFT") {
            replaced = { displayKey: newest.displayKey, thumbKey: newest.thumbKey, docKey: newest.docKey };
            await tx.proofVersion.update({ where: { id: newest.id }, data: { ...versionData, createdById: userId, copiedFrom: null } });
            await tx.proofPanel.deleteMany({ where: { versionId: newest.id } });
            versionId = newest.id;
          } else {
            if ((newest?.version ?? 0) >= MAX_VERSIONS) {
              throw new Refusal(`${MAX_VERSIONS} versions is the most one proof keeps. Make a new proof.`);
            }
            const made = await tx.proofVersion.create({
              data: { organizationId, proofId, version: (newest?.version ?? 0) + 1, ...versionData, createdById: userId },
              select: { id: true },
            });
            versionId = made.id;
          }
        } else {
          const count = await tx.proof.count({ where: { quoteId: quote.id } });
          if (count >= MAX_PROOFS_PER_QUOTE) throw new Refusal(`${MAX_PROOFS_PER_QUOTE} proofs is the most one quote holds.`);
          const last = await tx.proof.aggregate({ where: { quoteId: quote.id }, _max: { number: true } });
          const made = await tx.proof.create({
            data: {
              organizationId,
              quoteId: quote.id,
              number: (last._max.number ?? 0) + 1,
              productId: key.productId,
              colorOptionId: key.colorOptionId,
              productName: product.name,
              colorLabel,
              createdById: userId,
            },
            select: { id: true },
          });
          proofId = made.id;
          const version = await tx.proofVersion.create({
            data: { organizationId, proofId, version: 1, ...versionData, createdById: userId },
            select: { id: true },
          });
          versionId = version.id;
        }
        await tx.proofPanel.createMany({ data: checked.panels.map((panel) => ({ ...panel, versionId })) });
        await tx.quoteLineItem.updateMany({
          where: { quoteId: quote.id, proofId, id: { notIn: lineIds } },
          data: { proofId: null },
        });
        await tx.quoteLineItem.updateMany({ where: { quoteId: quote.id, id: { in: lineIds } }, data: { proofId } });
        return { proofId, versionId };
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof Refusal) return refuse(error.message);
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2025")) {
      return refuse("Something on this proof was just removed. Reload and try again.");
    }
    throw error;
  }
  if (replaced) await deleteUnheldFiles(driver, [replaced]);
  return { ok: true, ...result };
}

/* ------------------------------- Changes --------------------------------- */

// Throws a draft away: the version, and the proof when it was its only one.
export async function discardDraft(organizationId: string, versionId: string) {
  const version = await prisma.proofVersion.findFirst({
    where: { id: versionId, organizationId, status: "DRAFT" },
    select: { id: true, proofId: true, displayKey: true, thumbKey: true, docKey: true, proof: { select: { quoteId: true } } },
  });
  if (!version) return { error: "That draft was already sent or removed. Reload the page." };
  const quoteId = version.proof.quoteId;
  await prisma.$transaction(async (tx) => {
    if (quoteId) await lockQuote(tx, quoteId);
    await tx.proofVersion.deleteMany({ where: { id: version.id, status: "DRAFT" } });
    const left = await tx.proofVersion.count({ where: { proofId: version.proofId } });
    if (!left) await tx.proof.deleteMany({ where: { id: version.proofId } });
  });
  await deleteUnheldFiles(storageDriver(), [version]);
  return { ok: true as const, quoteId };
}

// Puts a line on a proof of the same product and Color (a size added after
// the proof was approved), or takes it off. The proof's picture and answer
// are untouched: what the customer approved didn't change.
export async function setLineProof(organizationId: string, lineId: string, proofId: string | null) {
  const line = await prisma.quoteLineItem.findFirst({
    where: { id: lineId, quote: { organizationId } },
    select: { id: true, quoteId: true, productId: true, variations: true },
  });
  if (!line) return { error: "That line is gone. Save the quote and try again." };
  if (proofId) {
    const [proof, colorGroupId] = await Promise.all([
      prisma.proof.findFirst({ where: { id: proofId, organizationId, quoteId: line.quoteId }, select: { productId: true, colorOptionId: true } }),
      colorGroupIdOf(organizationId),
    ]);
    if (!proof) return { error: "That proof is gone. Reload the page." };
    if (!keyMatches(line, proof, colorGroupId)) return { error: "That proof is for another product or color." };
  }
  await prisma.quoteLineItem.update({ where: { id: line.id }, data: { proofId } });
  return { ok: true as const, quoteId: line.quoteId };
}

// After the quote's lines are saved (outside its transaction): a line whose
// product or Color no longer matches its proof lets go of it. A line that is
// new or changed, has a Color, and matches exactly one proof joins it, but
// only when every other line of that product and Color on a proof is on that
// same one: coach tees and player tees of one Navy blank are two proofs, and
// a new size is left for a person to pick.
export async function syncLineProofs(organizationId: string, quoteId: string, touchedLineIds: string[]) {
  const [proofs, lines, colorGroupId] = await Promise.all([
    prisma.proof.findMany({ where: { organizationId, quoteId }, select: { id: true, productId: true, colorOptionId: true } }),
    prisma.quoteLineItem.findMany({
      where: { quoteId },
      select: { id: true, productId: true, variations: true, proofId: true },
    }),
    colorGroupIdOf(organizationId),
  ]);
  if (!proofs.length) return;
  const byId = new Map(proofs.map((proof) => [proof.id, proof]));
  const valid = (line: (typeof lines)[number]) => {
    const proof = line.proofId ? byId.get(line.proofId) : undefined;
    return Boolean(proof && keyMatches(line, proof, colorGroupId));
  };
  const drop: string[] = [];
  const join = new Map<string, string[]>();
  const touched = new Set(touchedLineIds);
  for (const line of lines) {
    if (valid(line)) continue;
    if (line.proofId) drop.push(line.id);
    if (!touched.has(line.id) || !line.productId || !lineColorOf(line.variations, colorGroupId)) continue;
    const matches = proofs.filter((proof) => keyMatches(line, proof, colorGroupId));
    if (matches.length !== 1) continue;
    const siblings = lines.filter(
      (other) => other.id !== line.id && valid(other) && keyMatches(other, matches[0], colorGroupId),
    );
    if (siblings.some((other) => other.proofId !== matches[0].id)) continue;
    join.set(matches[0].id, [...(join.get(matches[0].id) ?? []), line.id]);
  }
  const joined = new Set([...join.values()].flat());
  const release = drop.filter((id) => !joined.has(id));
  if (release.length) await prisma.quoteLineItem.updateMany({ where: { quoteId, id: { in: release } }, data: { proofId: null } });
  for (const [proofId, ids] of join) {
    await prisma.quoteLineItem.updateMany({ where: { quoteId, id: { in: ids } }, data: { proofId } });
  }
}

/* -------------------------- From an earlier order -------------------------- */

// Approved proofs of the same product and Color on this customer's other
// quotes: a school's re-order next season.
export async function earlierProofs(organizationId: string, quoteId: string, productId: string, colorOptionId: string | null) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, organizationId },
    select: { contactId: true, contact: { select: { companyId: true } } },
  });
  if (!quote) return [];
  const customer = quote.contact.companyId
    ? { contact: { companyId: quote.contact.companyId } }
    : { contactId: quote.contactId };
  const rows = await prisma.proofVersion.findMany({
    where: {
      organizationId,
      status: "APPROVED",
      proof: { productId, colorOptionId, quoteId: { not: quoteId }, quote: customer },
    },
    orderBy: { approvedAt: "desc" },
    take: 12,
    select: {
      id: true,
      publicToken: true,
      approvedByName: true,
      approvedAt: true,
      proof: { select: { number: true, quote: { select: { number: true } } } },
      panels: { orderBy: { position: "asc" }, select: { locationLabel: true, artworkName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    token: row.publicToken,
    label: `QUO-${row.proof.quote?.number ?? "?"} · Proof ${row.proof.number}`,
    approved: `${row.approvedByName ?? "Approved"}${row.approvedAt ? ` · ${formatDay(row.approvedAt)}` : ""}`,
    panels: row.panels.map((panel) => `${panel.locationLabel}: ${panel.artworkName}`),
  }));
}

// Brings an approved proof from an earlier order onto this quote as a new
// proof, picture and placements and all (the files are shared, not copied).
// It starts as a draft: this order still needs its own answer, which can be
// sent or marked approved by hand.
export async function copyEarlierProof(
  organizationId: string,
  userId: string,
  input: { quoteId: string; sourceVersionId: string; lineIds: string[] },
) {
  if (!(await apparelAllowed(organizationId))) return { error: OFF };
  const source = await prisma.proofVersion.findFirst({
    where: { id: input.sourceVersionId, organizationId, status: "APPROVED" },
    select: {
      displayKey: true,
      thumbKey: true,
      docKey: true,
      contentType: true,
      sizeBytes: true,
      width: true,
      height: true,
      approvedByName: true,
      approvedAt: true,
      proof: {
        select: { productId: true, colorOptionId: true, productName: true, colorLabel: true, number: true, quote: { select: { number: true } } },
      },
      panels: { orderBy: { position: "asc" } },
    },
  });
  if (!source) return { error: "That proof is gone. Reload the page." };
  const colorGroupId = await colorGroupIdOf(organizationId);
  const lineIds = [...new Set(input.lineIds.map(String))].slice(0, 200);
  const lines = await prisma.quoteLineItem.findMany({
    where: { id: { in: lineIds }, quoteId: input.quoteId, quote: { organizationId } },
    select: { id: true, productId: true, variations: true },
  });
  if (!lineIds.length || lines.length !== lineIds.length || lines.some((line) => !keyMatches(line, source.proof, colorGroupId))) {
    return { error: "Those lines changed. Save the quote and try again." };
  }
  const copiedFrom = [
    `Approved on QUO-${source.proof.quote?.number ?? "?"}`,
    source.approvedByName ? `by ${source.approvedByName}` : null,
    source.approvedAt ? `· ${formatDay(source.approvedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  try {
    const proofId = await prisma.$transaction(
      async (tx) => {
        await lockQuote(tx, input.quoteId);
        const count = await tx.proof.count({ where: { quoteId: input.quoteId } });
        if (count >= MAX_PROOFS_PER_QUOTE) throw new Refusal(`${MAX_PROOFS_PER_QUOTE} proofs is the most one quote holds.`);
        const last = await tx.proof.aggregate({ where: { quoteId: input.quoteId }, _max: { number: true } });
        const proof = await tx.proof.create({
          data: {
            organizationId,
            quoteId: input.quoteId,
            number: (last._max.number ?? 0) + 1,
            productId: source.proof.productId,
            colorOptionId: source.proof.colorOptionId,
            productName: source.proof.productName,
            colorLabel: source.proof.colorLabel,
            createdById: userId,
          },
          select: { id: true },
        });
        const version = await tx.proofVersion.create({
          data: {
            organizationId,
            proofId: proof.id,
            version: 1,
            displayKey: source.displayKey,
            thumbKey: source.thumbKey,
            docKey: source.docKey,
            contentType: source.contentType,
            sizeBytes: source.sizeBytes,
            width: source.width,
            height: source.height,
            publicToken: publicToken(),
            copiedFrom,
            createdById: userId,
          },
          select: { id: true },
        });
        await tx.proofPanel.createMany({
          data: source.panels.map(({ id: _id, versionId: _versionId, placement, ...panel }) => ({
            ...panel,
            placement: placement ?? Prisma.JsonNull,
            versionId: version.id,
          })),
        });
        await tx.quoteLineItem.updateMany({ where: { quoteId: input.quoteId, id: { in: lineIds } }, data: { proofId: proof.id } });
        return proof.id;
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
    return { ok: true as const, proofId };
  } catch (error) {
    if (error instanceof Refusal) return { error: error.message };
    throw error;
  }
}

/* ------------------------------- Sending --------------------------------- */

// What Send proofs is about to send, and any artwork that looks like a
// famous brand's (asked about now if it never was). A warning only.
export async function proofsToSend(organizationId: string, userId: string, quoteId: string) {
  const proofs = await quoteProofs(organizationId, quoteId);
  const drafts = proofs.filter((proof) => proof.versions[0]?.status === "DRAFT" && proof.lineIds.length > 0);
  const artworkIds = [...new Set(drafts.flatMap((proof) => proof.versions[0].panels.flatMap((panel) => (panel.artworkId ? [panel.artworkId] : []))))];
  const unchecked = await prisma.artwork.findMany({
    where: { organizationId, id: { in: artworkIds }, OR: [{ checkStatus: null }, { checkStatus: "unchecked" }] },
    select: { id: true },
  });
  await Promise.all(unchecked.slice(0, 6).map((row) => checkArtwork(organizationId, userId, row.id).catch(() => null)));
  const flagged = await prisma.artwork.findMany({
    where: { organizationId, id: { in: artworkIds }, checkStatus: { in: ["famous", "unsure", "unchecked"] } },
    select: { name: true, checkStatus: true, checkNote: true },
  });
  const quote = await prisma.quote.findFirst({ where: { id: quoteId, organizationId }, select: { proofToken: true } });
  return {
    drafts: drafts.map((proof) => ({ number: proof.number, productName: proof.productName, colorLabel: proof.colorLabel })),
    noLines: proofs.filter((proof) => proof.versions[0]?.status === "DRAFT" && proof.lineIds.length === 0).map((proof) => proof.number),
    warnings: flagged.map((row) => ({
      name: row.name,
      note:
        row.checkStatus === "unchecked"
          ? "Not checked for a famous brand's logo."
          : (row.checkNote ?? "May be a famous brand's logo. Make sure you're allowed to print it."),
    })),
    token: quote?.proofToken ?? null,
  };
}

// Sends every proof whose newest version is a draft and covers a line:
// those versions become SENT and every older version of them is replaced.
// The quote's own status, deal and follow-ups are never touched. With
// nothing new, it hands back the link so it can be shared again.
export async function sendProofs(organizationId: string, quoteId: string) {
  if (!(await apparelAllowed(organizationId))) return { error: OFF };
  const proofs = await quoteProofs(organizationId, quoteId);
  const sending = proofs
    .filter((proof) => proof.versions[0]?.status === "DRAFT" && proof.lineIds.length > 0)
    .map((proof) => ({ proofId: proof.id, versionId: proof.versions[0].id }));
  const sentBefore = proofs.some((proof) => answerableVersion(proof));
  if (!sending.length && !sentBefore) return { error: "Make a proof first." };

  const token = await prisma.$transaction(async (tx) => {
    await lockQuote(tx, quoteId);
    const quote = await tx.quote.findFirst({ where: { id: quoteId, organizationId }, select: { id: true, proofToken: true } });
    if (!quote) throw new Refusal("This quote is gone. Reload the page.");
    const now = new Date();
    for (const item of sending) {
      const sent = await tx.proofVersion.updateMany({
        where: { id: item.versionId, proofId: item.proofId, status: "DRAFT" },
        data: { status: "SENT", sentAt: now },
      });
      if (!sent.count) continue;
      await tx.proofVersion.updateMany({
        where: { proofId: item.proofId, id: { not: item.versionId }, status: { not: "SUPERSEDED" } },
        data: { status: "SUPERSEDED", supersededAt: now },
      });
    }
    if (quote.proofToken) return quote.proofToken;
    const minted = publicToken();
    await tx.quote.update({ where: { id: quote.id }, data: { proofToken: minted } });
    return minted;
  }).catch((error) => {
    if (error instanceof Refusal) return { error: error.message };
    throw error;
  });
  if (typeof token !== "string") return token;
  await refreshProofEvents(organizationId, quoteId);
  return { ok: true as const, token, sent: sending.length };
}

/* ------------------------------- Answers --------------------------------- */

const NAME_MAX = 80;
const NOTE_MAX = 1000;

function cleanText(raw: unknown, max: number) {
  return String(raw ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

// One guarded write: only the newest version of a proof on this quote,
// still in the state the answer expects. A count of 0 means it changed.
async function answerVersion(
  quoteId: string,
  organizationId: string,
  versionId: string,
  from: ProofStatusValue[],
  data: Prisma.Sql,
) {
  return prisma.$executeRaw`
    UPDATE "ProofVersion" v
    SET ${data}, "updatedAt" = now()
    FROM "Proof" p
    WHERE v.id = ${versionId}
      AND v."proofId" = p.id
      AND p."quoteId" = ${quoteId}
      AND v."organizationId" = ${organizationId}
      AND v.status::text IN (${Prisma.join(from)})
      AND NOT EXISTS (SELECT 1 FROM "ProofVersion" n WHERE n."proofId" = v."proofId" AND n.version > v.version)`;
}

// The customer's answer on /pf/<token>: approve with a typed name, or ask
// for changes with a note. No login; the token is the key. A double tap on
// an approval is a success that changes nothing.
export async function answerProofs(input: {
  token: string;
  versionIds: string[];
  decision: "approve" | "changes";
  name: unknown;
  note?: unknown;
}): Promise<{ ok: true } | { error: string }> {
  const quote = await prisma.quote.findUnique({
    where: { proofToken: input.token },
    select: { id: true, organizationId: true, organization: { select: { status: true } } },
  });
  if (!quote || quote.organization.status !== "ACTIVE") return { error: "This link is off. Ask whoever sent it for a new one." };
  const name = cleanText(input.name, NAME_MAX);
  if (name.length < 2) return { error: "Type your name." };
  const note = cleanText(input.note, NOTE_MAX);
  if (input.decision === "changes" && note.length < 2) return { error: "Tell us what to change." };
  const ids = [...new Set(input.versionIds.map(String))].slice(0, MAX_PROOFS_PER_QUOTE);
  if (!ids.length) return { error: "Reload the page." };
  // Only proofs still on the order can be answered.
  const onPage = new Set((await publicProofs(quote.id, quote.organizationId)).flatMap((proof) => (proof.version ? [proof.version.id] : [])));
  if (ids.some((id) => !onPage.has(id))) return { error: "This proof was updated. Reload the page to see the new one." };

  let stale = false;
  for (const versionId of ids) {
    const changed =
      input.decision === "approve"
        ? await answerVersion(
            quote.id,
            quote.organizationId,
            versionId,
            ["SENT"],
            Prisma.sql`status = 'APPROVED'::"ProofStatus", "approvedByName" = ${name}, "approvedAt" = now(), "approvedOffline" = false`,
          )
        : await answerVersion(
            quote.id,
            quote.organizationId,
            versionId,
            ["SENT"],
            Prisma.sql`status = 'CHANGES'::"ProofStatus", "changesByName" = ${name}, "changesNote" = ${note}, "changesAt" = now()`,
          );
    if (changed) continue;
    const now = await prisma.proofVersion.findFirst({
      where: { id: versionId, organizationId: quote.organizationId, proof: { quoteId: quote.id } },
      select: { status: true },
    });
    const same = now?.status === (input.decision === "approve" ? "APPROVED" : "CHANGES");
    if (!same) stale = true;
  }
  await refreshProofEvents(quote.organizationId, quote.id);
  if (stale) return { error: "This proof was updated. Reload the page to see the new one." };
  return { ok: true };
}

// The team marks a proof approved by hand: said yes on the phone, signed a
// printout, or looked at it in the shop. A draft marked approved counts as
// sent, and replaces the versions before it.
export async function markProofApproved(organizationId: string, userId: string, versionId: string, rawName: unknown) {
  const name = cleanText(rawName, NAME_MAX);
  if (name.length < 2) return { error: "Type who approved it." };
  const version = await prisma.proofVersion.findFirst({
    where: { id: versionId, organizationId },
    select: { id: true, proofId: true, status: true, proof: { select: { quoteId: true } } },
  });
  const quoteId = version?.proof.quoteId;
  if (!version || !quoteId) return { error: "That proof is gone. Reload the page." };
  if (version.status === "APPROVED") return { ok: true as const, quoteId };
  const changed = await prisma.$transaction(async (tx) => {
    await lockQuote(tx, quoteId);
    const now = new Date();
    const count = await tx.$executeRaw`
      UPDATE "ProofVersion" v
      SET status = 'APPROVED'::"ProofStatus", "approvedByName" = ${name}, "approvedAt" = ${now},
          "approvedOffline" = true, "approvedById" = ${userId}, "sentAt" = COALESCE(v."sentAt", ${now}), "updatedAt" = now()
      WHERE v.id = ${version.id}
        AND v."organizationId" = ${organizationId}
        AND v.status::text IN ('DRAFT', 'SENT', 'CHANGES')
        AND NOT EXISTS (SELECT 1 FROM "ProofVersion" n WHERE n."proofId" = v."proofId" AND n.version > v.version)`;
    if (count) {
      await tx.proofVersion.updateMany({
        where: { proofId: version.proofId, id: { not: version.id }, status: { not: "SUPERSEDED" } },
        data: { status: "SUPERSEDED", supersededAt: now },
      });
    }
    return count;
  });
  if (!changed) return { error: "This proof was just changed. Reload the page." };
  await refreshProofEvents(organizationId, quoteId);
  return { ok: true as const, quoteId };
}

/* ---------------------------- The customer's page ---------------------------- */

export type PublicProof = {
  number: number;
  productName: string;
  colorLabel: string | null;
  lines: string[];
  // The version they answer, or null while only a draft exists.
  version: {
    id: string;
    token: string;
    width: number | null;
    height: number | null;
    status: ProofStatusValue;
    approvedByName: string | null;
    approvedAt: string | null;
    changesNote: string | null;
    panels: { locationLabel: string; artworkName: string; inkNote: string | null; shownOn: string | null }[];
  } | null;
  // A newer draft is being made: show the last one sent with its buttons off.
  beingUpdated: boolean;
};

export async function publicProofs(quoteId: string, organizationId: string): Promise<PublicProof[]> {
  const proofs = await quoteProofs(organizationId, quoteId);
  const lineIds = proofs.flatMap((proof) => proof.lineIds);
  const lines = lineIds.length
    ? await prisma.quoteLineItem.findMany({
        where: { id: { in: lineIds } },
        orderBy: { position: "asc" },
        select: { id: true, quantity: true, variationText: true, name: true },
      })
    : [];
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const out: PublicProof[] = [];
  for (const proof of proofs) {
    const version = answerableVersion(proof);
    if (!version || !proof.lineIds.length) continue;
    out.push({
      number: proof.number,
      productName: proof.productName,
      colorLabel: proof.colorLabel,
      lines: proof.lineIds.flatMap((id) => {
        const line = lineById.get(id);
        if (!line) return [];
        const quantity = Number.isInteger(line.quantity) ? String(line.quantity) : line.quantity.toFixed(2);
        return [`${quantity} × ${line.variationText ?? line.name}`];
      }),
      version: {
        id: version.id,
        token: version.token,
        width: version.width,
        height: version.height,
        status: version.status,
        approvedByName: version.approvedByName,
        approvedAt: version.approvedAt,
        changesNote: version.changesNote,
        panels: version.panels.map((panel) => ({
          locationLabel: panel.locationLabel,
          artworkName: panel.artworkName,
          inkNote: panel.inkNote,
          shownOn: panel.shownOn,
        })),
      },
      beingUpdated: proof.versions[0]?.status === "DRAFT" && version.status !== "APPROVED",
    });
  }
  return out;
}

/* ------------------------------- Pictures -------------------------------- */

// /files/<token> for a proof version: its picture, ?v=thumb or ?v=doc. A
// draft is the team's only; a sent one is public while the workspace is.
export async function readProofPicture(token: string, variant: string | null) {
  const row = await prisma.proofVersion.findUnique({
    where: { publicToken: token },
    select: {
      displayKey: true,
      thumbKey: true,
      docKey: true,
      contentType: true,
      status: true,
      organizationId: true,
      organization: { select: { status: true } },
    },
  });
  if (!row) return null;
  const key = variant === "thumb" ? row.thumbKey : variant === "doc" ? row.docKey : row.displayKey;
  const type = variant === "doc" ? "image/jpeg" : row.contentType;
  return {
    draft: row.status === "DRAFT",
    organizationId: row.organizationId,
    active: row.organization.status === "ACTIVE",
    open: async () => streamStoredFile(storageDriver(), key),
    type,
  };
}

/* ------------------------------- Contracts ------------------------------- */

export type ContractProofView = {
  versionId: string;
  token: string;
  number: number;
  version: number;
  productName: string;
  colorLabel: string | null;
  covers: string;
  status: ProofStatusValue;
  approvedByName: string | null;
  approvedAt: string | null;
  panels: PanelView[];
};

// The proofs a contract carries, in proof order, read live: an answer that
// came in since shows, and a version replaced since is said to be.
export async function contractProofs(contractId: string, organizationId: string): Promise<ContractProofView[]> {
  const rows = await prisma.contractProof.findMany({
    where: { contractId, contract: { organizationId } },
    orderBy: { position: "asc" },
    select: {
      covers: true,
      version: {
        select: {
          ...VERSION_SELECT,
          proof: { select: { number: true, productName: true, colorLabel: true } },
        },
      },
    },
  });
  return rows.map(({ version, covers }) => {
    const view = versionView(version);
    return {
      versionId: view.id,
      token: view.token,
      number: version.proof.number,
      version: view.version,
      productName: version.proof.productName,
      colorLabel: version.proof.colorLabel,
      covers,
      status: view.status,
      approvedByName: view.approvedByName,
      approvedAt: view.approvedAt,
      panels: view.panels,
    };
  });
}

// What a proof is for, as the quote's lines read now: "12 S, 24 M, 12 L".
async function coversText(lineIds: string[]) {
  if (!lineIds.length) return new Map<string, string>();
  const lines = await prisma.quoteLineItem.findMany({
    where: { id: { in: lineIds } },
    orderBy: { position: "asc" },
    select: { id: true, quantity: true, variationText: true, name: true, proofId: true },
  });
  const out = new Map<string, string[]>();
  for (const line of lines) {
    if (!line.proofId) continue;
    const quantity = Number.isInteger(line.quantity) ? String(line.quantity) : line.quantity.toFixed(2);
    out.set(line.proofId, [...(out.get(line.proofId) ?? []), `${quantity} × ${line.variationText ?? line.name}`]);
  }
  return new Map([...out].map(([id, parts]) => [id, parts.join(", ").slice(0, 600)]));
}

// The quote's proofs a contract can carry: every one with a sent version
// still on a line, and whether the contract's own rows come from it.
export async function contractProofChoices(organizationId: string, contractId: string) {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, organizationId },
    select: { quoteId: true, lineItems: { select: { quoteLineItemId: true } }, proofs: { select: { versionId: true } } },
  });
  if (!contract?.quoteId) return [];
  const proofs = await quoteProofs(organizationId, contract.quoteId);
  const rows = new Set(contract.lineItems.flatMap((row) => (row.quoteLineItemId ? [row.quoteLineItemId] : [])));
  const held = new Set(contract.proofs.map((row) => row.versionId));
  return proofs.flatMap((proof) => {
    const version = answerableVersion(proof);
    if (!version || !proof.lineIds.length) return [];
    return [
      {
        versionId: version.id,
        token: version.token,
        number: proof.number,
        productName: proof.productName,
        colorLabel: proof.colorLabel,
        status: version.status,
        onRows: proof.lineIds.some((id) => rows.has(id)),
        held: held.has(version.id),
      },
    ];
  });
}

// "Include the proofs": the versions picked, or, with none named, the
// proofs the contract's own rows come from — and every proof on the quote
// when none of its rows is a garment (a printer's order of print charges).
// Only while the contract is a draft, like every other contract edit.
export async function attachContractProofs(organizationId: string, contractId: string, versionIds?: string[]) {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, organizationId },
    select: { id: true, status: true, quoteId: true },
  });
  if (!contract) return { error: "That contract is gone. Reload the page." };
  if (contract.status !== "DRAFT") return { error: "Proofs change only while the contract is a draft. Pull it back to draft first." };
  if (!contract.quoteId) return { error: "This contract wasn't made from a quote, so it has no proofs." };
  const choices = await contractProofChoices(organizationId, contract.id);
  let picked = versionIds
    ? choices.filter((choice) => versionIds.includes(choice.versionId))
    : choices.filter((choice) => choice.onRows);
  if (!versionIds && !picked.length) picked = choices;
  if (versionIds && picked.length !== new Set(versionIds).size) return { error: "Those proofs changed. Reload the page." };
  const proofs = await quoteProofs(organizationId, contract.quoteId);
  const proofOf = new Map(proofs.flatMap((proof) => proof.versions.map((version) => [version.id, proof] as const)));
  const covers = await coversText(picked.flatMap((choice) => proofOf.get(choice.versionId)?.lineIds ?? []));
  const changed = await prisma.$transaction(async (tx) => {
    const still = await tx.contract.updateMany({ where: { id: contract.id, status: "DRAFT" }, data: { updatedAt: new Date() } });
    if (!still.count) return false;
    await tx.contractProof.deleteMany({ where: { contractId: contract.id } });
    if (picked.length) {
      await tx.contractProof.createMany({
        data: picked.map((choice) => {
          const proof = proofOf.get(choice.versionId);
          return {
            contractId: contract.id,
            versionId: choice.versionId,
            position: choice.number,
            covers: proof ? `${proof.productName}${proof.colorLabel ? ` · ${proof.colorLabel}` : ""}: ${covers.get(proof.id) ?? ""}` : "",
          };
        }),
      });
    }
    return true;
  });
  if (!changed) return { error: "Proofs change only while the contract is a draft. Pull it back to draft first." };
  return { ok: true as const, count: picked.length };
}

export async function detachContractProofs(organizationId: string, contractId: string) {
  const contract = await prisma.contract.findFirst({ where: { id: contractId, organizationId }, select: { id: true, status: true } });
  if (!contract) return { error: "That contract is gone. Reload the page." };
  if (contract.status !== "DRAFT") return { error: "Proofs change only while the contract is a draft. Pull it back to draft first." };
  await prisma.contractProof.deleteMany({ where: { contractId: contract.id, contract: { status: "DRAFT" } } });
  return { ok: true as const };
}

// The print file behind a contract's proof, for the printer's purchase
// order: only a live money-out contract, only a version it carries that was
// approved (a signed order keeps what it was signed for, even after a newer
// version), only while the workspace is active.
export async function contractPrintFile(contractToken: string, versionId: string, position: number) {
  const contract = await prisma.contract.findUnique({
    where: { publicToken: contractToken },
    select: { id: true, status: true, payable: true, organizationId: true, organization: { select: { status: true } } },
  });
  if (!contract || !contract.payable || contract.organization.status !== "ACTIVE") return null;
  if (contract.status !== "SENT" && contract.status !== "SIGNED") return null;
  const held = await prisma.contractProof.findFirst({
    where: { contractId: contract.id, versionId, version: { approvedAt: { not: null }, organizationId: contract.organizationId } },
    select: { version: { select: { panels: { where: { position }, select: { artwork: { select: { printKey: true, printName: true } } } } } } },
  });
  const artwork = held?.version.panels[0]?.artwork;
  if (!artwork?.printKey) return null;
  const file = await streamStoredFile(storageDriver(), artwork.printKey);
  return file ? { ...file, name: artwork.printName || "artwork" } : null;
}

/* -------------------------------- Sweeps --------------------------------- */

// Proofs whose quote was deleted and that no contract carries go, files and
// all; then artwork nothing holds any more.
export async function sweepProofs(organizationId: string) {
  const orphans = await prisma.proof.findMany({
    where: { organizationId, quoteId: null, versions: { none: { contracts: { some: {} } } } },
    select: { id: true, versions: { select: { displayKey: true, thumbKey: true, docKey: true } } },
    take: 200,
  });
  if (orphans.length) {
    await prisma.proof.deleteMany({
      where: {
        id: { in: orphans.map((row) => row.id) },
        quoteId: null,
        versions: { none: { contracts: { some: {} } } },
      },
    });
    const left = new Set(
      (await prisma.proof.findMany({ where: { id: { in: orphans.map((row) => row.id) } }, select: { id: true } })).map((row) => row.id),
    );
    await deleteUnheldFiles(
      storageDriver(),
      orphans.filter((row) => !left.has(row.id)).flatMap((row) => row.versions),
    );
  }
  await sweepUnusedArtwork(organizationId);
}
