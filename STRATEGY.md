# What this product is, and how feature decisions get made

Written with Taylor, Sept 2026. This exists so a feature argument can be
settled by reading rather than re-litigated every session. If a proposed
feature doesn't serve something on this page, it is a distraction — say so.

## The business in one paragraph

A white-label CRM for small service and trade contractors. Two buyers, both
real: a 1–3 person contractor who pays for it directly, and an organization
— an association, franchise, supplier or buying group — that rebrands it and
puts it in front of its own members. The pitch is not "somewhere to keep your
contacts." It is **"this automates your operations so you can scale without
hiring."** That promise is what justifies the price, and it is what every
feature should be measured against.

## The number

**$10,000 a month.** That is the bar for calling this a real business.

What it actually takes:

| Price | Customers needed |
|---|---|
| $99/mo direct | ~101 |
| $199/mo direct | ~50 |
| $499/mo white-label partner | ~20 |
| Blend: 8 partners + 60 direct @ $99 | ~$9.9k |

Worth sitting with: **101 individual contractors is a lot of selling for one
person.** Every white-label partner is worth five to twenty direct customers
and is sold once. That is an argument for the partner path being the spine of
the plan, not a side door — and it means signup, branding and per-tenant
isolation are revenue features, not polish.

## What the customer does every day, in priority order

Taylor's ranking, and the order features should be judged in:

1. **Chase money owed** — who owes me, who hasn't signed, who went quiet.
   This is what keeps a small contractor awake.
2. **Send quotes fast** — quote out before leaving the driveway.
3. **Never drop a lead** — the follow-up that got forgotten.
4. **Keep the job organized** — change orders, photos, what got approved.

**The uncomfortable part: #1 is the least-built thing in the app.** There are
quotes and contracts, so "who hasn't signed" is partly answered, but there
are no invoices, no payments, and no reminders. The top daily job of the
target customer is currently not served. That gap, not a new module, is the
next real work.

## The AI bet

**Quote from a sentence.** Type *"replace 40ft of 4in cast iron, two
cleanouts, pull permit"* and get a line-itemed, tagged, priced quote back.

Why this one and not the others: it collapses the #2 daily job from minutes
to seconds, it demos in fifteen seconds to a partner who is deciding whether
to white-label, and nothing in this market does it well. Other AI ideas
(reading inbound email, "who should I call today") are parked until there is
real data to reason over.

Cost is not a reason to avoid it — a quote draft is a small number of tokens,
fractions of a cent. Getting it *wrong* is the risk: a hallucinated price on a
customer-facing quote is worse than no feature. It must always land in the
editor as a draft the contractor confirms, never sent automatically, and
prices must come from the tenant's own product catalog rather than invented.

## Guardrails for anything proposed from here

- **Does it get a quote out faster, money in faster, or stop a lead going
  cold?** If not, it is below the line.
- **Every screen must reskin.** The product is white-labeled. Never hardcode
  "Software Connect" into anything a tenant's customer can see.
- **Advanced does not mean complicated.** The promise is automation —
  removing steps. A feature that adds a screen to learn is usually the wrong
  shape.
- **Assume a phone in a truck.** Poor signal, one thumb, sunlight.
- **A contractor will never read a manual.** If it needs explaining, it is
  not finished.

## Roadmap this implies

1. **Email.** Blocks everything: approval notices, password reset, payment
   receipts, and the automatic nudges that make #1 work at all.
2. **Invoices and getting paid.** Quote accepted → invoice → payment link →
   marked paid. This is the #1 daily job and the biggest hole.
3. **Follow-up automation.** "Nobody has touched this in 8 days." Cheap once
   email exists, and it is the difference between a CRM and a filing cabinet.
4. **Subscription billing.** How Taylor gets paid. Deliberately *after* the
   product is worth paying for — the first ten customers can be invoiced by
   hand.
5. **Quote from a sentence.** The demo weapon, and what sells partner deals.
6. **White-label depth.** Per-tenant domains, partner-level rollups.

Security work (password reset, rate limiting, secret rotation) is not on this
list because it is not optional — it ships before the first paying customer
regardless of where it sits in a priority order.
