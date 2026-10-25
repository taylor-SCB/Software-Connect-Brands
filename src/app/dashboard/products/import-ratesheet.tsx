"use client";

// Import Ratesheet: a distributor's, manufacturer's or software
// provider's price list, read in the browser and shown exactly as it will
// land, product by product, before anything is written. Everything the
// import needs is held in state and posted from a button — never through
// <form action>, which React would empty on a refusal (file, ticks and
// typed prices included).

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { IconCheck, IconUpload, IconX } from "@/components/icons";
import { FormError } from "@/components/ui";
import { formatCents } from "@/lib/format";
import {
  LINKED_SUPPLIER_SUFFIX,
  PLATFORM_SECTION_LABEL,
  PLATFORM_SUPPLIER_PREFIX,
  platformSupplierLabel,
  platformSupplierNamed,
  platformTwin,
  type PlatformSupplier,
} from "@/lib/account-types";
import { readPriceListFile, type SheetTable } from "@/lib/price-list-file";
import {
  COLUMN_ROLES,
  COLUMN_ROLE_LABELS,
  DEFAULT_PRICING,
  MAX_NEW_PRODUCTS,
  MAX_RATESHEET_BYTES,
  basisPointsToPercent,
  describeRule,
  detectTabs,
  guessEffectiveDate,
  guessSupplier,
  headerSignature,
  marginPercent,
  markupPercent,
  parseMoney,
  percentToBasisPoints,
  planRatesheet,
  pricingError,
  priceFromRule,
  setRole,
  type CatalogItem,
  type ColumnRole,
  type ExistingMode,
  type PlanRow,
  type PriceRuleKind,
  type PricingOptions,
  type TabLayout,
} from "@/lib/price-list";
import {
  declineRatesheet,
  importRatesheet,
  loadRatesheetCatalog,
  type CatalogTuple,
} from "./ratesheets/import-actions";

export type RatesheetSupplier = {
  id: string;
  name: string;
  // Linked to an account on Software Connect Brands (linked), and that
  // account still listed (onPlatform).
  linked: boolean;
  onPlatform: boolean;
  contacts: { id: string; name: string; email: string | null; phone: string | null }[];
  priceRule: PriceRuleKind | null;
  priceRuleBasisPoints: number | null;
  ratesheetColumns: Record<string, ColumnRole[]> | null;
};

export type SavedRatesheetFile = {
  id: string;
  fileName: string;
  distributorId: string | null;
};

const NEW = "__new__";
const PAGE = 25;
const NO_CATALOG: CatalogItem[] = [];

type Filter = "all" | "new" | "update" | "up" | "down" | "held" | "below" | "above" | "off";
const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  new: "New",
  update: "You carry",
  up: "Cost up",
  down: "Cost down",
  held: "To check",
  below: "Below cost",
  above: "Above MSRP",
  off: "Not ticked",
};

const MODE_LABELS: Record<ExistingMode, string> = {
  MARGIN: "Keep my margin",
  PRICE: "Keep my price",
  RULE: "Use my rule",
};

function todayIso() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function pct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  // Past four figures it is a unit mix-up, not a number to read.
  if (Math.abs(value) >= 1000) return value > 0 ? "over 999%" : "under −999%";
  return `${Math.round(value * 10) / 10}%`;
}

function matchesFilter(row: PlanRow, filter: Filter) {
  switch (filter) {
    case "all":
      return true;
    case "new":
      return !row.match;
    case "update":
      return !!row.match;
    case "up":
      return row.costChange === "up";
    case "down":
      return row.costChange === "down";
    case "held":
      return !!row.holdReason;
    case "below":
      return row.belowCost;
    case "above":
      return row.aboveList;
    case "off":
      return !row.included;
  }
}

