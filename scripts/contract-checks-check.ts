/* The rules behind Release B's contract checks (src/lib/contract-checks.ts),
 * case by case, without a browser or a database. Run by ai-release-b.cjs;
 * on its own:  npx tsx scripts/contract-checks-check.ts
 */
import assert from "node:assert/strict";
import {
  addOffset,
  applyRedlines,
  businessKey,
  complianceFlags,
  countWrittenIn,
  dateWrittenIn,
  locateOnce,
  moneyIn,
  priceCheckProblems,
  sendCheckRules,
  type PriceCheckColumn,
} from "../src/lib/contract-checks";

let cases = 0;
const check = (name: string, fn: () => void) => {
  fn();
  cases += 1;
  if (process.env.VERBOSE) console.log(`ok ${name}`);
};

const thermostat = { costCents: 10000, minPriceCents: 14286, unitKey: "EACH", unitLabel: "Each" };
const base: PriceCheckColumn = {
  label: "Contract A",
  payable: false,
  rows: [],
  subtotalCents: 0,
  discountCents: 0,
  totalCents: 0,
  schedule: [{ label: "Balance", kind: "BALANCE", percent: null, fixedCents: null, dueOn: "" }],
};
const row = (over: Partial<PriceCheckColumn["rows"][number]>) => ({
  name: "Thermostat",
  quantity: 1,
  unitPriceCents: 20000,
  discountCents: 0,
  product: thermostat,
  unitKey: "EACH",
  unitLabel: "Each",
  ...over,
});
const codes = (column: Partial<PriceCheckColumn>) => priceCheckProblems([{ ...base, ...column }]).map((problem) => problem.code);

check("a clean row finds nothing", () => assert.deepEqual(codes({ rows: [row({})], subtotalCents: 20000, totalCents: 20000 }), []));
check("under cost", () => assert.deepEqual(codes({ rows: [row({ quantity: 2, unitPriceCents: 9000 })] }), ["UNDER_COST"]));
check("under cost wins over under minimum", () => assert.deepEqual(codes({ rows: [row({ unitPriceCents: 5000 })] }), ["UNDER_COST"]));
check("under the starred minimum, net of the line's discount", () => {
  assert.deepEqual(codes({ rows: [row({ unitPriceCents: 15000, discountCents: 1000 })] }), ["UNDER_MINIMUM"]);
  assert.deepEqual(codes({ rows: [row({ unitPriceCents: 14286 })] }), [], "at the minimum is fine");
});
check("a money-out row is never under cost, but above the catalog cost is flagged", () => {
  assert.deepEqual(codes({ payable: true, rows: [row({ unitPriceCents: 5000 })] }), []);
  assert.deepEqual(codes({ payable: true, rows: [row({ unitPriceCents: 10001 })] }), ["PO_OVER_COST"]);
  assert.deepEqual(codes({ payable: true, rows: [row({ unitPriceCents: 10000 })] }), []);
});
check("a unit that differs from the product's", () => {
  assert.deepEqual(codes({ rows: [row({ unitKey: "PER_LINEAR_FT", unitLabel: "Per linear ft" })] }), ["UNIT"]);
  assert.deepEqual(codes({ rows: [row({ unitKey: null, unitLabel: null })] }), [], "a line with no unit says nothing");
  assert.deepEqual(codes({ rows: [row({ product: { ...thermostat, unitKey: null, unitLabel: null }, unitKey: "EACH" })] }), [], "a product with no unit says nothing");
});
check("a typed row with no product is never flagged", () => assert.deepEqual(codes({ rows: [row({ product: null, unitPriceCents: 1 })] }), []));
check("a discount bigger than the margin", () => {
  const rows = [row({ unitPriceCents: 20000 })];
  assert.deepEqual(codes({ rows, subtotalCents: 20000, discountCents: 10001, totalCents: 9999 }), ["DISCOUNT_OVER_MARGIN"]);
  assert.deepEqual(codes({ rows, subtotalCents: 20000, discountCents: 10000, totalCents: 10000 }), []);
  assert.deepEqual(codes({ payable: true, rows: [row({ unitPriceCents: 10000 })], discountCents: 99999 }), [], "not on a purchase order");
  assert.deepEqual(
    codes({ rows: [...rows, row({ product: null, name: "Labor" })], subtotalCents: 40000, discountCents: 30000, totalCents: 10000 }),
    [],
    "a row with no catalog cost leaves the margin unknown",
  );
});
check("a schedule that doesn't add up", () => {
  const schedule = [{ label: "Deposit", kind: "PERCENT" as const, percent: 50, fixedCents: null, dueOn: "" }];
  assert.deepEqual(codes({ rows: [row({})], subtotalCents: 20000, totalCents: 20000, schedule }), ["SCHEDULE_TOTAL"]);
  assert.deepEqual(codes({ rows: [row({})], subtotalCents: 20000, totalCents: 20000, schedule: [] }), [], "no schedule, nothing to add up");
});
check("each finding's words carry its numbers", () => {
  const [problem] = priceCheckProblems([{ ...base, rows: [row({ quantity: 2, unitPriceCents: 9000 })] }]);
  assert.match(problem.text, /\$180\.00.*\$200\.00/);
  assert.equal(problem.facts.cost, "$200.00");
});

