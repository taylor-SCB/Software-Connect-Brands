"use client";

import { startTransition, useActionState, useState } from "react";
import {
  Card,
  CardHeader,
  Field,
  TextareaField,
  FormError,
  FormSuccess,
} from "@/components/ui";
import {
  LINE_ITEM_TAGS,
  TAG_LABELS,
  UNIT_GROUPS,
  UNIT_GROUP_LABELS,
  UNIT_LABELS,
  isSoftwareUnit,
  tagHasUnits,
  unitAllowedForTag,
  unitGroupsForTag,
  SOFTWARE_RATES,
  SOFTWARE_RATE_LABELS,
  SOFTWARE_TERM_NOUNS,
  type UnitGroup,
  type SoftwareRateValue,
} from "@/lib/constants";
import { centsToDollarInput, dollarsToCents, formatCents } from "@/lib/format";
import { marginPercent, markupPercent, percentToBasisPoints, priceFromRule } from "@/lib/price-list";
import { IconPlus, IconTrash, IconMail, IconPhone, IconEdit, IconCheck } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
import {
  LINKED_SUPPLIER_SUFFIX,
  PLATFORM_SECTION_LABEL,
  PLATFORM_SUPPLIER_PREFIX,
  platformSupplierLabel,
  platformSupplierNamed,
  platformTwin,
  type PlatformSupplier,
} from "@/lib/account-types";

export type FormManufacturer = { id: string; name: string };
export type FormDistributorContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};
export type FormDistributor = {
  id: string;
  name: string;
  // Linked to an account on Software Connect Brands (linked), and that
  // account still listed (onPlatform).
  linked?: boolean;
  onPlatform?: boolean;
  contacts: FormDistributorContact[];
};

export type ProductFormDefaults = {
  id?: string;
  name?: string;
  description?: string;
  sku?: string | null;
  unitPriceCents?: number;
  costCents?: number;
  listPriceCents?: number | null;
  defaultTag?: string;
  serviceType?: string | null;
  unitOfMeasure?: string | null;
  softwareRate?: string | null;
  softwareTerm?: number | null;
  manufacturerId?: string | null;
  distributorId?: string | null;
  contactIds?: string[];
  active?: boolean;
};

// Sentinel option value meaning "let me type a new one".
const NEW = "__new__";

const TAG_OPTIONS = LINE_ITEM_TAGS.map((tag) => ({ value: tag, label: TAG_LABELS[tag] }));

type NewContact = { uid: string; name: string; email: string; phone: string };
type ContactEdit = { name: string; email: string; phone: string };

let uidCounter = 0;
const nextUid = () => `contact-${(uidCounter += 1)}`;

