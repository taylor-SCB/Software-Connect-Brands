"use client";

import { ink } from "@/lib/ink";
import { useMemo, useRef, useState, useTransition } from "react";
import { saveLineItems, type LineItemInput } from "../actions";
import { formatCents, dollarsToCents, centsToDollarInput } from "@/lib/format";
import { computeQuoteTotals, lineGrossCents, lineTotalCents, resolveDiscount, termTotalCents } from "@/lib/quote-math";
import {
  LINE_ITEM_TAGS,
  TAG_LABELS,
  TAG_COLORS,
  UNIT_GROUPS,
  UNIT_LABELS,
  SOFTWARE_RATES,
  SOFTWARE_BILLING_LABELS,
  tagHasUnits,
  unitGroupsForTag,
  type LineItemTagValue,
  type UnitOfMeasureValue,
  type SoftwareRateValue,
} from "@/lib/constants";
import { IconPlus, IconTrash } from "@/components/icons";
import { FormError, FormSuccess } from "@/components/ui";
import { SupplierCell, type SupplierOption } from "./supplier-cell";
import type { PlatformSupplier } from "@/lib/account-types";
import { CatalogPicker } from "./catalog-picker";
import { MeetingDraftButton } from "./meeting-draft";
import { useReportUnsavedLines } from "./mark-sent";
import type { DraftedLine } from "../ai-actions";
import {
  customUnitIdOf,
  customUnitValue,
  pickLivePicture,
  type LineProductLabels,
  type VariationEntry,
} from "@/lib/variation-shared";
import {
  DiscountInput,
  discountAsStored,
  discountPayload,
  discountProblem,
  discountStateOf,
  type DiscountState,
} from "@/components/discount-input";

export type EditorProduct = {
  id: string;
  name: string;
  description: string;
  unitPriceCents: number;
  defaultTag: string;
  serviceType: string | null;
  unitOfMeasure: string | null;
  softwareRate: string | null;
  softwareTerm: number | null;
  // The lowest price the starred supplier's minimum margin allows.
  minPriceCents?: number | null;
  // Release 3b: one of the workspace's own units, and the product's labels
  // and pictures for the line's pickers.
  customUnitId?: string | null;
  customUnitName?: string | null;
  labels?: LineProductLabels | null;
};

// A workspace unit for the line's unit select.
export type EditorUnit = { id: string; name: string; tag: string; archived: boolean };

export type EditorLine = {
  // The stored row's id, so a save keeps it (and the contract rows and
  // cancelled mark that point at it) instead of replacing it.
  id?: string | null;
  productId: string | null;
  name: string;
  description: string;
  projectNotes: string;
  quantity: number;
  unitPriceCents: number;
  // Money off this line, already in cents, and the percent it was typed
  // as when it was a percent.
  discountCents: number;
  discountPercent: number | null;
  tag: string;
  serviceType: string | null;
  supplierCompanyId: string | null;
  unitOfMeasure: string | null;
  softwareRate: string | null;
  softwareTermMonths: number | null;
  // The product's starred supplier's minimum price, when it has one.
  minPriceCents?: number | null;
  // Release 3b, as stored: the labels picked, a workspace unit and its
  // name, and the picture the line went out with.
  variations?: VariationEntry[];
  customUnitId?: string | null;
  unitLabel?: string | null;
  imageId?: string | null;
  imageToken?: string | null;
  imageRemoved?: boolean;
};

// Quantity and price live as strings while the user types so a partially
// typed "1." or "" doesn't get coerced to 0 mid-keystroke.
type Row = {
  uid: string;
  id: string | null;
  productId: string | null;
  name: string;
  description: string;
  projectNotes: string;
  quantityInput: string;
  unitPriceInput: string;
  // The discount as typed, and whether it is a percent or dollars off.
  discountInput: string;
  discountMode: "percent" | "cents";
  tag: LineItemTagValue;
  // Which kind of work the row is, when the quote is split that way.
  serviceType: string;
  // Who we buy it from. Never leaves the workspace.
  supplierCompanyId: string | null;
  unitOfMeasure: string;
  softwareRate: string;
  // Typed as two boxes and stored as one number of months.
  termYearsInput: string;
  termMonthsInput: string;
  // Whether saving the quote should also put this line in the catalog.
  // Only ever offered for a line typed by hand that has never been saved.
  saveAsProduct: boolean;
  // Below this a unit is under the starred supplier's minimum margin:
  // allowed, and flagged in red. Never saved.
  minPriceCents: number | null;
  // Release 3b. One pick per group (group id → option id), the labels as
  // stored (kept as written), and whether the picks were changed here:
  // only then are they sent, so a save of something else never rewrites
  // a sent quote's labels.
  picks: Record<string, string>;
  savedVariations: VariationEntry[];
  labelsTouched: boolean;
  // A workspace unit's name as the line has it (unitOfMeasure holds
  // "cu:<id>" for one).
  savedUnitLabel: string | null;
  // The picture the line holds, if any.
  imageToken: string | null;
  imageRemoved: boolean;
  // Drafted from the meeting with no catalog product (Nov 10, 2026): it
  // has no price until someone types one, and the save waits for it.
  priceNeeded?: boolean;
  // Why the AI drafted it, shown in the editor only (never saved: project
  // notes print on the customer's copy).
  draftNote?: string;
};

function picksOf(entries: VariationEntry[]) {
  const picks: Record<string, string> = {};
  for (const entry of entries) picks[entry.groupId] = entry.optionId;
  return picks;
}

let uidCounter = 0;
const nextUid = () => `row-${(uidCounter += 1)}`;

function splitTerm(months: number | null | undefined) {
  if (!months || months <= 0) return { years: "", months: "" };
  return {
    years: Math.floor(months / 12) ? String(Math.floor(months / 12)) : "",
    months: months % 12 ? String(months % 12) : "",
  };
}