check("send check: the payment table against the total", () => {
  const schedule = [{ label: "Deposit", kind: "PERCENT", percent: 50, fixedCents: null, amountCents: 5000, dueOn: "" }];
  const rows = [{ name: "A", quantity: 1, unitPriceCents: 10000, discountCents: 0, quoteLine: null }];
  assert.deepEqual(sendCheckRules({ body: "Agreement", rows, totalCents: 10000, schedule }).map((rule) => rule.code), ["SCHEDULE_TOTAL"]);
  assert.deepEqual(sendCheckRules({ body: "Agreement", rows: [], totalCents: 0, schedule }), [], "no rows, no total to add up to");
});
check("send check: a total in the wording, subtotals ignored", () => {
  const rows = [{ name: "A", quantity: 1, unitPriceCents: 10000, discountCents: 0, quoteLine: null }];
  const codesOf = (body: string) => sendCheckRules({ body, rows, totalCents: 10000, schedule: [] }).map((rule) => rule.code);
  assert.deepEqual(codesOf("Contract total: $1.00"), ["WORDING_TOTAL"]);
  assert.deepEqual(codesOf("Contract total: $100.00"), []);
  assert.deepEqual(codesOf("Subtotal: $1.00"), [], "a subtotal isn't the total");
  assert.deepEqual(codesOf("Subtotal $1.00, total $100.00"), [], "one amount on the line is the total");
  assert.deepEqual(codesOf("Deposit: $1.00"), [], "an amount that isn't a total");
});
check("send check: a row the quote has since changed", () => {
  const rules = sendCheckRules({
    body: "x",
    totalCents: 10000,
    schedule: [],
    rows: [{ name: "A", quantity: 1, unitPriceCents: 10000, discountCents: 0, quoteLine: { quantity: 2, unitPriceCents: 10000, discountCents: 0 } }],
  });
  assert.deepEqual(rules.map((rule) => rule.code), ["QUOTE_CHANGED"]);
  const po = sendCheckRules({
    body: "x",
    payable: true,
    totalCents: 10000,
    schedule: [],
    rows: [{ name: "A", quantity: 1, unitPriceCents: 5000, discountCents: 0, quoteLine: { quantity: 1, unitPriceCents: 10000, discountCents: 0 } }],
  });
  assert.deepEqual(po, [], "a purchase order is priced at cost, never at the quote's prices");
});
check("money in words", () => assert.deepEqual(moneyIn("pay $1,250.50 then $3").map((entry) => entry.cents), [125050, 300]));

check("a snippet placed exactly once, across line breaks and quote marks", () => {
  const body = "1. Payment. Net 30 from the\ninvoice date.\n2. The owner’s duties. Net 30 applies.";
  assert.ok(locateOnce(body, "Net 30 from the invoice date"));
  assert.ok(locateOnce(body, "The owner's duties"));
  assert.equal(locateOnce(body, "Net 30"), null, "twice is not once");
  assert.equal(locateOnce(body, "Net 60"), null);
  assert.equal(locateOnce(body, "ab"), null, "too short to place");
  assert.equal(locateOnce(body, "(unbalanced [ regex"), null);
});
check("accepted changes go in, each where it still places", () => {
  const body = "Pay Net 30 from the invoice date. A late fee of 5% applies. Warranty one year.";
  const out = applyRedlines(body, [
    { id: "a", snippet: "Net 30 from the invoice date", replacement: "Net 45 from the invoice date", deleted: false, explanation: "" },
    { id: "b", snippet: "A late fee of 5% applies.", replacement: "", deleted: true, explanation: "" },
    { id: "c", snippet: "Net 30", replacement: "Net 60", deleted: false, explanation: "" },
  ]);
  assert.equal(out.body, "Pay Net 45 from the invoice date. Warranty one year.");
  assert.deepEqual(out.applied, ["a", "b"]);
  assert.deepEqual(out.missed, ["c"], "the first change took its words");
});