export function ProductForm({
  action,
  defaults,
  submitLabel,
  manufacturers,
  distributors,
  platformSuppliers = [],
  serviceTypes,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: ProductFormDefaults;
  submitLabel: string;
  manufacturers: FormManufacturer[];
  distributors: FormDistributor[];
  // Accounts on Software Connect Brands this workspace hasn't linked yet.
  platformSuppliers?: PlatformSupplier[];
  serviceTypes: string[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const active = defaults?.active ?? true;

  // Everything that reveals or hides another control is held in state;
  // plain text fields stay uncontrolled like the rest of the app's forms.
  const [manufacturerId, setManufacturerId] = useState(defaults?.manufacturerId ?? "");
  const [tag, setTag] = useState(defaults?.defaultTag ?? "MATERIALS");
  const [unit, setUnit] = useState(defaults?.unitOfMeasure ?? "");
  // Set when a tag change had to drop the unit, so the blank field is
  // explained rather than silently emptied.
  const [unitCleared, setUnitCleared] = useState(false);
  const allowedGroups = unitGroupsForTag(tag);
  const hasUnits = tagHasUnits(tag);

  function changeTag(next: string) {
    setTag(next);
    if (!tagHasUnits(next)) {
      // No unit field at all for these tags, so nothing to explain.
      setUnit("");
      setUnitCleared(false);
    } else if (!unitAllowedForTag(unit, next)) {
      setUnit("");
      setUnitCleared(unit !== "");
    }
  }

  function changeUnit(next: string) {
    setUnit(next);
    setUnitCleared(false);
  }
  const [rate, setRate] = useState<SoftwareRateValue>(
    (defaults?.softwareRate as SoftwareRateValue | null) ?? "PER_MONTH",
  );
  const [term, setTerm] = useState(defaults?.softwareTerm ? String(defaults.softwareTerm) : "");
  const [unitPrice, setUnitPrice] = useState(
    defaults?.unitPriceCents !== undefined ? centsToDollarInput(defaults.unitPriceCents) : "",
  );

  // COGS, markup, margin and price are one thing seen four ways. Type the
  // price and the two percentages follow; type a percentage and the price
  // follows, and keeps following when the cost changes — until the price
  // is typed again. The percentages are never stored, only worked out.
  const [cost, setCost] = useState(
    defaults?.costCents !== undefined ? centsToDollarInput(defaults.costCents) : "",
  );
  const [anchor, setAnchor] = useState<"price" | "markup" | "margin">("price");
  // Held in state like the price, so a refused save doesn't wipe it.
  const [listPrice, setListPrice] = useState(
    defaults?.listPriceCents !== undefined && defaults.listPriceCents !== null ? centsToDollarInput(defaults.listPriceCents) : "",
  );
  const roundPct = (value: number | null) => (value === null ? "" : String(Math.round(value * 100) / 100));
  const [markupText, setMarkupText] = useState(() =>
    defaults?.costCents && defaults.unitPriceCents ? roundPct(markupPercent(defaults.costCents, defaults.unitPriceCents)) : "",
  );
  const [marginText, setMarginText] = useState(() =>
    defaults?.costCents && defaults.unitPriceCents ? roundPct(marginPercent(defaults.costCents, defaults.unitPriceCents)) : "",
  );

  function followFrom(costCents: number, priceCents: number) {
    setMarkupText(costCents > 0 && priceCents > 0 ? roundPct(markupPercent(costCents, priceCents)) : "");
    setMarginText(costCents > 0 && priceCents > 0 ? roundPct(marginPercent(costCents, priceCents)) : "");
  }

  function priceFrom(kind: "MARKUP" | "MARGIN", percent: string, costCents: number) {
    const bp = percentToBasisPoints(percent);
    if (bp === null || costCents <= 0 || (kind === "MARGIN" && bp >= 10_000)) return null;
    return priceFromRule(kind, bp, costCents, null);
  }

  function changeCost(value: string) {
    setCost(value);
    const costCents = dollarsToCents(value);
    if (anchor !== "price") {
      const next = priceFrom(anchor === "markup" ? "MARKUP" : "MARGIN", anchor === "markup" ? markupText : marginText, costCents);
      if (next !== null) {
        setUnitPrice(centsToDollarInput(next));
        if (anchor === "markup") setMarginText(roundPct(marginPercent(costCents, next)));
        else setMarkupText(roundPct(markupPercent(costCents, next)));
      }
      // While the cost is being retyped (blank, or a single digit on the
      // way to 100), the percentage typed is what holds — it is never
      // recomputed from a half-typed cost.
      return;
    }
    followFrom(costCents, dollarsToCents(unitPrice));
  }

  // Why a typed percentage isn't moving the price, said next to it.
  const percentProblem = (() => {
    const text = anchor === "markup" ? markupText : anchor === "margin" ? marginText : "";
    if (!text.trim()) return null;
    const bp = percentToBasisPoints(text);
    if (bp === null) return "Type a percentage of 0 or more, like 35 or 33.33.";
    if (anchor === "margin" && bp >= 10_000) return "Margin has to be under 100%.";
    if (dollarsToCents(cost) <= 0) return "Type the COGS and the price follows.";
    return null;
  })();

  function changePercent(kind: "markup" | "margin", value: string) {
    setAnchor(kind);
    if (kind === "markup") setMarkupText(value);
    else setMarginText(value);
    const costCents = dollarsToCents(cost);
    const next = priceFrom(kind === "markup" ? "MARKUP" : "MARGIN", value, costCents);
    if (next === null) return;
    setUnitPrice(centsToDollarInput(next));
    if (kind === "markup") setMarginText(roundPct(marginPercent(costCents, next)));
    else setMarkupText(roundPct(markupPercent(costCents, next)));
  }

  function changePrice(value: string) {
    setUnitPrice(value);
    setAnchor("price");
    followFrom(dollarsToCents(cost), dollarsToCents(value));
  }

  const [distributorId, setDistributorId] = useState(defaults?.distributorId ?? "");
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(
    () => new Set(defaults?.contactIds ?? []),
  );
  const [newContacts, setNewContacts] = useState<NewContact[]>([]);
  const [contactEdits, setContactEdits] = useState<Record<string, ContactEdit>>({});

  const software = isSoftwareUnit(unit);
  const termCount = Number.parseInt(term, 10);
  const priceCents = dollarsToCents(unitPrice);
  const totalCents =
    software && Number.isInteger(termCount) && termCount > 0 ? priceCents * termCount : null;

  // An account picked from Software Connect Brands that a supplier of the
  // same name is already on file for: that supplier, people and all.
  const platformPick = distributorId.startsWith(PLATFORM_SUPPLIER_PREFIX)
    ? (platformSuppliers.find((item) => `${PLATFORM_SUPPLIER_PREFIX}${item.id}` === distributorId) ?? null)
    : null;
  const twin = platformTwin(platformPick, distributors);
  const distributor = distributors.find((item) => item.id === distributorId) ?? twin;
  const showContacts = distributorId !== "";

  // A successful save re-renders this form with fresh props: the contacts
  // just created are now ordinary rows in `distributors`, and
  // `defaults.contactIds` includes them. Local state has to catch up, or
  // a second Save would create the same people again and drop the links
  // the first save made. Done during render (React's "adjusting state
  // when a prop changes" pattern) rather than in an effect, so there is
  // no frame where the stale rows are still on screen.
  // The same goes for the distributor: one typed in with "+ Add new" or
  // picked from Software Connect Brands is an ordinary row once saved, and
  // the box has to point at that row — its old value is no longer among
  // the options, and a <select> showing a value it doesn't have falls
  // back to the first one, which the next Save would write.
  const savedDistributorId = defaults?.distributorId ?? "";
  const choosingNew = distributorId === NEW || distributorId.startsWith(PLATFORM_SUPPLIER_PREFIX);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.success) {
      setNewContacts([]);
      setContactEdits({});
      setSelectedContacts(new Set(defaults?.contactIds ?? []));
      if (choosingNew) setDistributorId(savedDistributorId);
    }
  }
  const [seenSaved, setSeenSaved] = useState(savedDistributorId);
  if (savedDistributorId !== seenSaved) {
    setSeenSaved(savedDistributorId);
    if (choosingNew || distributorId === seenSaved) setDistributorId(savedDistributorId);
  }
  const [typedDistributor, setTypedDistributor] = useState("");
  const typedPlatform =
    distributorId === NEW &&
    !distributors.some((item) => item.name.trim().toLowerCase() === typedDistributor.trim().toLowerCase())
      ? platformSupplierNamed(typedDistributor, platformSuppliers)
      : null;

  // The supplier a box value means: a platform pick with a same-named
  // supplier on file means that supplier.
  function supplierFor(value: string) {
    if (!value.startsWith(PLATFORM_SUPPLIER_PREFIX)) return value;
    const pick = platformSuppliers.find((item) => `${PLATFORM_SUPPLIER_PREFIX}${item.id}` === value) ?? null;
    return platformTwin(pick, distributors)?.id ?? value;
  }

  function changeDistributor(next: string) {
    const same = supplierFor(next) === supplierFor(distributorId);
    setDistributorId(next);
    // The same supplier picked from the other list keeps its people.
    if (same) return;
    // A different distributor means different people; nothing carries over.
    setSelectedContacts(new Set());
    setContactEdits({});
    setNewContacts([]);
  }

  function toggleContact(id: string) {
    setSelectedContacts((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function beginEdit(contact: FormDistributorContact) {
    setContactEdits((current) => ({
      ...current,
      [contact.id]: {
        name: contact.name,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
      },
    }));
  }

  function patchEdit(id: string, patch: Partial<ContactEdit>) {
    setContactEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function addNewContact() {
    setNewContacts((current) => [...current, { uid: nextUid(), name: "", email: "", phone: "" }]);
  }

  function patchNewContact(uid: string, patch: Partial<NewContact>) {
    setNewContacts((current) =>
      current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)),
    );
  }

  function removeNewContact(uid: string) {
    setNewContacts((current) => current.filter((row) => row.uid !== uid));
  }

  // Only rows with a name are sent; a blank "+ Add contact" row the user
  // never filled in shouldn't block saving the product.
  const newContactsPayload = JSON.stringify(
    newContacts
      .filter((row) => row.name.trim() !== "")
      .map(({ name, email, phone }) => ({ name: name.trim(), email: email.trim(), phone: phone.trim() })),
  );
  const contactEditsPayload = JSON.stringify(
    Object.entries(contactEdits).map(([id, edit]) => ({
      id,
      name: edit.name.trim(),
      email: edit.email.trim(),
      phone: edit.phone.trim(),
    })),
  );

  return (
    <form
      // `action` posts the form before the page's JavaScript has loaded;
      // once it has, onSubmit takes over and sends the same data inside a
      // transition, which React does not follow with a form reset. A reset
      // puts every <select> back on the option the page first loaded with
      // while the box's state still says otherwise: after a save the tag,
      // unit and distributor boxes showed the old values and the next Save
      // wrote them back, and after a refusal every typed field was emptied.
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className="space-y-5"
    >
      {defaults?.id && <input type="hidden" name="productId" value={defaults.id} />}
      <input type="hidden" name="newContacts" value={newContactsPayload} />
      <input type="hidden" name="contactEdits" value={contactEditsPayload} />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ---------- Main table ---------- */}
        <Card lit className="lg:col-span-2">
          <CardHeader title="Product details" />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Row 1 */}
              <Field
                label="Product name"
                name="name"
                placeholder="Journeyman labor — hourly"
                defaultValue={defaults?.name ?? ""}
                required
              />
              <div>
                <label className="label" htmlFor="defaultTag">
                  Default tag
                </label>
                <select
                  id="defaultTag"
                  name="defaultTag"
                  value={tag}
                  onChange={(event) => changeTag(event.target.value)}
                  className="select"
                >
                  {TAG_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="faint mt-1 text-xs">
                  Pre-selects the category on a quote line, and picks which unit list applies.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="serviceType">
                  Service type
                  <span className="faint font-normal"> · optional</span>
                </label>
                <select
                  id="serviceType"
                  name="serviceType"
                  defaultValue={defaults?.serviceType ?? ""}
                  className="select"
                  data-testid="product-service-type"
                >
                  <option value="">— None —</option>
                  {serviceTypes.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  {/* A saved type that has since left the list is offered
                      back, or saving the form would quietly clear it. */}
                  {defaults?.serviceType && !serviceTypes.includes(defaults.serviceType) && (
                    <option value={defaults.serviceType}>{defaults.serviceType} (no longer in your list)</option>
                  )}
                </select>
                <p className="faint mt-1 text-xs">
                  The kind of work this is sold under. A quote line picks it up, and a won job gives
                  each kind its own budget.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="manufacturerId">
                  OEM / Manufacturer
                </label>
                <select
                  id="manufacturerId"
                  name="manufacturerId"
                  value={manufacturerId}
                  onChange={(event) => setManufacturerId(event.target.value)}
                  className="select"
                >
                  <option value="">— None —</option>
                  {manufacturers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                  <option value={NEW}>+ Add new manufacturer…</option>
                </select>
                {manufacturerId === NEW && (
                  <input
                    name="newManufacturerName"
                    placeholder="Manufacturer name"
                    aria-label="New manufacturer name"
                    required
                    autoFocus
                    className="input mt-2"
                  />
                )}
              </div>

              {/* Row 2 */}
              <Field
                label="SKU / code"
                name="sku"
                placeholder="LAB-JRN"
                defaultValue={defaults?.sku ?? ""}
              />
              <div className="sm:col-span-2">
                <TextareaField
                  label="Product description"
                  name="description"
                  rows={2}
                  placeholder="Licensed journeyman labor, standard business hours."
                  defaultValue={defaults?.description ?? ""}
                  hint="Appears under the product name on quotes."
                />
              </div>

              {/* Row 3 */}
              <div>
                <label className="label" htmlFor="cost">
                  COGS ($)
                </label>
                <input
                  id="cost"
                  name="cost"
                  type="number"
                  step="0.01"
                  placeholder="80.00"
                  value={cost}
                  onChange={(event) => changeCost(event.target.value)}
                  className="input"
                />
                <p className="faint mt-1 text-xs">What it costs you. Never shown to customers.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="markupPercent">
                    Markup %
                  </label>
                  <input
                    id="markupPercent"
                    inputMode="decimal"
                    placeholder="35"
                    value={markupText}
                    onChange={(event) => changePercent("markup", event.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="marginPercent">
                    Margin %
                  </label>
                  <input
                    id="marginPercent"
                    inputMode="decimal"
                    placeholder="26"
                    value={marginText}
                    onChange={(event) => changePercent("margin", event.target.value)}
                    className="input"
                  />
                </div>
                {percentProblem ? (
                  <p role="alert" className="col-span-2 text-xs text-[var(--warn)]">
                    {percentProblem}
                  </p>
                ) : (
                  <p className="faint col-span-2 text-xs">Type either one and the unit price follows.</p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="unitPrice">
                  Unit price ($)<span className="faint font-normal"> · optional</span>
                </label>
                <input
                  id="unitPrice"
                  name="unitPrice"
                  type="number"
                  step="0.01"
                  placeholder="125.00"
                  value={unitPrice}
                  onChange={(event) => changePrice(event.target.value)}
                  className="input"
                />
                <p className="faint mt-1 text-xs">Used as the default value on quote line items.</p>
              </div>
              <div>
                <label className="label" htmlFor="listPrice">
                  MSRP ($)
                </label>
                <input
                  id="listPrice"
                  name="listPrice"
                  type="number"
                  step="0.01"
                  placeholder="189.99"
                  value={listPrice}
                  onChange={(event) => setListPrice(event.target.value)}
                  className="input"
                />
                <p className="faint mt-1 text-xs">The supplier&apos;s suggested price, from their ratesheet. Internal only.</p>
              </div>
              {hasUnits ? (
                <div>
                  <label className="label" htmlFor="unitOfMeasure">
                    Unit of measurement
                  </label>
                  <select
                    id="unitOfMeasure"
                    name="unitOfMeasure"
                    value={unit}
                    onChange={(event) => changeUnit(event.target.value)}
                    className="select"
                  >
                    <option value="">— None —</option>
                    {/* Only the list that belongs to the Default tag. */}
                    {allowedGroups.map((group: UnitGroup) => (
                      <optgroup key={group} label={UNIT_GROUP_LABELS[group]}>
                        {UNIT_GROUPS[group].map((value) => (
                          <option key={value} value={value}>
                            {UNIT_LABELS[value]}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {unitCleared ? (
                    <p className="mt-1 text-xs text-[var(--warn)]">
                      Unit cleared — pick one from the {TAG_LABELS[tag as keyof typeof TAG_LABELS]} list.
                    </p>
                  ) : (
                    <p className="faint mt-1 text-xs">{UNIT_GROUP_LABELS[allowedGroups[0]]} units.</p>
                  )}
                </div>
              ) : (
                // Project services, shipping and taxes carry no unit; the
                // cell stays so the row keeps its shape.
                <div>
                  <span className="label">Unit of measurement</span>
                  <p className="faint text-xs" data-testid="no-unit-note">
                    No unit for {TAG_LABELS[tag as keyof typeof TAG_LABELS]}.
                  </p>
                </div>
              )}
            </div>

            {/* Software pop-out: rate and term, with the total worked out
                for the user as they type. Only shown for a software unit. */}
            {software && (
              <div
                className="rounded-xl border p-4"
                style={{
                  borderColor: "color-mix(in srgb, #a78bfa 35%, transparent)",
                  background: "color-mix(in srgb, #a78bfa 8%, transparent)",
                }}
              >
                <p className="eyebrow mb-3" style={{ color: "#a78bfa" }}>
                  Software rate &amp; term
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="label" htmlFor="softwareRate">
                      Rate
                    </label>
                    <select
                      id="softwareRate"
                      name="softwareRate"
                      value={rate}
                      onChange={(event) => setRate(event.target.value as SoftwareRateValue)}
                      className="select"
                    >
                      {SOFTWARE_RATES.map((value) => (
                        <option key={value} value={value}>
                          {SOFTWARE_RATE_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="softwareTerm">
                      Term ({SOFTWARE_TERM_NOUNS[rate]}s)
                    </label>
                    <input
                      id="softwareTerm"
                      name="softwareTerm"
                      inputMode="numeric"
                      placeholder="12"
                      value={term}
                      onChange={(event) => setTerm(event.target.value.replace(/[^0-9]/g, ""))}
                      className="input num"
                    />
                  </div>
                  <div>
                    <span className="label">Total</span>
                    <div className="input num flex min-h-[2.4rem] items-center bg-transparent font-medium">
                      {totalCents !== null ? formatCents(totalCents) : "—"}
                    </div>
                    <p className="faint mt-1 text-xs">
                      {totalCents !== null
                        ? `${formatCents(priceCents)} ${UNIT_LABELS[unit as keyof typeof UNIT_LABELS]} × ${termCount} ${SOFTWARE_TERM_NOUNS[rate]}${termCount === 1 ? "" : "s"} = ${formatCents(totalCents)} ${UNIT_LABELS[unit as keyof typeof UNIT_LABELS].toLowerCase()}`
                        : "Enter a term to see the total."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="active"
                defaultChecked={active}
                className="h-4 w-4 accent-[var(--brand)]"
              />
              Active — show this product when building quotes
            </label>
          </div>
        </Card>

        {/* ---------- Distributor box ---------- */}
        <Card lit>
          <CardHeader title="Distributor" subtitle="Who you buy this from, and who to call." />
          <div className="space-y-4 p-5">
            <div>
              <label className="label" htmlFor="distributorId">
                Distributor
              </label>
              <select
                id="distributorId"
                name="distributorId"
                value={distributorId}
                onChange={(event) => changeDistributor(event.target.value)}
                className="select"
              >
                <option value="">— None —</option>
                {distributors.map((item) => (
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
                <option value={NEW}>+ Add new distributor…</option>
              </select>
              {twin && (
                <p className="faint mt-1 text-xs" data-testid="distributor-twin">
                  Your {twin.name} will be linked to this account when you save.
                </p>
              )}
              {distributorId === NEW && (
                <>
                  <input
                    name="newDistributorName"
                    placeholder="Distributor name"
                    aria-label="New distributor name"
                    required
                    autoFocus
                    onChange={(event) => setTypedDistributor(event.target.value)}
                    className="input mt-2"
                  />
                  {typedPlatform && (
                    <button
                      type="button"
                      // Not changeDistributor: the people typed in for this
                      // new supplier are for this one, so they stay.
                      onClick={() => {
                        setDistributorId(`${PLATFORM_SUPPLIER_PREFIX}${typedPlatform.id}`);
                        setTypedDistributor("");
                      }}
                      className="btn btn-ghost btn-sm mt-2"
                    >
                      Use {typedPlatform.name} (on Software Connect Brands)
                    </button>
                  )}
                </>
              )}
            </div>

            {showContacts ? (
              <div>
                <span className="label">Distributor point of contact</span>
                <p className="faint -mt-1 mb-2 text-xs">Tick everyone you deal with there.</p>

                {distributor && distributor.contacts.length > 0 && (
                  <ul className="space-y-1.5">
                    {distributor.contacts.map((contact) => {
                      const edit = contactEdits[contact.id];
                      const checked = selectedContacts.has(contact.id);
                      return (
                        <li
                          key={contact.id}
                          className="rounded-lg border px-2.5 py-2"
                          style={{
                            borderColor: checked
                              ? "color-mix(in srgb, var(--brand) 45%, transparent)"
                              : "var(--border)",
                            background: checked
                              ? "color-mix(in srgb, var(--brand) 8%, transparent)"
                              : "transparent",
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              name="contactIds"
                              value={contact.id}
                              checked={checked}
                              onChange={() => toggleContact(contact.id)}
                              aria-label={`Select ${contact.name}`}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                            />
                            {edit ? (
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <input
                                  value={edit.name}
                                  onChange={(event) => patchEdit(contact.id, { name: event.target.value })}
                                  aria-label="Contact name"
                                  placeholder="Name"
                                  className="input input-sm"
                                />
                                <input
                                  value={edit.email}
                                  onChange={(event) => patchEdit(contact.id, { email: event.target.value })}
                                  aria-label="Contact email"
                                  placeholder="Email"
                                  type="email"
                                  className="input input-sm"
                                />
                                <input
                                  value={edit.phone}
                                  onChange={(event) => patchEdit(contact.id, { phone: event.target.value })}
                                  aria-label="Contact phone"
                                  placeholder="Phone"
                                  className="input input-sm num"
                                />
                                <p className="faint text-[0.7rem]">Changes are saved with the product.</p>
                              </div>
                            ) : (
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{contact.name}</p>
                                <div className="muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                                  {contact.email ? (
                                    <span className="inline-flex items-center gap-1">
                                      <IconMail size={11} />
                                      {contact.email}
                                    </span>
                                  ) : (
                                    <span className="faint">no email</span>
                                  )}
                                  {contact.phone ? (
                                    <span className="num inline-flex items-center gap-1">
                                      <IconPhone size={11} />
                                      {contact.phone}
                                    </span>
                                  ) : (
                                    <span className="faint">no phone</span>
                                  )}
                                </div>
                              </div>
                            )}
                            {!edit && (
                              <button
                                type="button"
                                onClick={() => beginEdit(contact)}
                                aria-label={`Edit ${contact.name}`}
                                title="Fix a typo"
                                className="btn btn-ghost btn-sm !px-1.5"
                              >
                                <IconEdit size={12} />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {distributor && distributor.contacts.length === 0 && newContacts.length === 0 && (
                  <p className="faint text-xs">No contacts on file for {distributor.name} yet.</p>
                )}

                {newContacts.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {newContacts.map((row, index) => (
                      <li
                        key={row.uid}
                        className="rounded-lg border border-dashed border-[var(--border-strong)] px-2.5 py-2"
                      >
                        <div className="flex items-start gap-2">
                          <IconCheck size={14} className="mt-1 shrink-0 text-[var(--ok)]" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <input
                              value={row.name}
                              onChange={(event) => patchNewContact(row.uid, { name: event.target.value })}
                              aria-label={`New contact ${index + 1} name`}
                              placeholder="Name"
                              className="input input-sm"
                            />
                            <input
                              value={row.email}
                              onChange={(event) => patchNewContact(row.uid, { email: event.target.value })}
                              aria-label={`New contact ${index + 1} email`}
                              placeholder="Email"
                              type="email"
                              className="input input-sm"
                            />
                            <input
                              value={row.phone}
                              onChange={(event) => patchNewContact(row.uid, { phone: event.target.value })}
                              aria-label={`New contact ${index + 1} phone`}
                              placeholder="Phone"
                              className="input input-sm num"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeNewContact(row.uid)}
                            aria-label={`Remove new contact ${index + 1}`}
                            className="btn btn-ghost btn-sm !px-1.5"
                          >
                            <IconTrash size={12} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <button type="button" onClick={addNewContact} className="btn btn-ghost btn-sm mt-2">
                  <IconPlus size={13} />
                  Add contact
                </button>
                <p className="faint mt-2 text-[0.7rem]">
                  New contacts are added to the distributor and ticked for this product when you save.
                </p>
              </div>
            ) : (
              <p className="faint text-xs">Pick a distributor to add points of contact.</p>
            )}
          </div>
        </Card>
      </div>

      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