function rowTermMonths(row: Row) {
  const years = Number.parseInt(row.termYearsInput, 10);
  const months = Number.parseInt(row.termMonthsInput, 10);
  const total = (Number.isFinite(years) ? years : 0) * 12 + (Number.isFinite(months) ? months : 0);
  return total > 0 ? total : null;
}

function toRow(line: EditorLine): Row {
  const term = splitTerm(line.softwareTermMonths);
  return {
    uid: nextUid(),
    id: line.id ?? null,
    productId: line.productId,
    name: line.name,
    description: line.description,
    projectNotes: line.projectNotes,
    quantityInput: String(line.quantity),
    unitPriceInput: centsToDollarInput(line.unitPriceCents),
    discountInput:
      line.discountPercent !== null
        ? String(line.discountPercent)
        : line.discountCents
          ? centsToDollarInput(line.discountCents)
          : "",
    discountMode: line.discountPercent !== null || !line.discountCents ? "percent" : "cents",
    tag: line.tag as LineItemTagValue,
    serviceType: line.serviceType ?? "",
    supplierCompanyId: line.supplierCompanyId,
    // A built-in unit wins over a workspace one (code from before 3b may
    // have set it beside one).
    unitOfMeasure: line.unitOfMeasure ?? (line.customUnitId ? customUnitValue(line.customUnitId) : ""),
    softwareRate: line.softwareRate ?? "",
    termYearsInput: term.years,
    termMonthsInput: term.months,
    picks: picksOf(line.variations ?? []),
    savedVariations: line.variations ?? [],
    labelsTouched: false,
    savedUnitLabel: line.unitOfMeasure ? null : (line.unitLabel ?? null),
    imageToken: line.imageToken ?? null,
    imageRemoved: line.imageRemoved ?? false,
    // Off for anything loaded from the database. A line typed by hand and
    // already saved comes back with productId null too, so productId alone
    // is not a reliable "typed by hand" signal — it would re-offer the tick
    // on every visit to an old quote.
    saveAsProduct: false,
    minPriceCents: line.minPriceCents ?? null,
  };
}

function rowQuantity(row: Row) {
  const value = Number.parseFloat(row.quantityInput);
  return Number.isFinite(value) ? value : 0;
}

function rowUnitCents(row: Row) {
  return dollarsToCents(row.unitPriceInput);
}

// The typed discount worked out against the line as it stands now.
function rowDiscount(row: Row) {
  const typed = Number.parseFloat(row.discountInput);
  const gross = lineGrossCents(rowQuantity(row), rowUnitCents(row));
  if (row.discountMode === "percent") {
    return resolveDiscount({ percent: Number.isFinite(typed) ? typed : null, cents: 0 }, gross);
  }
  return resolveDiscount({ percent: null, cents: dollarsToCents(row.discountInput) }, gross);
}

// UX review, Nov 10, 2026. At 1440 the Qty, Value and Tag boxes were
// squeezed to 24-40px ("16" read "1", $1,450 read "145", the tag "▾A"):
// the table's automatic layout shrinks a column to its controls' smallest
// width, and these had none of their own. They carry a minimum now, and
// the cells' sides are a little tighter so the row still fits the card.
// On a phone (below `sm`) each line is a block of its own — the product
// across the top, then Qty / Value, Discount / Total, Tag / Supplier, each
// with its name above it — instead of a table squeezed sideways with the
// product names cut to six letters and the totals off the screen.
const PHONE_CELL = "max-sm:border-0 max-sm:p-0";
// Review follow-up: at 1280 those minimums left the product 126px beside
// a picture ("4MP turret camera, white" cut off) and the row 22px past
// the card. Tag, Supplier / Contractor and Service type now share one
// column, one above the other below 2xl (a line's product, description
// and notes already make it about that tall) and side by side from 2xl,
// which hands the product name the width of a column. The name box keeps
// 12rem, so on a tablet, where the table scrolls inside its card anyway,
// a name is still readable.
const TAG_BOX = "min-w-0 2xl:w-[8.5rem] 2xl:shrink-0";
const SIDE_BOX = "min-w-0 2xl:w-40 2xl:shrink-0";
function PhoneLabel({ children }: { children: React.ReactNode }) {
  return <span className="label font-sans sm:hidden">{children}</span>;
}