check("a date written out, every usual way", () => {
  for (const text of ["start by March 3, 2027", "Mar. 3rd 2027", "the 3rd of March, 2027", "on 3/3/2027", "on 03/03/27", "2027-03-03"]) {
    assert.ok(dateWrittenIn(text, "2027-03-03"), text);
  }
  assert.equal(dateWrittenIn("start by March 4, 2027", "2027-03-03"), false);
  assert.equal(dateWrittenIn("December 31, 2027", "2027-12-30"), false);
});
check("a count written out", () => {
  assert.ok(countWrittenIn("within thirty (30) days", 30));
  assert.ok(countWrittenIn("within ten days", 10));
  assert.equal(countWrittenIn("within 300 days", 30), false);
});
check("offsets from signing", () => {
  assert.equal(addOffset("2026-11-12", 10, "days"), "2026-11-22");
  assert.equal(addOffset("2026-11-12", 2, "weeks"), "2026-11-26");
  assert.equal(addOffset("2027-01-31", 1, "months"), "2027-02-28");
  assert.equal(addOffset("2026-11-12", 1, "years"), "2027-11-12");
});

check("compliance: the same business however it is written", () => {
  assert.equal(businessKey("Sparky Electric, LLC"), businessKey("sparky electric"));
  assert.equal(businessKey("The A&B Co."), businessKey("A and B"));
});
check("compliance flags", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  assert.deepEqual(complianceFlags({ expiresOn: day("2026-11-11"), namedInsured: null }, "X", now), ["EXPIRED"]);
  assert.deepEqual(complianceFlags({ expiresOn: day("2026-11-12"), namedInsured: null }, "X", now), ["EXPIRING"], "today is still good");
  assert.deepEqual(complianceFlags({ expiresOn: day("2026-12-12"), namedInsured: null }, "X", now), ["EXPIRING"]);
  assert.deepEqual(complianceFlags({ expiresOn: day("2026-12-13"), namedInsured: null }, "X", now), []);
  assert.deepEqual(complianceFlags({ expiresOn: null, namedInsured: "Someone Else LLC" }, "Test Co", now), ["NAME"]);
  assert.deepEqual(complianceFlags({ expiresOn: null, namedInsured: "Test Co, Inc." }, "Test Co", now), []);
});

check("audit fixes: a purchase order row against a $0 (unknown) cost isn't flagged", () => {
  assert.deepEqual(codes({ payable: true, rows: [row({ product: { ...thermostat, costCents: 0 }, unitPriceCents: 50000 })] }), []);
});
check("audit fixes: under cost and under minimum compare before rounding to cents", () => {
  const atMin = { ...thermostat, costCents: 100, minPriceCents: 333 };
  assert.deepEqual(codes({ rows: [row({ product: atMin, quantity: 0.7, unitPriceCents: 333 })] }), [], "exactly at the minimum");
  assert.deepEqual(codes({ rows: [row({ product: atMin, quantity: 0.3, unitPriceCents: 332 })] }), ["UNDER_MINIMUM"], "a cent under, whatever the rounding");
});
check("audit fixes: a change order's new contract total and a merged Total Station row aren't the contract's total", () => {
  const rows = [{ name: "A", quantity: 1, unitPriceCents: 200000, discountCents: 0, quoteLine: null }];
  const codesOf = (body: string) => sendCheckRules({ body, rows, totalCents: 200000, schedule: [] }).map((rule) => rule.code);
  assert.deepEqual(codesOf("Amount of this Change Order: $2,000.00\nNew contract total: $12,000.00"), []);
  assert.deepEqual(codesOf("Original contract total: $10,000.00"), []);
  assert.deepEqual(codesOf("1 × Total Station rental @ $500.00 = $500.00"), []);
  assert.deepEqual(codesOf("Grand total: $500.00"), ["WORDING_TOTAL"], "a real total that disagrees still is");
});
check("audit fixes: more ways a contract writes a date", () => {
  assert.ok(dateWrittenIn("Deposit due Sept. 15, 2027", "2027-09-15"));
  assert.ok(dateWrittenIn("on this 15th day of September, 2027", "2027-09-15"));
  assert.ok(dateWrittenIn("by 2027/03/03", "2027-03-03"));
  assert.equal(dateWrittenIn("Sept. 15, 2027", "2027-09-16"), false);
});
check("audit fixes: business days skip weekends", () => {
  assert.equal(addOffset("2026-11-12", 10, "business days"), "2026-11-26", "Thursday + 10 working days");
  assert.equal(addOffset("2027-03-05", 1, "business days"), "2027-03-08", "Friday + 1 is Monday");
});

console.log(`contract-checks: ${cases} cases passed`);