export function ImportRatesheet({
  suppliers,
  platformSuppliers = [],
  savedFile,
  onBack,
  onDone,
}: {
  suppliers: RatesheetSupplier[];
  // Accounts on Software Connect Brands this workspace hasn't linked yet.
  platformSuppliers?: PlatformSupplier[];
  savedFile?: SavedRatesheetFile;
  onBack?: () => void;
  onDone: () => void;
}) {
  // The file
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState(savedFile?.fileName ?? "");
  const [sheets, setSheets] = useState<SheetTable[] | null>(null);
  const [tabs, setTabs] = useState<TabLayout[]>([]);
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false);
  const [rolesEdited, setRolesEdited] = useState(false);
  const [rememberedNote, setRememberedNote] = useState("");
  const [showColumns, setShowColumns] = useState(false);

  // Who sent it
  const [supplierChoice, setSupplierChoice] = useState(savedFile?.distributorId ?? "");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [contactChoice, setContactChoice] = useState("");
  const [newContact, setNewContact] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [effectiveOn, setEffectiveOn] = useState(todayIso());

  // Pricing
  const [pricing, setPricing] = useState<PricingOptions>(DEFAULT_PRICING);
  const [percentText, setPercentText] = useState(basisPointsToPercent(DEFAULT_PRICING.basisPoints));
  const [pricingEdited, setPricingEdited] = useState(false);

  // The rows
  // The catalog rows fetched for one sheet + supplier; `key` says which,
  // so a stale answer never stands in for the current one.
  const [fetched, setFetched] = useState<{ key: string; items: CatalogItem[] }>({ key: "", items: [] });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [forced, setForced] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [visible, setVisible] = useState(PAGE);
  const [markMissing, setMarkMissing] = useState(false);
  const [showMissing, setShowMissing] = useState(false);

  // Submitting
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ kind: "import" | "decline"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [, startCatalog] = useTransition();

  // Picked from "On Software Connect Brands". When a supplier of that
  // name is already on file it is that supplier — its people, its
  // remembered columns and pricing, its products in the preview — because
  // the import links the account onto it (linkPlatformSupplier). Otherwise
  // it is a new supplier, made and linked when the import goes in.
  const platformChoice = supplierChoice.startsWith(PLATFORM_SUPPLIER_PREFIX)
    ? (platformSuppliers.find((item) => `${PLATFORM_SUPPLIER_PREFIX}${item.id}` === supplierChoice) ?? null)
    : null;
  const supplier =
    suppliers.find((item) => item.id === supplierChoice) ?? platformTwin(platformChoice, suppliers);
  const supplierId = supplier?.id ?? null;
  const typedMatch =
    supplierChoice === NEW && newSupplierName.trim()
      ? (suppliers.find((item) => item.name.trim().toLowerCase() === newSupplierName.trim().toLowerCase()) ?? null)
      : null;
  const typedPlatform =
    supplierChoice === NEW && !typedMatch ? platformSupplierNamed(newSupplierName, platformSuppliers) : null;
  // A supplier still to be made has nobody on file, so its point of
  // contact is typed in.
  const newSupplier = (supplierChoice === NEW && !typedMatch) || (platformChoice !== null && !supplier);

  // Only the newest pick may land: a big file picked by mistake and still
  // being read must not replace the right one picked after it.
  const readToken = useRef(0);

  async function takeBytes(name: string, buffer: ArrayBuffer) {
    const token = (readToken.current += 1);
    setReading(true);
    setReadError("");
    setSheets(null);
    setTabs([]);
    setExcluded(new Set());
    setForced(new Set());
    setOverrides({});
    setPriceText({});
    setRolesEdited(false);
    setRememberedNote("");
    const read = await readPriceListFile(name, buffer);
    if (token !== readToken.current) return;
    setReading(false);
    if (!read.ok) {
      setReadError(read.error);
      return;
    }
    const found = detectTabs(read.sheets);
    if (found.length === 0) {
      setReadError(
        "We couldn't find a header row (Part #, Description, Price…) in the first 25 rows of any tab. Decline it below and tell us what it looks like.",
      );
      setSheets(read.sheets);
      return;
    }
    setSheets(read.sheets);
    setTabs(found);
    const guessedDate = guessEffectiveDate(read.sheets, found);
    if (guessedDate) setEffectiveOn(guessedDate);
    const known = supplierChoice && supplierChoice !== NEW ? supplierChoice : guessSupplier(name, read.sheets, found, suppliers);
    if (known) applySupplier(known, read.sheets, true);
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setFile(picked);
    setFileName(picked?.name ?? "");
    setDone(null);
    setError("");
    readToken.current += 1;
    if (!picked) return;
    if (picked.size > MAX_RATESHEET_BYTES) {
      setReading(false);
      setReadError("That file is over 4 MB. Ask the supplier for a smaller export, or split it.");
      setSheets(null);
      setTabs([]);
      return;
    }
    await takeBytes(picked.name, await picked.arrayBuffer());
  }

  // A file already saved under Ratesheets: fetch it once and read it the
  // same way.
  useEffect(() => {
    if (!savedFile) return;
    let cancelled = false;
    (async () => {
      setReading(true);
      const response = await fetch(`/dashboard/products/ratesheets/files/${savedFile.id}`);
      if (cancelled) return;
      if (!response.ok) {
        setReading(false);
        setReadError("That saved file couldn't be opened. Upload it again.");
        return;
      }
      await takeBytes(savedFile.fileName, await response.arrayBuffer());
    })();
    return () => {
      cancelled = true;
    };
    // takeBytes is stable enough for a once-on-open read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedFile?.id]);

  // A supplier picked: their last way of reading a sheet and pricing it.
  function applySupplier(id: string, readSheets: SheetTable[] | null, freshRead: boolean) {
    setSupplierChoice(id);
    setContactChoice("");
    const chosen =
      suppliers.find((item) => item.id === id) ??
      platformTwin(platformSuppliers.find((item) => `${PLATFORM_SUPPLIER_PREFIX}${item.id}` === id) ?? null, suppliers);
    if (!chosen) return;
    if (readSheets && (freshRead || !rolesEdited) && chosen.ratesheetColumns) {
      const remembered = chosen.ratesheetColumns;
      const redetected = detectTabs(readSheets, remembered);
      if (redetected.length > 0) {
        // The columns come from last time; which tabs are ticked stays
        // whatever the person has set on this sheet.
        setTabs((current) =>
          freshRead
            ? redetected
            : redetected.map((tab) => ({
                ...tab,
                included: current.find((mine) => mine.sheetIndex === tab.sheetIndex)?.included ?? tab.included,
              })),
        );
        const reused = redetected.some((tab) => remembered[headerSignature(tab.headers)]);
        setRememberedNote(reused ? `Reading the columns the way you set them for ${chosen.name} last time.` : "");
      }
    }
    if (!pricingEdited && chosen.priceRule) {
      setPricing((current) => ({
        ...current,
        rule: chosen.priceRule!,
        basisPoints: chosen.priceRuleBasisPoints ?? 0,
      }));
      setPercentText(basisPointsToPercent(chosen.priceRuleBasisPoints ?? 0));
    }
  }

  // The products this sheet could touch, fetched whenever the sheet's
  // rows or the supplier change.
  const outline = useMemo(
    () => (sheets && tabs.length ? planRatesheet({ sheets, tabs, catalog: [], supplierId, pricing: DEFAULT_PRICING }) : null),
    [sheets, tabs, supplierId],
  );
  const catalogKey = outline
    ? `${supplierId ?? ""}|${outline.rows.length}|${tabs.map((tab) => `${tab.sheetIndex}:${tab.included}:${tab.roles.join(",")}`).join(";")}`
    : "";
  const catalogReady = !!outline && fetched.key === catalogKey;
  const catalog = catalogReady ? fetched.items : NO_CATALOG;
  useEffect(() => {
    if (!outline) return;
    let cancelled = false;
    startCatalog(async () => {
      // In batches, so a 25,000-row sheet never asks for (or gets back)
      // more than one response can carry; then the supplier's own
      // products a page at a time. Oldest first, as on the server.
      const tuples: CatalogTuple[] = [];
      const names: Record<string, string> = {};
      try {
        for (let start = 0; start < outline.rows.length; start += 5000) {
          const batch = outline.rows.slice(start, start + 5000);
          const answer = await loadRatesheetCatalog({
            skus: batch.map((row) => row.sku ?? "").filter(Boolean),
            names: batch.map((row) => row.name),
          });
          if (cancelled) return;
          tuples.push(...answer.rows);
          Object.assign(names, answer.supplierNames);
        }
        let after: string | null = null;
        while (supplierId) {
          const answer = await loadRatesheetCatalog({ supplierId, after });
          if (cancelled) return;
          tuples.push(...answer.rows);
          Object.assign(names, answer.supplierNames);
          if (!answer.next) break;
          after = answer.next;
        }
      } catch {
        if (!cancelled) setReadError("Couldn't check this sheet against your catalog. Check your connection and pick the file again.");
        return;
      }
      const byId = new Map(tuples.map((tuple) => [tuple[0], tuple]));
      const items: CatalogItem[] = [...byId.values()]
        .sort((a, b) => a[8] - b[8] || a[0].localeCompare(b[0]))
        .map(([id, name, sku, costCents, unitPriceCents, listPriceCents, distributorId, active]) => ({
          id,
          name,
          sku,
          costCents,
          unitPriceCents,
          listPriceCents,
          distributorId,
          distributorName: distributorId ? (names[distributorId] ?? null) : null,
          active,
        }));
      if (!cancelled) setFetched({ key: catalogKey, items });
    });
    return () => {
      cancelled = true;
    };
  }, [outline, supplierId, catalogKey]);

  const plan = useMemo(
    () =>
      sheets && tabs.length
        ? planRatesheet({
            sheets,
            tabs,
            catalog,
            supplierId,
            pricing,
            overrides,
            excluded: [...excluded],
            forced: [...forced],
          })
        : null,
    [sheets, tabs, catalog, supplierId, pricing, overrides, excluded, forced],
  );

  const rows = plan?.rows ?? [];
  const badPrices = Object.entries(priceText).filter(([, text]) => parseMoney(text).cents === null).length;
  const shown = rows.filter((row) => matchesFilter(row, filter));
  const ruleProblem = pricingError(pricing);
  const firstTab = tabs.find((tab) => tab.included) ?? null;
  const noCostColumn = tabs.some((tab) => tab.included && !tab.roles.includes("cost"));
  const example = rows.find((row) => row.costCents !== null || row.listCents !== null) ?? null;
  const exampleMsrp = example ? (example.listCents ?? null) : null;
  const examplePrice = example
    ? priceFromRule(pricing.rule, pricing.basisPoints, example.costCents ?? example.oldCostCents, exampleMsrp)
    : null;
  // Cost above MSRP on most rows almost always means the two columns are
  // the wrong way round.
  const priced = rows.filter((row) => row.costCents !== null && row.listCents !== null);
  const looksSwapped = priced.length >= 3 && priced.filter((row) => row.costCents! > row.listCents!).length / priced.length > 0.5;
  const costUpAll = rows.filter((row) => row.match && row.costChange === "up").length;
  const costDownAll = rows.filter((row) => row.match && row.costChange === "down").length;

  function editPricing(patch: Partial<PricingOptions>) {
    setPricingEdited(true);
    setPricing((current) => ({ ...current, ...patch }));
  }

  function changePercent(value: string) {
    setPercentText(value);
    const bp = percentToBasisPoints(value === "" ? "0" : value);
    if (bp !== null) editPricing({ basisPoints: bp });
  }

  function changeRole(sheetIndex: number, column: number, role: ColumnRole) {
    setRolesEdited(true);
    setRememberedNote("");
    setTabs((current) => setRole(current, sheetIndex, column, role));
  }

  function swapCostAndMsrp() {
    setRolesEdited(true);
    setTabs((current) =>
      current.map((tab) => ({
        ...tab,
        roles: tab.roles.map((role) => (role === "cost" ? "list" : role === "list" ? "cost" : role)),
      })),
    );
  }

  function toggleTab(sheetIndex: number) {
    setTabs((current) => current.map((tab) => (tab.sheetIndex === sheetIndex ? { ...tab, included: !tab.included } : tab)));
  }

  function toggleRow(row: PlanRow) {
    const nextExcluded = new Set(excluded);
    const nextForced = new Set(forced);
    if (row.included) {
      nextExcluded.add(row.key);
      nextForced.delete(row.key);
    } else {
      nextExcluded.delete(row.key);
      nextForced.add(row.key);
    }
    setExcluded(nextExcluded);
    setForced(nextForced);
  }

  function selectAll() {
    setExcluded(new Set());
    setForced(new Set(rows.filter((row) => row.importable).map((row) => row.key)));
  }

  function removeAll() {
    setForced(new Set());
    setExcluded(new Set(rows.map((row) => row.key)));
  }

  // A typed price that doesn't read as one is held on screen (red) and
  // stops the import until it is fixed; it never falls back to the last
  // value that did. Clearing the box goes back to the rule's price.
  function typePrice(row: PlanRow, value: string) {
    const next = { ...overrides };
    const nextText = { ...priceText };
    const money = parseMoney(value);
    if (value.trim() === "") {
      delete next[row.key];
      delete nextText[row.key];
    } else {
      nextText[row.key] = value;
      if (money.cents !== null) next[row.key] = money.cents;
      else delete next[row.key];
    }
    setPriceText(nextText);
    setOverrides(next);
  }

  function buildForm(): FormData {
    const form = new FormData();
    if (savedFile) form.set("savedFileId", savedFile.id);
    else if (file) form.set("file", file);
    if (typedMatch) form.set("supplierId", typedMatch.id);
    else if (supplierChoice === NEW) form.set("newSupplierName", newSupplierName.trim());
    else if (supplierChoice.startsWith(PLATFORM_SUPPLIER_PREFIX))
      form.set("platformSupplierId", supplierChoice.slice(PLATFORM_SUPPLIER_PREFIX.length));
    else if (supplierChoice) form.set("supplierId", supplierChoice);
    form.set(
      "tabs",
      JSON.stringify(tabs.map((tab) => ({ sheetIndex: tab.sheetIndex, included: tab.included, roles: tab.roles }))),
    );
    form.set("pricing", JSON.stringify(pricing));
    return form;
  }

  function submitImport() {
    setError("");
    if (!supplierChoice || (supplierChoice === NEW && !newSupplierName.trim())) {
      setError("Pick who sent this ratesheet: a distributor, manufacturer or software provider.");
      return;
    }
    if (!plan || plan.counts.included === 0) {
      setError("Tick at least one product to import.");
      return;
    }
    if (badPrices > 0) {
      setError(`${badPrices} sell ${badPrices === 1 ? "price doesn't" : "prices don't"} read as a price. Fix ${badPrices === 1 ? "it" : "them"} or clear the box.`);
      return;
    }
    const typingContact = contactChoice === NEW || newSupplier;
    if (
      typingContact &&
      (newContact.email || newContact.phone) &&
      !newContact.firstName.trim() &&
      !newContact.lastName.trim()
    ) {
      setError("Type the point of contact's first or last name.");
      return;
    }
    const form = buildForm();
    if (contactChoice && contactChoice !== NEW && supplier) form.set("contactId", contactChoice);
    else if (contactChoice === NEW || newSupplier) {
      if (newContact.firstName || newContact.lastName || newContact.email || newContact.phone) {
        form.set("newContact", JSON.stringify(newContact));
      }
    }
    form.set("effectiveOn", effectiveOn);
    form.set("overrides", JSON.stringify(overrides));
    form.set("selected", JSON.stringify(rows.filter((row) => row.included).map((row) => row.key)));
    if (markMissing) form.set("markMissingInactive", "1");
    startTransition(async () => {
      try {
        const result = await importRatesheet(form);
        if (result.ok) setDone({ kind: "import", message: result.message });
        else setError(result.error);
      } catch {
        setError("The import didn't reach the server. Check your connection and try again — nothing was changed on this screen.");
      }
    });
  }

  function submitDecline() {
    setError("");
    if (!note.trim()) {
      setError("Tell us what was wrong with the import, so we can fix how it reads this sheet.");
      return;
    }
    const form = buildForm();
    form.set("note", note.trim());
    if (file && file.size > MAX_RATESHEET_BYTES) {
      // Too big to send: we get its name and size, and the note.
      form.delete("file");
      form.set("fileName", file.name);
      form.set("fileSize", String(file.size));
    }
    startTransition(async () => {
      try {
        const result = await declineRatesheet(form);
        if (result.ok) setDone({ kind: "decline", message: result.message });
        else setError(result.error);
      } catch {
        setError("That didn't reach the server. Check your connection and try again.");
      }
    });
  }

  if (done) {
    return (
      <div className="mt-4 space-y-4" data-testid="ratesheet-done">
        <div className="flex items-start gap-3 rounded-xl border border-[rgb(52_211_153/0.3)] bg-[rgb(52_211_153/0.09)] px-4 py-3">
          <IconCheck size={16} className="mt-0.5 shrink-0 text-[var(--ok)]" />
          <div>
            <p className="text-sm font-semibold">{done.message}</p>
            <p className="faint mt-1 text-xs">
              {done.kind === "import"
                ? "They're in your Products list, and the file is saved under Ratesheets."
                : "Your catalog wasn't touched."}
            </p>
          </div>
        </div>
        <button type="button" onClick={onDone} className="btn btn-primary btn-sm">
          Done
        </button>
      </div>
    );
  }

  const measure = pricing.rule === "MARKUP" ? "Markup" : "Margin";

  return (
    <div className="mt-4 space-y-4">
      {/* 1. The file */}
      {!savedFile && (
        <div>
          <label className="label" htmlFor="ratesheet-import-file">
            Ratesheet file
          </label>
          <input
            id="ratesheet-import-file"
            type="file"
            accept=".xlsx,.xlsm,.csv,.txt,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={onFile}
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-2)] file:px-2.5 file:py-1 file:text-xs file:text-[var(--text)]"
          />
          <p className="faint mt-1 text-xs">
            Excel or CSV from your distributor, manufacturer or software provider, up to 4 MB. The price on it
            becomes <strong>your cost</strong>; their MSRP is kept beside it.{" "}
            <a href="/dashboard/products/import-template" download className="link">
              Example layout
            </a>
            .
          </p>
        </div>
      )}
      {savedFile && <p className="text-sm">{fileName}</p>}
      {reading && <p className="faint text-xs">Reading {fileName}…</p>}
      <FormError message={readError} />

      {sheets && tabs.length > 0 && plan && (
        <>
          {/* 2. Who sent it */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="ratesheet-supplier">
                Who sent it?
              </label>
              <select
                id="ratesheet-supplier"
                value={supplierChoice}
                onChange={(event) => applySupplier(event.target.value, sheets, false)}
                className="select"
              >
                <option value="" disabled>
                  Choose who sent it…
                </option>
                {suppliers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.onPlatform ? LINKED_SUPPLIER_SUFFIX : ""}
                  </option>
                ))}
                {platformSuppliers.length > 0 && (
                  <optgroup label={PLATFORM_SECTION_LABEL}>
                    {platformSuppliers.map((item) => (
                      <option key={item.id} value={`${PLATFORM_SUPPLIER_PREFIX}${item.id}`}>
                        {platformSupplierLabel(item)}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={NEW}>+ Add New Distributor</option>
              </select>
              <p className="faint mt-1 text-xs">Distributor, manufacturer or software provider.</p>
              {supplierChoice === NEW && (
                <>
                  <input
                    aria-label="New distributor name"
                    placeholder="Distributor name"
                    value={newSupplierName}
                    onChange={(event) => setNewSupplierName(event.target.value)}
                    className="input mt-2"
                    autoFocus
                  />
                  {typedMatch && (
                    <button
                      type="button"
                      onClick={() => {
                        applySupplier(typedMatch.id, sheets, false);
                        setNewSupplierName("");
                      }}
                      className="btn btn-ghost btn-sm mt-2"
                    >
                      Use {typedMatch.name} (already in your list)
                    </button>
                  )}
                  {typedPlatform && (
                    <button
                      type="button"
                      onClick={() => {
                        applySupplier(`${PLATFORM_SUPPLIER_PREFIX}${typedPlatform.id}`, sheets, false);
                        setNewSupplierName("");
                      }}
                      className="btn btn-ghost btn-sm mt-2"
                    >
                      Use {typedPlatform.name} (on Software Connect Brands)
                    </button>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="label" htmlFor="ratesheet-effective">
                Prices effective
              </label>
              <input
                id="ratesheet-effective"
                type="date"
                value={effectiveOn}
                onChange={(event) => setEffectiveOn(event.target.value)}
                className="input"
              />
            </div>
          </div>

          {/* Point of contact, optional */}
          {supplierChoice && (
            <div>
              <label className="label" htmlFor="ratesheet-contact">
                Point of contact<span className="faint font-normal"> · optional</span>
              </label>
              {supplier && supplier.contacts.length > 0 && (
                <select
                  id="ratesheet-contact"
                  value={contactChoice}
                  onChange={(event) => setContactChoice(event.target.value)}
                  className="select"
                >
                  <option value="">No one in particular</option>
                  {supplier.contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                      {contact.email ? ` · ${contact.email}` : ""}
                    </option>
                  ))}
                  <option value={NEW}>+ Add new contact</option>
                </select>
              )}
              {supplier && supplier.contacts.length === 0 && contactChoice !== NEW && (
                <button type="button" onClick={() => setContactChoice(NEW)} className="btn btn-ghost btn-sm">
                  + Add point of contact
                </button>
              )}
              {(contactChoice === NEW || newSupplier) && (
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <input
                    aria-label="Contact first name"
                    placeholder="First name"
                    value={newContact.firstName}
                    onChange={(event) => setNewContact({ ...newContact, firstName: event.target.value })}
                    className="input"
                  />
                  <input
                    aria-label="Contact last name"
                    placeholder="Last name"
                    value={newContact.lastName}
                    onChange={(event) => setNewContact({ ...newContact, lastName: event.target.value })}
                    className="input"
                  />
                  <input
                    aria-label="Contact email"
                    type="email"
                    placeholder="Email"
                    value={newContact.email}
                    onChange={(event) => setNewContact({ ...newContact, email: event.target.value })}
                    className="input"
                  />
                  <input
                    aria-label="Contact phone"
                    type="tel"
                    placeholder="Phone"
                    value={newContact.phone}
                    onChange={(event) => setNewContact({ ...newContact, phone: event.target.value })}
                    className="input"
                  />
                </div>
              )}
            </div>
          )}

          {/* 3. What we read */}
          <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4">
            {tabs.length > 1 && (
              <div className="flex flex-wrap gap-3 text-xs" data-testid="ratesheet-tabs">
                {tabs.map((tab) => (
                  <label key={tab.sheetIndex} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={tab.included} onChange={() => toggleTab(tab.sheetIndex)} />
                    {tab.name} <span className="faint">({tab.dataRows.toLocaleString()})</span>
                  </label>
                ))}
              </div>
            )}
            {firstTab && (
              <p className="faint text-xs" data-testid="ratesheet-columns">
                {COLUMN_ROLES.filter((role) => role !== "skip" && firstTab.roles.includes(role))
                  .map((role) => `${COLUMN_ROLE_LABELS[role]} ← "${firstTab.headers[firstTab.roles.indexOf(role)]}"`)
                  .join(" · ")}{" "}
                <button type="button" onClick={() => setShowColumns(!showColumns)} className="link">
                  {showColumns ? "Done" : "Change"}
                </button>
              </p>
            )}
            {rememberedNote && <p className="faint text-xs">{rememberedNote}</p>}
            {noCostColumn && (
              <p role="alert" className="text-xs text-[var(--warn)]">
                Which column is your cost? We couldn&apos;t tell — pick it under Change.
              </p>
            )}
            {looksSwapped && (
              <p role="alert" className="text-xs text-[var(--warn)]">
                Your cost is higher than MSRP on most rows — are those two the wrong way round?{" "}
                <button type="button" onClick={swapCostAndMsrp} className="link">
                  Swap them
                </button>
              </p>
            )}
            {(showColumns || noCostColumn) &&
              tabs
                .filter((tab) => tab.included)
                .map((tab) => (
                  <div key={tab.sheetIndex} className="grid gap-2 pt-1 sm:grid-cols-2">
                    {tabs.filter((other) => other.included).length > 1 && (
                      <p className="eyebrow sm:col-span-2">{tab.name}</p>
                    )}
                    {tab.headers.map((header, column) => {
                      const sample = sheets[tab.sheetIndex].rows
                        .slice(tab.headerIndex + 1, tab.headerIndex + 6)
                        .map((row) => row.cells[column])
                        .find((value) => value && value.trim());
                      return (
                        <label key={column} className="flex items-center gap-2 text-xs">
                          <span className="w-2/5 truncate" title={header}>
                            {header || `Column ${column + 1}`}
                            {sample && <span className="faint"> · {sample}</span>}
                          </span>
                          <select
                            aria-label={`Column ${header || column + 1}`}
                            value={tab.roles[column]}
                            onChange={(event) => changeRole(tab.sheetIndex, column, event.target.value as ColumnRole)}
                            className="select input-sm flex-1"
                          >
                            {COLUMN_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {COLUMN_ROLE_LABELS[role]}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                ))}
          </div>

          {/* 4. Your price */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label" htmlFor="ratesheet-rule">
                  Your sell price
                </label>
                <select
                  id="ratesheet-rule"
                  value={pricing.rule}
                  onChange={(event) => editPricing({ rule: event.target.value as PriceRuleKind })}
                  className="select"
                >
                  <option value="MARKUP">Markup on my cost</option>
                  <option value="MARGIN">Margin</option>
                  <option value="LIST">Their MSRP, less</option>
                </select>
              </div>
              <div className="w-24">
                <label className="label" htmlFor="ratesheet-percent">
                  %
                </label>
                <input
                  id="ratesheet-percent"
                  inputMode="decimal"
                  value={percentText}
                  onChange={(event) => changePercent(event.target.value)}
                  className="input"
                />
              </div>
            </div>
            <FormError message={ruleProblem ?? undefined} />
            {example && examplePrice !== null && !ruleProblem && (
              <p className="faint text-xs" data-testid="ratesheet-example">
                {describeRule(pricing)}
                {pricing.rule === "MARKUP" && example.costCents !== null && ` = ${pct(marginPercent(example.costCents, examplePrice))} margin`}
                {pricing.rule === "MARGIN" && example.costCents !== null && ` = ${pct(markupPercent(example.costCents, examplePrice))} markup`}
                {" · "}
                {example.sku ?? example.name}: {example.costCents !== null ? formatCents(example.costCents) : "—"} →{" "}
                {formatCents(examplePrice)}
              </p>
            )}
            {(costUpAll > 0 || costDownAll > 0) && (
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                {costUpAll > 0 && (
                  <label className="flex items-center gap-2">
                    <span className="w-1/2">
                      Cost went up on <strong>{costUpAll}</strong> you carry:
                    </span>
                    <select
                      aria-label="When cost went up"
                      value={pricing.whenCostUp}
                      onChange={(event) => editPricing({ whenCostUp: event.target.value as ExistingMode })}
                      className="select input-sm flex-1"
                    >
                      {(["MARGIN", "PRICE", "RULE"] as const).map((mode) => (
                        <option key={mode} value={mode}>
                          {MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {costDownAll > 0 && (
                  <label className="flex items-center gap-2">
                    <span className="w-1/2">
                      Cost went down on <strong>{costDownAll}</strong>:
                    </span>
                    <select
                      aria-label="When cost went down"
                      value={pricing.whenCostDown}
                      onChange={(event) => editPricing({ whenCostDown: event.target.value as ExistingMode })}
                      className="select input-sm flex-1"
                    >
                      {(["PRICE", "MARGIN", "RULE"] as const).map((mode) => (
                        <option key={mode} value={mode}>
                          {MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>

          {/* 5. Every product, as it will land */}
          <div className="space-y-2">
            <p className="text-sm font-semibold" data-testid="ratesheet-summary">
              {rows.length.toLocaleString()} {rows.length === 1 ? "product" : "products"} on the sheet ·{" "}
              {plan.counts.included.toLocaleString()} ticked
              {!catalogReady && <span className="faint font-normal"> · matching your catalog…</span>}
            </p>
            {(plan.skippedBlank > 0 || plan.skippedDuplicates > 0 || plan.truncated > 0 || plan.counts.tooManyNew > 0) && (
              <p className="faint text-xs">
                {[
                  plan.skippedBlank > 0 && `${plan.skippedBlank.toLocaleString()} blank or heading rows skipped`,
                  plan.skippedDuplicates > 0 && `${plan.skippedDuplicates.toLocaleString()} repeated rows skipped`,
                  plan.truncated > 0 && `${plan.truncated.toLocaleString()} rows past the 25,000-row limit not read`,
                  plan.counts.tooManyNew > 0 && `${plan.counts.tooManyNew.toLocaleString()} new products past the ${MAX_NEW_PRODUCTS.toLocaleString()} limit left out`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => {
                const count = key === "all" ? rows.length : rows.filter((row) => matchesFilter(row, key)).length;
                if (key !== "all" && count === 0) return null;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setFilter(key);
                      setVisible(PAGE);
                    }}
                    className={`btn btn-sm ${filter === key ? "btn-primary" : "btn-ghost"}`}
                    data-testid={`ratesheet-filter-${key}`}
                  >
                    {FILTER_LABELS[key]} {count.toLocaleString()}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={selectAll} className="btn btn-ghost btn-sm">
                Select all
              </button>
              <button type="button" onClick={removeAll} className="btn btn-ghost btn-sm">
                Remove all
              </button>
            </div>

            <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
              {shown.slice(0, visible).map((row) => (
                <li key={row.key} className="flex items-start gap-3 px-3 py-2.5" data-testid="ratesheet-row">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={row.included}
                    disabled={!row.importable}
                    onChange={() => toggleRow(row)}
                    aria-label={`Import ${row.name}`}
                  />
                  {/* On a phone the numbers drop under the name instead of
                      squeezing it to a few letters. */}
                  <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
                    <div className="min-w-0 sm:flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="faint text-xs">
                        {row.sku ?? "No part #"} · {row.match ? `updates ${row.match.name === row.name ? "your product" : `"${row.match.name}"`}` : "new"}
                        {tabs.filter((tab) => tab.included).length > 1 && ` · ${row.tab}`} · line {row.line}
                      </p>
                      {row.holdReason && <p className="text-xs text-[var(--warn)]">{row.holdReason}</p>}
                      {row.notes.map((text) => (
                        <p key={text} className="faint text-xs">
                          {text}
                        </p>
                      ))}
                    </div>
                    <div className="mt-2 flex justify-end gap-3 sm:mt-0">
                      <div className="w-24 shrink-0 text-right text-xs">
                        <p className="faint">Your cost</p>
                        <p className="num">
                          {row.match && row.costChange !== "same" && row.costChange !== "none" && row.oldCostCents !== null && (
                            <span className="faint line-through">{formatCents(row.oldCostCents)} </span>
                          )}
                          {row.match || row.costCents !== null ? formatCents(row.newCostCents) : "—"}
                        </p>
                        {row.listCents !== null && <p className="faint">MSRP {formatCents(row.listCents)}</p>}
                      </div>
                      <div className="w-28 shrink-0 text-right text-xs">
                        <label className="faint" htmlFor={`price-${row.key}`}>
                          Sell price
                        </label>
                        <input
                          id={`price-${row.key}`}
                          inputMode="decimal"
                          value={priceText[row.key] ?? (row.newPriceCents !== null ? (row.newPriceCents / 100).toFixed(2) : "")}
                          placeholder="Type one"
                          onChange={(event) => typePrice(row, event.target.value)}
                          aria-invalid={priceText[row.key] !== undefined && parseMoney(priceText[row.key]).cents === null}
                      className={`input input-sm num text-right ${
                        row.belowCost || (priceText[row.key] !== undefined && parseMoney(priceText[row.key]).cents === null)
                          ? "!border-[var(--danger)]"
                          : ""
                      }`}
                        />
                        <p className={row.belowCost ? "text-[var(--danger)]" : "faint"}>
                          {row.newPriceCents !== null
                            ? `${measure} ${pct(
                                pricing.rule === "MARKUP"
                                  ? markupPercent(row.newCostCents, row.newPriceCents)
                                  : marginPercent(row.newCostCents, row.newPriceCents),
                              )}`
                            : "—"}
                          {row.aboveList && " · over MSRP"}
                        </p>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {shown.length === 0 && <li className="faint px-3 py-4 text-center text-xs">Nothing here.</li>}
            </ul>
            {shown.length > visible && (
              <button type="button" onClick={() => setVisible(visible + PAGE * 4)} className="btn btn-ghost btn-sm">
                Show more ({(shown.length - visible).toLocaleString()} left)
              </button>
            )}

            {plan.missing && plan.missing.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] px-3 py-2.5 text-xs">
                <p>
                  <strong>{plan.missing.length.toLocaleString()}</strong> {plan.missing.length === 1 ? "product" : "products"} you buy
                  from {supplier?.name ?? "this supplier"} {plan.missing.length === 1 ? "isn't" : "aren't"} on this sheet
                  anymore.{" "}
                  <button type="button" onClick={() => setShowMissing(!showMissing)} className="link">
                    {showMissing ? "Hide" : "Show"}
                  </button>
                </p>
                {showMissing && (
                  <ul className="faint mt-1 list-disc pl-4">
                    {plan.missing.slice(0, 50).map((item) => (
                      <li key={item.id}>
                        {item.name}
                        {item.sku ? ` (${item.sku})` : ""}
                      </li>
                    ))}
                    {plan.missing.length > 50 && <li>…and {(plan.missing.length - 50).toLocaleString()} more.</li>}
                  </ul>
                )}
                <label className="mt-1 flex items-center gap-2">
                  <input type="checkbox" checked={markMissing} onChange={(event) => setMarkMissing(event.target.checked)} />
                  Mark them inactive
                </label>
              </div>
            )}
          </div>
        </>
      )}

      {/* Decline: tell us what read wrong */}
      {(sheets || readError) && declining && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-4">
          <label className="label" htmlFor="ratesheet-decline-note">
            What was wrong with this import?
          </label>
          <textarea
            id="ratesheet-decline-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="The MSRP came in as my cost… / It missed the second tab… / Prices are per 100…"
            className="input"
          />
          <p className="faint text-xs">Nothing is imported. We get the file and your note and fix how it reads sheets like this one.</p>
        </div>
      )}

      <FormError message={error} />

      {(sheets || readError) && fileName && (
        <div className="popover sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-wrap items-center gap-2 rounded-b-xl px-5 py-3">
          {!declining ? (
            <>
              <button
                type="button"
                onClick={submitImport}
                disabled={pending || !plan || plan.counts.included === 0 || !!ruleProblem || !catalogReady}
                className="btn btn-pink btn-sm"
                data-testid="ratesheet-import"
              >
                <IconUpload size={13} />
                {pending
                  ? "Importing…"
                  : `Import ${(plan?.counts.included ?? 0).toLocaleString()} ${plan?.counts.included === 1 ? "product" : "products"}`}
                {plan && plan.counts.belowCost > 0 && ` · ${plan.counts.belowCost} below cost`}
              </button>
              <button type="button" onClick={() => setDeclining(true)} className="btn btn-ghost btn-sm">
                <IconX size={13} />
                Decline
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={submitDecline} disabled={pending} className="btn btn-primary btn-sm">
                {pending ? "Sending…" : "Send and don't import"}
              </button>
              <button type="button" onClick={() => setDeclining(false)} className="btn btn-ghost btn-sm">
                Back to the import
              </button>
            </>
          )}
          {onBack && !declining && (
            <button type="button" onClick={onBack} className="btn btn-ghost btn-sm ml-auto">
              Back
            </button>
          )}
        </div>
      )}
      {!fileName && onBack && (
        <button type="button" onClick={onBack} className="btn btn-ghost btn-sm">
          Back
        </button>
      )}
    </div>
  );
}