export function LineItemsEditor({
  quoteId,
  initialLines,
  initialDiscount,
  serviceTypes,
  suppliers,
  platformSuppliers = [],
  readOnly = false,
  productLabels = {},
  units = [],
  draft = true,
  meetingDraft = null,
}: {
  quoteId: string;
  initialLines: EditorLine[];
  // The discount on the whole quote as stored: cents, and the percent it
  // was typed as when it was one.
  initialDiscount: { discountCents: number; discountPercent: number | null };
  // The workspace's kinds of work, for splitting the quote by scope.
  serviceTypes: string[];
  // Companies tagged Distributor, plus any already linked to a line here.
  suppliers: SupplierOption[];
  // Accounts on Software Connect Brands this workspace hasn't linked yet.
  platformSuppliers?: PlatformSupplier[];
  readOnly?: boolean;
  // Release 3b: the labels and pictures of the products already on the
  // quote, the workspace's own units, and whether the quote is a draft (a
  // draft's lines show the product's picture live).
  productLabels?: Record<string, LineProductLabels>;
  units?: EditorUnit[];
  draft?: boolean;
  // "Draft lines from the meeting" (AI on, a draft quote whose deal came
  // from a Pipeline opportunity); auto when Build Quote asked for it.
  meetingDraft?: { auto: boolean } | null;
}) {
  const [rows, setRows] = useState<Row[]>(() => initialLines.map(toRow));
  // Grows as products are added from the catalog.
  const [labelData, setLabelData] = useState<Record<string, LineProductLabels>>(productLabels);
  const [unitOptions, setUnitOptions] = useState<EditorUnit[]>(units);
  // What each row's picks were when a save went out, so the answer only
  // replaces picks nobody has changed since.
  const sentPicks = useRef(new Map<string, string>());
  // The pictures the lines hold, as stored: Mark as sent writes them and
  // Back to draft lets them go, re-rendering the page, and the rows follow
  // without losing anything typed.
  const imageKey = initialLines
    .map((line) => `${line.id ?? ""}:${line.imageToken ?? ""}:${line.imageRemoved ? 1 : 0}`)
    .join("|");
  const [seenImages, setSeenImages] = useState(imageKey);
  if (imageKey !== seenImages) {
    setSeenImages(imageKey);
    const byId = new Map(initialLines.map((line) => [line.id ?? "", line]));
    setRows((current) =>
      current.map((row) => {
        const line = row.id ? byId.get(row.id) : undefined;
        return line ? { ...row, imageToken: line.imageToken ?? null, imageRemoved: Boolean(line.imageRemoved) } : row;
      }),
    );
  }
  // Grows when someone adds a distributor from inside a row, so every row's
  // picker sees it without a page reload.
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>(suppliers);
  // Off until it is wanted: a one-trade business never sees the column.
  // On by itself when the quote already has a service type on a row.
  const [splitByService, setSplitByService] = useState(() =>
    initialLines.some((line) => Boolean(line.serviceType)),
  );
  // Money off the whole quote, as typed, under the lines' own discounts.
  // Saved with the lines, and worked out on the server against them.
  const [quoteDiscount, setQuoteDiscount] = useState<DiscountState>(() => discountStateOf(initialDiscount));
  const [dirty, setDirty] = useState(false);
  // Send quote (under the DealJourney strip) holds off while this is set.
  useReportUnsavedLines(dirty);
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [pending, startTransition] = useTransition();
  // Set by any edit made while a save is in flight, so finishing that save
  // doesn't clear "Unsaved changes" on work it never sent.
  const editedDuringSave = useRef(false);

  const totals = useMemo(
    () =>
      computeQuoteTotals(
        rows.map((row) => ({
          quantity: rowQuantity(row),
          unitPriceCents: rowUnitCents(row),
          discountCents: rowDiscount(row).discountCents,
          tag: row.tag,
        })),
        discountAsStored(quoteDiscount),
      ),
    [rows, quoteDiscount],
  );

  function changeQuoteDiscount(next: DiscountState) {
    setQuoteDiscount(next);
    setDirty(true);
    editedDuringSave.current = true;
    setState({});
  }

  function mutate(next: Row[]) {
    setRows(next);
    setDirty(true);
    editedDuringSave.current = true;
    setState({});
  }

  // Applied to whatever the rows are NOW, not to the array captured when
  // the handler was created. Adding a supplier is a server round trip, and
  // its callback fires long after: mapping a stale array there replaced the
  // whole table and threw away anything typed while it ran.
  function updateRow(uid: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
    setDirty(true);
    editedDuringSave.current = true;
    setState({});
  }

  function addBlankLine() {
    mutate([
      ...rows,
      {
        uid: nextUid(),
        id: null,
        productId: null,
        name: "",
        description: "",
        projectNotes: "",
        quantityInput: "1",
        unitPriceInput: "0.00",
        discountInput: "",
        discountMode: "percent",
        tag: "MATERIALS",
        serviceType: "",
        supplierCompanyId: null,
        unitOfMeasure: "",
        softwareRate: "",
        termYearsInput: "",
        termMonthsInput: "",
        // Typed once, kept forever — the default Taylor asked for.
        saveAsProduct: true,
        minPriceCents: null,
        picks: {},
        savedVariations: [],
        labelsTouched: false,
        savedUnitLabel: null,
        imageToken: null,
        imageRemoved: false,
      },
    ]);
  }

  // The product comes from the catalog search (CatalogPicker), not a list
  // of every product handed to the page.
  function addProductLine(product: EditorProduct) {
    if (product.labels) setLabelData((current) => ({ ...current, [product.id]: product.labels! }));
    if (product.customUnitId && !unitOptions.some((unit) => unit.id === product.customUnitId)) {
      setUnitOptions((current) => [
        ...current,
        { id: product.customUnitId!, name: product.customUnitName ?? "Your unit", tag: product.defaultTag, archived: true },
      ]);
    }
    const term = splitTerm(
      product.softwareRate === "PER_MONTH"
        ? product.softwareTerm
        : product.softwareRate === "PER_YEAR" && product.softwareTerm
          ? product.softwareTerm * 12
          : product.softwareTerm,
    );
    mutate([
      ...rows,
      {
        uid: nextUid(),
        id: null,
        productId: product.id,
        name: product.name,
        description: product.description,
        projectNotes: "",
        quantityInput: "1",
        unitPriceInput: centsToDollarInput(product.unitPriceCents),
        discountInput: "",
        discountMode: "percent",
        tag: product.defaultTag as LineItemTagValue,
        // The catalog already knows what kind of work it is.
        serviceType: product.serviceType ?? "",
        supplierCompanyId: null,
        unitOfMeasure: product.unitOfMeasure ?? (product.customUnitId ? customUnitValue(product.customUnitId) : ""),
        softwareRate: product.softwareRate ?? "",
        termYearsInput: term.years,
        termMonthsInput: term.months,
        // It is already in the catalog; that is where it came from.
        saveAsProduct: false,
        minPriceCents: product.minPriceCents ?? null,
        picks: {},
        savedVariations: [],
        labelsTouched: false,
        savedUnitLabel: null,
        imageToken: null,
        imageRemoved: false,
      },
    ]);
  }

  // Lines drafted from the meeting notes, added unsaved for review: a
  // catalog line at the catalog's price, a typed one at $0 marked
  // "Price needed".
  function addDraftedLines(lines: DraftedLine[]) {
    if (lines.length === 0) return;
    const added: Row[] = [];
    for (const line of lines) {
      if (line.kind === "catalog") {
        const product = line.product;
        if (product.labels) setLabelData((current) => ({ ...current, [product.id]: product.labels! }));
        if (product.customUnitId && !unitOptions.some((unit) => unit.id === product.customUnitId)) {
          setUnitOptions((current) => [
            ...current,
            { id: product.customUnitId!, name: product.customUnitName ?? "Your unit", tag: product.defaultTag, archived: true },
          ]);
        }
        const term = splitTerm(
          product.softwareRate === "PER_YEAR" && product.softwareTerm ? product.softwareTerm * 12 : product.softwareTerm,
        );
        added.push({
          ...blankRow(),
          productId: product.id,
          name: product.name,
          description: product.description,
          draftNote: line.note,
          quantityInput: String(line.quantity),
          unitPriceInput: centsToDollarInput(product.unitPriceCents),
          tag: product.defaultTag as LineItemTagValue,
          serviceType: product.serviceType ?? "",
          unitOfMeasure: product.unitOfMeasure ?? (product.customUnitId ? customUnitValue(product.customUnitId) : ""),
          softwareRate: product.softwareRate ?? "",
          termYearsInput: term.years,
          termMonthsInput: term.months,
          minPriceCents: product.minPriceCents ?? null,
        });
      } else {
        added.push({
          ...blankRow(),
          name: line.name,
          description: line.description,
          draftNote: line.note,
          quantityInput: String(line.quantity),
          tag: line.tag,
          priceNeeded: true,
        });
      }
    }
    setRows((current) => [...current, ...added]);
    setDirty(true);
    editedDuringSave.current = true;
    setState({});
  }

  function blankRow(): Row {
    return {
      uid: nextUid(),
      id: null,
      productId: null,
      name: "",
      description: "",
      projectNotes: "",
      quantityInput: "1",
      unitPriceInput: "0.00",
      discountInput: "",
      discountMode: "percent",
      tag: "MATERIALS",
      serviceType: "",
      supplierCompanyId: null,
      unitOfMeasure: "",
      softwareRate: "",
      termYearsInput: "",
      termMonthsInput: "",
      saveAsProduct: false,
      minPriceCents: null,
      picks: {},
      savedVariations: [],
      labelsTouched: false,
      savedUnitLabel: null,
      imageToken: null,
      imageRemoved: false,
    };
  }

  // One label picked on a row.
  function pickLabel(uid: string, groupId: string, optionId: string) {
    const row = rows.find((item) => item.uid === uid);
    if (!row) return;
    const picks = { ...row.picks };
    if (optionId) picks[groupId] = optionId;
    else delete picks[groupId];
    updateRow(uid, { picks, labelsTouched: true });
  }

  // The selects a row shows: one per group its product has, plus any group
  // the line already has a label in; a label no longer offered is offered
  // back, labelled, so the select never falls back and loses it.
  function rowGroups(row: Row) {
    const groups = (row.productId ? (labelData[row.productId]?.groups ?? []) : []).map((group) => ({
      id: group.id,
      name: group.name,
      options: group.options.map((option) => ({ ...option, gone: false })),
    }));
    for (const entry of row.savedVariations) {
      let group = groups.find((item) => item.id === entry.groupId);
      if (!group) {
        group = { id: entry.groupId, name: entry.group, options: [] };
        groups.push(group);
      }
      if (!group.options.some((option) => option.id === entry.optionId)) {
        group.options.push({ id: entry.optionId, name: entry.label, gone: true });
      }
    }
    return groups;
  }

  // The picture the row shows: the one the line holds, unless its labels
  // or product changed here; else the product's, live, on a draft — and
  // on a sent quote, what a changed line will take when saved.
  function rowPicture(row: Row) {
    const changed = row.labelsTouched || row.id === null;
    if (row.imageToken && !changed && (!draft || !row.imageRemoved)) return row.imageToken;
    if (!draft && !changed) return null;
    const live = row.productId ? pickLivePicture(labelData[row.productId]?.pictures, Object.values(row.picks)) : null;
    return live?.token ?? null;
  }

  // Changing the tag changes which units are legal, so a unit left over
  // from the old tag has to go — the server would null it anyway, and the
  // row would keep showing something nobody can see the source of.
  function changeTag(uid: string, tag: LineItemTagValue) {
    const row = rows.find((item) => item.uid === uid);
    if (!row) return;
    const ownUnit = customUnitIdOf(row.unitOfMeasure);
    const stillLegal = ownUnit
      ? unitOptions.find((unit) => unit.id === ownUnit)?.tag === tag
      : row.unitOfMeasure &&
        unitGroupsForTag(tag).some((group) =>
          (UNIT_GROUPS[group] as readonly string[]).includes(row.unitOfMeasure),
        );
    updateRow(uid, {
      tag,
      unitOfMeasure: stillLegal ? row.unitOfMeasure : "",
      ...(tag === "SOFTWARE" ? {} : { softwareRate: "", termYearsInput: "", termMonthsInput: "" }),
    });
  }

  function addSupplierOption(option: SupplierOption) {
    setSupplierOptions((current) =>
      current.some((item) => item.id === option.id)
        ? current.map((item) =>
            item.id === option.id ? { ...item, onPlatform: item.onPlatform || option.onPlatform } : item,
          )
        : [...current, option],
    );
  }
  // Accounts on Software Connect Brands linked from a row drop out of
  // every row's "On Software Connect Brands" list: they are one of this
  // workspace's own suppliers now.
  const [linkedPlatformIds, setLinkedPlatformIds] = useState<string[]>([]);
  const unlinkedPlatformSuppliers = platformSuppliers.filter((item) => !linkedPlatformIds.includes(item.id));

  function removeRow(uid: string) {
    mutate(rows.filter((row) => row.uid !== uid));
  }

  function save() {
    const payload: LineItemInput[] = rows.map((row) => ({
      id: row.id,
      uid: row.uid,
      productId: row.productId,
      name: row.name.trim(),
      description: row.description.trim(),
      projectNotes: row.projectNotes.trim(),
      quantity: rowQuantity(row),
      unitPriceCents: rowUnitCents(row),
      discountPercent: rowDiscount(row).discountPercent,
      discountCents: rowDiscount(row).discountCents,
      tag: row.tag,
      serviceType: splitByService ? row.serviceType.trim() || null : null,
      supplierCompanyId: row.supplierCompanyId,
      // The select only ever holds a value from the lists above or "", and
      // the server re-checks the pairing against the tag regardless.
      unitOfMeasure: (customUnitIdOf(row.unitOfMeasure) ? null : row.unitOfMeasure || null) as UnitOfMeasureValue | null,
      customUnitId: customUnitIdOf(row.unitOfMeasure),
      ...(row.labelsTouched ? { optionIds: Object.values(row.picks).filter(Boolean) } : {}),
      softwareRate: row.tag === "SOFTWARE" ? ((row.softwareRate || null) as SoftwareRateValue | null) : null,
      softwareTermMonths: row.tag === "SOFTWARE" ? rowTermMonths(row) : null,
      saveAsProduct: row.saveAsProduct && !row.id && !row.productId,
    }));

    const unpriced = rows.findIndex((row) => row.priceNeeded && rowUnitCents(row) === 0);
    if (unpriced >= 0) {
      setState({ error: `Line ${unpriced + 1} needs a price: it was drafted from the meeting and isn't in your catalog.` });
      return;
    }
    const blank = payload.findIndex((line) => line.name.length === 0);
    if (blank >= 0) {
      setState({ error: `Line ${blank + 1} needs a product name.` });
      return;
    }
    // A word or a minus in the discount box would otherwise save as no
    // discount at all, silently.
    const discountIssue = discountProblem(quoteDiscount.input);
    if (discountIssue) {
      setState({ error: discountIssue.replace(/^Discount/, "The discount on the whole quote") });
      return;
    }

    editedDuringSave.current = false;
    sentPicks.current = new Map(rows.map((row) => [row.uid, JSON.stringify(row.picks)]));
    startTransition(async () => {
      const result = await saveLineItems(quoteId, payload, discountPayload(quoteDiscount));
      setState({ error: result.error, success: result.success });
      if (result.error) return;

      // Take on the ids the save just handed back, matched by uid rather
      // than position: a row added or deleted mid-save shifts the array,
      // and writing an id onto the wrong row deletes a live one next time.
      const savedByUid = new Map((result.lines ?? []).map((line) => [line.uid, line]));
      setRows((current) =>
        current.map((row) => {
          const saved = savedByUid.get(row.uid);
          // saveAsProduct goes off once the row is stored: it is an
          // offer made about a brand-new line, not a standing setting.
          // The flag follows the product the line is linked to now (a
          // typed line can be linked to one by name).
          if (!saved) return row;
          const next = { ...row, id: saved.id, productId: saved.productId, saveAsProduct: false, minPriceCents: saved.minPriceCents };
          // The labels, unit and picture as stored — unless the picks were
          // changed again while the save was out.
          if (sentPicks.current.get(row.uid) === JSON.stringify(row.picks)) {
            next.picks = picksOf(saved.variations);
            next.savedVariations = saved.variations;
            next.labelsTouched = false;
            next.imageToken = saved.imageToken;
            next.imageRemoved = false;
          }
          if (customUnitIdOf(row.unitOfMeasure)) {
            next.unitOfMeasure = saved.customUnitId ? customUnitValue(saved.customUnitId) : "";
            next.savedUnitLabel = saved.unitLabel;
          }
          return next;
        }),
      );
      if (!editedDuringSave.current) setDirty(false);
    });
  }

  return (
    <div>
      {!readOnly && (
        <label className="mb-3 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={splitByService}
            onChange={(event) => {
              setSplitByService(event.target.checked);
              setDirty(true);
              // Same as any row edit: a save already in flight was built
              // before this, so finishing it must not clear "Unsaved
              // changes" on a toggle it never sent.
              editedDuringSave.current = true;
            }}
            data-testid="split-by-service-type"
          />
          <span className="muted">
            Split by service type — give each kind of work its own budget on the job
          </span>
        </label>
      )}
      <div className="overflow-x-auto">
        <table className="table max-sm:block [&_td]:px-2 [&_th]:px-2" data-testid="line-items-table">
          <thead className="max-sm:hidden">
            <tr>
              <th className="w-[42%]">Product</th>
              <th className="w-24 text-right">Qty</th>
              <th className="w-32 text-right">Value</th>
              <th className="w-36 text-right">Discount</th>
              <th className="w-24 text-right">Total</th>
              {/* Tag, Supplier / Contractor (internal, never on the
                  customer's copy) and Service type share a column: side
                  by side from 2xl, one above the other below it. */}
              <th className={`w-44 ${splitByService ? "2xl:w-[30.5rem]" : "2xl:w-80"}`} data-testid="line-pickers-head">
                <span className="flex flex-col gap-0.5 2xl:flex-row 2xl:gap-2">
                  <span className={TAG_BOX}>Tag</span>
                  <span className={SIDE_BOX}>Supplier / Contractor</span>
                  {splitByService && <span className={SIDE_BOX}>Service type</span>}
                </span>
              </th>
              {!readOnly && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {rows.length === 0 && (
              <tr className="max-sm:block">
                <td colSpan={readOnly ? 6 : 7} className="faint py-8 text-center text-xs max-sm:block">
                  No line items yet. Add one from your catalog or start a blank line.
                </td>
              </tr>
            )}

            {rows.map((row, index) => {
              const discount = rowDiscount(row);
              const total = lineTotalCents(rowQuantity(row), rowUnitCents(row), discount.discountCents);
              const termTotal =
                row.tag === "SOFTWARE"
                  ? termTotalCents(
                      rowQuantity(row),
                      rowUnitCents(row),
                      row.softwareRate || null,
                      rowTermMonths(row),
                    )
                  : null;
              return (
                <tr
                  key={row.uid}
                  className="align-top max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3 max-sm:gap-y-2.5 max-sm:border-b max-sm:border-[var(--hairline)] max-sm:py-4"
                  data-testid="line-row"
                >
                  <td className={`${PHONE_CELL} max-sm:col-span-2`}>
                    <div className="flex items-start gap-2">
                    {(() => {
                      const token = rowPicture(row);
                      return token ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/files/${token}?v=thumb`}
                          alt=""
                          width={36}
                          height={36}
                          data-testid="line-picture"
                          className="mt-0.5 h-9 w-9 shrink-0 rounded border border-[var(--border)] bg-white object-contain"
                        />
                      ) : null;
                    })()}
                    <div className="min-w-0 flex-1 sm:min-w-[12rem]">
                    <input
                      value={row.name}
                      onChange={(event) =>
                        updateRow(row.uid, { name: event.target.value })
                      }
                      placeholder="Product or service"
                      aria-label={`Line ${index + 1} product`}
                      disabled={readOnly}
                      className="input input-sm font-medium"
                    />
                    {/* Sub note 1 */}
                    <input
                      value={row.description}
                      onChange={(event) =>
                        updateRow(row.uid, { description: event.target.value })
                      }
                      placeholder="Product description"
                      aria-label={`Line ${index + 1} product description`}
                      disabled={readOnly}
                      className="input input-sm mt-1 border-transparent bg-transparent text-xs text-[var(--text-dim)]"
                    />
                    {/* Sub note 2 */}
                    <input
                      value={row.projectNotes}
                      onChange={(event) =>
                        updateRow(row.uid, { projectNotes: event.target.value })
                      }
                      placeholder="Project specific notes"
                      aria-label={`Line ${index + 1} project specific notes`}
                      disabled={readOnly}
                      className="input input-sm mt-1 border-transparent bg-transparent text-xs italic text-[var(--text-faint)]"
                    />
                    {row.draftNote && (
                      <p className="faint mt-0.5 px-2 text-[0.65rem]" data-testid="line-draft-note">
                        Drafted from the meeting: {row.draftNote}
                      </p>
                    )}

                    {/* Only for a brand-new hand-typed line. A line that
                        was typed and already saved comes back with no
                        product id too, so this would otherwise re-offer
                        itself on every visit to an old quote. */}
                    {!readOnly && row.id === null && row.productId === null && (
                      <label className="mt-1.5 flex items-center gap-1.5 text-[0.68rem]">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={row.saveAsProduct}
                          onChange={(event) =>
                            updateRow(row.uid, { saveAsProduct: event.target.checked })
                          }
                          aria-label={`Line ${index + 1} save as product`}
                          data-testid="save-as-product"
                        />
                        <span className="muted">Save as product?</span>
                      </label>
                    )}

                    {(() => {
                      const groups = rowGroups(row);
                      if (!groups.length) return null;
                      // A line whose product is gone keeps its labels, read-only.
                      if (!row.productId || readOnly) {
                        const text = row.savedVariations.map((entry) => entry.label).join(" · ");
                        return text ? (
                          <p className="mt-1 text-[0.7rem] text-[var(--text-dim)]" data-testid="line-labels-text">{text}</p>
                        ) : null;
                      }
                      return (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1" data-testid="line-labels">
                          {groups.map((group) => (
                            <select
                              key={group.id}
                              value={row.picks[group.id] ?? ""}
                              onChange={(event) => pickLabel(row.uid, group.id, event.target.value)}
                              aria-label={`Line ${index + 1} ${group.name}`}
                              data-testid="line-label"
                              data-group={group.name}
                              className="select input-sm !h-7 !w-auto !py-0 !text-[0.68rem]"
                            >
                              <option value="">{group.name} —</option>
                              {group.options.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                  {option.gone ? " (no longer offered)" : ""}
                                </option>
                              ))}
                            </select>
                          ))}
                        </div>
                      );
                    })()}

                    {tagHasUnits(row.tag) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <select
                          value={row.unitOfMeasure}
                          onChange={(event) =>
                            updateRow(row.uid, { unitOfMeasure: event.target.value })
                          }
                          aria-label={`Line ${index + 1} unit`}
                          disabled={readOnly}
                          className="select input-sm !h-7 !py-0 !text-[0.68rem]"
                          data-testid="line-unit"
                        >
                          <option value="">Unit…</option>
                          {unitGroupsForTag(row.tag).flatMap((group) =>
                            (UNIT_GROUPS[group] as readonly string[]).map((unit) => (
                              <option key={unit} value={unit}>
                                {UNIT_LABELS[unit as UnitOfMeasureValue]}
                              </option>
                            )),
                          )}
                          {(() => {
                            const own = unitOptions.filter((unit) => unit.tag === row.tag && !unit.archived);
                            const current = customUnitIdOf(row.unitOfMeasure);
                            const offeredBack =
                              current && !own.some((unit) => unit.id === current)
                                ? (unitOptions.find((unit) => unit.id === current)?.name ?? row.savedUnitLabel ?? "Your unit")
                                : null;
                            return (
                              <>
                                {own.length > 0 && (
                                  <optgroup label="Your units">
                                    {own.map((unit) => (
                                      <option key={unit.id} value={customUnitValue(unit.id)}>
                                        {unit.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {/* The line's own unit, offered back when it was
                                    retired or isn't on this list. */}
                                {offeredBack && <option value={row.unitOfMeasure}>{offeredBack} (retired)</option>}
                              </>
                            );
                          })()}
                        </select>

                        {row.tag === "SOFTWARE" && (
                          <>
                            <select
                              value={row.softwareRate}
                              onChange={(event) =>
                                updateRow(row.uid, { softwareRate: event.target.value })
                              }
                              aria-label={`Line ${index + 1} billing`}
                              disabled={readOnly}
                              className="select input-sm !h-7 !py-0 !text-[0.68rem]"
                              data-testid="line-billing"
                            >
                              {/* Blank first, so a line with no rate set
                                  doesn't display one it never had and then
                                  write it on the next save. */}
                              <option value="">Billing…</option>
                              {SOFTWARE_RATES.map((rate) => (
                                <option key={rate} value={rate}>
                                  {SOFTWARE_BILLING_LABELS[rate as SoftwareRateValue]}
                                </option>
                              ))}
                            </select>
                            <input
                              value={row.termYearsInput}
                              onChange={(event) =>
                                updateRow(row.uid, { termYearsInput: event.target.value })
                              }
                              inputMode="numeric"
                              placeholder="yr"
                              aria-label={`Line ${index + 1} term years`}
                              disabled={readOnly}
                              className="input input-sm num !h-7 !w-11 !py-0 !text-[0.68rem]"
                            />
                            <input
                              value={row.termMonthsInput}
                              onChange={(event) =>
                                updateRow(row.uid, { termMonthsInput: event.target.value })
                              }
                              inputMode="numeric"
                              placeholder="mo"
                              aria-label={`Line ${index + 1} term months`}
                              disabled={readOnly}
                              className="input input-sm num !h-7 !w-11 !py-0 !text-[0.68rem]"
                            />
                          </>
                        )}
                      </div>
                    )}
                    </div>
                    </div>
                  </td>
                  <td className={PHONE_CELL}>
                    <PhoneLabel>Qty</PhoneLabel>
                    <input
                      value={row.quantityInput}
                      onChange={(event) =>
                        updateRow(row.uid, { quantityInput: event.target.value })
                      }
                      inputMode="decimal"
                      aria-label={`Line ${index + 1} quantity`}
                      disabled={readOnly}
                      className="input input-sm num min-w-[4rem] text-right"
                    />
                  </td>
                  <td className={PHONE_CELL}>
                    <PhoneLabel>Value</PhoneLabel>
                    <input
                      value={row.unitPriceInput}
                      onChange={(event) =>
                        updateRow(row.uid, { unitPriceInput: event.target.value })
                      }
                      inputMode="decimal"
                      aria-label={`Line ${index + 1} unit value`}
                      disabled={readOnly}
                      className="input input-sm num min-w-[6rem] text-right"
                    />
                    {row.priceNeeded && rowUnitCents(row) === 0 && (
                      <p className="mt-0.5 text-right text-[0.65rem] font-semibold text-[var(--danger)]" data-testid="line-price-needed">
                        Price needed
                      </p>
                    )}
                    {/* Net of the line's discount: a discount can take a
                        line under the minimum as surely as a low price. */}
                    {row.minPriceCents !== null &&
                      rowQuantity(row) > 0 &&
                      // Compared before the line is rounded to cents, with
                      // a millionth of a cent for floating-point noise: a
                      // line at the minimum is never flagged, and a cent
                      // under always is, whatever the quantity.
                      rowQuantity(row) * rowUnitCents(row) - discount.discountCents <
                        rowQuantity(row) * row.minPriceCents - 1e-6 && (
                        <p
                          className="num mt-1 text-right text-[0.68rem] text-[var(--danger)]"
                          data-testid="line-below-minimum"
                          title="Under the starred supplier's minimum margin"
                        >
                          Below minimum ({formatCents(row.minPriceCents)})
                        </p>
                      )}
                  </td>
                  <td className={PHONE_CELL}>
                    <PhoneLabel>Discount</PhoneLabel>
                    <div className="flex items-center gap-1 sm:justify-end">
                      <input
                        value={row.discountInput}
                        onChange={(event) => updateRow(row.uid, { discountInput: event.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Line ${index + 1} discount`}
                        disabled={readOnly}
                        className="input input-sm num w-20 text-right"
                        data-testid="line-discount"
                      />
                      <select
                        value={row.discountMode}
                        onChange={(event) => updateRow(row.uid, { discountMode: event.target.value as Row["discountMode"] })}
                        aria-label={`Line ${index + 1} discount type`}
                        disabled={readOnly}
                        className="select input-sm !w-14 !px-1.5"
                      >
                        <option value="percent">%</option>
                        <option value="cents">$</option>
                      </select>
                    </div>
                    {discount.discountCents > 0 && (
                      <p className="num mt-1 text-right text-[0.68rem] text-[var(--ok)]" data-testid="line-discount-cents">
                        −{formatCents(discount.discountCents)}
                      </p>
                    )}
                  </td>
                  <td className={`num pt-3 text-right font-medium ${PHONE_CELL}`} data-testid="line-total">
                    <PhoneLabel>Total</PhoneLabel>
                    {formatCents(total)}
                    {/* What the line comes to over its whole term, so the
                        unit, the billing period and the term can be checked
                        against each other. Not part of the quote total. */}
                    {termTotal !== null && termTotal !== total && (
                      <span
                        className="faint block text-[0.68rem] font-normal"
                        data-testid="line-term-total"
                      >
                        {formatCents(termTotal)} term
                      </span>
                    )}
                  </td>
                  <td className={`${PHONE_CELL} max-sm:col-span-2`} data-testid="line-pickers">
                    <div className="flex flex-col gap-1.5 max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3 max-sm:gap-y-2.5 2xl:flex-row 2xl:gap-2">
                    <div className={TAG_BOX}>
                    <PhoneLabel>Tag</PhoneLabel>
                    <select
                      value={row.tag}
                      onChange={(event) => changeTag(row.uid, event.target.value as LineItemTagValue)}
                      aria-label={`Line ${index + 1} tag`}
                      disabled={readOnly}
                      className="select input-sm min-w-[8.5rem]"
                      style={{ color: ink(TAG_COLORS[row.tag]) }}
                    >
                      {LINE_ITEM_TAGS.map((tag) => (
                        <option key={tag} value={tag}>
                          {TAG_LABELS[tag]}
                        </option>
                      ))}
                    </select>
                    </div>
                    <div className={SIDE_BOX}>
                    <PhoneLabel>Supplier / Contractor</PhoneLabel>
                    <SupplierCell
                      value={row.supplierCompanyId}
                      options={supplierOptions}
                      platformSuppliers={unlinkedPlatformSuppliers}
                      onChange={(companyId) => updateRow(row.uid, { supplierCompanyId: companyId })}
                      onOptionAdded={addSupplierOption}
                      onPlatformLinked={(id) => setLinkedPlatformIds((current) => [...current, id])}
                      label={`Line ${index + 1} supplier`}
                      disabled={readOnly}
                    />
                    </div>
                  {splitByService && (
                    <div className={`${SIDE_BOX} max-sm:col-span-2`}>
                      <PhoneLabel>Service type</PhoneLabel>
                      <select
                        value={row.serviceType}
                        onChange={(event) => updateRow(row.uid, { serviceType: event.target.value })}
                        aria-label={`Line ${index + 1} service type`}
                        disabled={readOnly}
                        className="select input-sm"
                        data-testid="line-service-type"
                      >
                        <option value="">Whole job</option>
                        {serviceTypes.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                    </div>
                  </td>
                  {!readOnly && (
                    <td className={`pt-2.5 ${PHONE_CELL} max-sm:col-span-2 max-sm:text-right`}>
                      <button
                        type="button"
                        onClick={() => removeRow(row.uid)}
                        aria-label={`Delete line ${index + 1}`}
                        className="btn btn-ghost btn-sm !px-1.5"
                      >
                        <IconTrash size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--hairline-3)] px-5 py-3">
          <CatalogPicker onPick={addProductLine} />
          {meetingDraft && <MeetingDraftButton quoteId={quoteId} auto={meetingDraft.auto} onLines={addDraftedLines} />}
          <button type="button" onClick={addBlankLine} className="btn btn-ghost btn-sm">
            <IconPlus size={13} />
            Blank line
          </button>

          {/* On a phone the one Save sits in the bar pinned below. */}
          <div className="ml-auto flex items-center gap-3 max-sm:hidden">
            {dirty && <span className="faint text-xs">Unsaved changes</span>}
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="btn btn-primary btn-sm"
            >
              {pending ? "Saving…" : "Save line items"}
            </button>
          </div>
        </div>
      )}

      {/* Phone (ux-gaps): the total and the one Save stay in reach while
          the lines scroll, sitting above the strip's pinned Next when the
          page has one. */}
      {!readOnly && (
        <div
          className="popover sticky bottom-0 z-30 flex items-center justify-between gap-3 border-t border-[var(--hairline-3)] px-4 py-2.5 sm:hidden [body:has(.dj-next[data-sticky])_&]:bottom-[4.75rem]"
          data-testid="line-items-phone-bar"
        >
          <div className="min-w-0">
            <p className="faint text-xs">{dirty ? "Unsaved changes" : "Quote total"}</p>
            <p className="num text-base font-semibold" data-testid="line-items-phone-total">{formatCents(totals.totalCents)}</p>
          </div>
          <button type="button" onClick={save} disabled={pending || !dirty} className="btn btn-primary min-h-11">
            {pending ? "Saving…" : "Save line items"}
          </button>
        </div>
      )}

      <div className="space-y-3 border-t border-[var(--hairline-3)] p-5">
        <FormError message={state.error} />
        <FormSuccess message={state.success} />

        <div className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--tint-2)] px-4 py-3" data-testid="quote-totals">
          {/* Items / Line discounts / Subtotal / Discount on the whole quote
              / Quote total, each row only when there is something on it, so
              the figures always tie top to bottom. */}
          {totals.lineDiscountCents > 0 && (
            <div className="faint flex items-center justify-between text-xs" data-testid="quote-discount-line">
              <span>Items {formatCents(totals.grossCents)}</span>
              <span className="num text-[var(--ok)]">Line discounts −{formatCents(totals.lineDiscountCents)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="muted text-xs">Subtotal</span>
            <span className="num" data-testid="quote-subtotal">{formatCents(totals.subtotalCents)}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <label className="muted text-xs" htmlFor="quote-discount">
              Discount on the whole quote
            </label>
            <DiscountInput
              id="quote-discount"
              label="Discount on the whole quote"
              state={quoteDiscount}
              onChange={changeQuoteDiscount}
              baseCents={totals.subtotalCents}
              disabled={readOnly}
            />
          </div>
          <div className="flex items-center justify-between border-t border-[var(--hairline-3)] pt-2">
            <span className="text-sm font-semibold">Quote total</span>
            <span className="num text-xl font-semibold" data-testid="quote-total">
              {formatCents(totals.totalCents)}
            </span>
          </div>
        </div>

        {/* Tag rollup — adds up to the subtotal above. A discount on the
            whole quote belongs to no one tag, so it is not shared out. */}
        <div>
          <p className="eyebrow mb-2">
            Totals by tag
            {totals.quoteDiscountCents > 0 && (
              <span className="faint ml-1.5 font-normal normal-case tracking-normal">
                · before the discount on the whole quote
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {LINE_ITEM_TAGS.map((tag) => (
              <div
                key={tag}
                className="rounded-lg border px-3 py-2"
                style={{
                  borderColor: `color-mix(in srgb, ${TAG_COLORS[tag]} 28%, transparent)`,
                  background: `color-mix(in srgb, ${TAG_COLORS[tag]} 8%, transparent)`,
                }}
              >
                <p
                  className="text-[0.68rem] font-semibold"
                  style={{ color: ink(TAG_COLORS[tag]) }}
                >
                  {TAG_LABELS[tag]}
                </p>
                <p className="num mt-0.5 text-sm font-medium">
                  {formatCents(totals.byTag[tag])}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
