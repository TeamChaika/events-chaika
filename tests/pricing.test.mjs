import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceScheduleSchema,
  scheduledLines,
  discountedQuote,
  promoCodesSchema,
} from "../server/pricing.mjs";

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
