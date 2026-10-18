import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceScheduleSchema,
  scheduledLines,
  discountedQuote,
  promoCodesSchema,
} from "../server/pricing.mjs";

test("ticket-limited discounts split a tier without losing quantities or rounding per ticket", () => {
  const quote = discountedQuote(
    5,
    [
      { tier: 0, quantity: 1, unit_price: 500000, total: 500000 },
      { tier: 1, quantity: 4, unit_price: 800000, total: 3200000 },
    ],
    { code: "PART", kind: "percent", value: 1500, limit_scope: "tickets" },
    2,
  );
  assert.deepEqual(
    quote.lines.map((l) => [l.tier, l.quantity, l.unit_price]),
    [
      [0, 1, 425000],
      [1, 1, 680000],
      [1, 3, 800000],
    ],
  );
  assert.equal(quote.promo.discounted_quantity, 2);
  assert.equal(quote.total, 3505000);
  assert.equal(quote.discount_total, 195000);
});

test("legacy promos stay unlimited; invalid limits and date intervals are rejected", () => {
  const base = { code: "SAVE", kind: "fixed", value: 50000, active: true };
  const [legacy] = promoCodesSchema.parse([base]);
  assert.equal(legacy.limit_scope, "orders");
  assert.equal(legacy.max_uses, null);
  for (const patch of [
    { max_uses: 0 },
    { max_uses: 1.5 },
    { max_uses: "1" },
    { limit_scope: "guest" },
    { starts_at: "2026-10-20T00:00" },
    { starts_at: "2026-10-20T00:00:00+03:00", ends_at: "2026-10-19T21:00:00Z" },
  ])
    assert.equal(
      promoCodesSchema.safeParse([{ ...base, ...patch }]).success,
      false,
    );
});

test("dated prices replace quantity prices exactly at midnight in Moscow and persist until next date", () => {
  const schedule = priceScheduleSchema.parse([
    { starts_at: "2026-10-20T00:00:00+03:00", price: 1000000 },
    { starts_at: "2026-10-13T00:00:00+03:00", price: 800000 },
  ]);
  const lines = [
    { tier: 0, quantity: 2, unit_price: 500000, total: 1000000 },
    { tier: 1, quantity: 1, unit_price: 900000, total: 900000 },
  ];
  assert.deepEqual(
    scheduledLines(lines, schedule, Date.parse("2026-10-12T20:59:59.999Z")),
    lines,
  );
  for (const at of ["2026-10-12T21:00:00Z", "2026-10-19T20:59:59.999Z"])
    assert.deepEqual(
      scheduledLines(lines, schedule, Date.parse(at)).map((l) => [
        l.tier,
        l.unit_price,
        l.total,
      ]),
      [
        [0, 800000, 1600000],
        [1, 800000, 800000],
      ],
    );
  assert.equal(
    scheduledLines(lines, schedule, Date.parse("2026-10-19T21:00:00Z"))[0]
      .unit_price,
    1000000,
  );
  assert.throws(() =>
    priceScheduleSchema.parse([
      { starts_at: "2026-10-13T00:00:00+03:00", price: 800000 },
      { starts_at: "2026-10-12T21:00:00Z", price: 900000 },
    ]),
  );
  assert.throws(() =>
    priceScheduleSchema.parse([
      { starts_at: "2026-10-13T00:00:00", price: 800000 },
    ]),
  );
});

test("discounts are per ticket, percentages round per unit and invalid/free discounts are rejected", () => {
  const lines = [{ quantity: 3, unit_price: 10001, total: 30003 }];
  const percent = discountedQuote(3, lines, {
    code: "PERCENT",
    kind: "percent",
    value: 5000,
  });
  assert.equal(percent.total, 15000); // 50.01 discount on each ticket, not on the group total.
  assert.equal(percent.discount_total, 15003);
  const fixed = discountedQuote(3, lines, {
    code: "FIXED",
    kind: "fixed",
    value: 1000,
  });
  assert.equal(fixed.total, 27003);
  assert.throws(() =>
    discountedQuote(3, lines, { code: "FREE", kind: "fixed", value: 10001 }),
  );
  assert.throws(() =>
    promoCodesSchema.parse([
      { code: "Xx", kind: "percent", value: 10000, active: true },
    ]),
  );
  assert.throws(() =>
    promoCodesSchema.parse([
      { code: "same", kind: "fixed", value: 100, active: true },
      { code: "SAME", kind: "fixed", value: 100, active: false },
    ]),
  );
});
