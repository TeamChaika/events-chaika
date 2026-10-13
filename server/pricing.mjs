import { z } from "zod";
import { createHash } from "node:crypto";

const moneySchema = z.number().int().min(100).max(100000000);
export const priceScheduleSchema = z
  .array(
    z.object({
      starts_at: z.iso
        .datetime({ offset: true })
        .transform((value) => new Date(value).toISOString()),
      price: moneySchema,
    }),
  )
  .max(30)
  .refine(
    (rows) => new Set(rows.map((row) => row.starts_at)).size === rows.length,
    "В расписании не может быть двух цен на один момент времени",
  )
  .transform((rows) =>
    rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
  );
export const promoCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-ZА-ЯЁ0-9_-]{2,32}$/,
    "Промокод: от 2 до 32 букв, цифр, дефисов или подчёркиваний",
  );
export const promoCodesSchema = z
  .array(
    z
      .object({
        code: promoCodeSchema,
        kind: z.enum(["fixed", "percent"]),
        // Fixed values are kopecks; percent values are hundredths of a percent.
        value: z.number().int().min(1).max(100000000),
        active: z.boolean(),
      })
      .refine(
        (promo) =>
          promo.kind === "fixed" ? promo.value >= 100 : promo.value <= 9900,
        "Скидка: от 1 ₽ либо от 0,01% до 99%",
      ),
  )
  .max(100)
  .refine(
    (rows) => new Set(rows.map((row) => row.code)).size === rows.length,
    "Промокоды не должны повторяться",
  );
export const readSchedule = (raw) =>
  priceScheduleSchema.parse(
    raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [],
  );
export const readPromos = (raw) =>
  promoCodesSchema.parse(
    raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [],
  );

export function scheduledLines(lines, schedule, at = Date.now()) {
  const current = schedule
    .filter((row) => Date.parse(row.starts_at) <= at)
    .at(-1);
  return current
    ? lines.map((line) => ({
        ...line,
        unit_price: current.price,
        total: current.price * line.quantity,
      }))
    : lines;
}

export function discountedQuote(quantity, lines, promo) {
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const discounted = promo
    ? lines.map((line) => {
        const discount =
          promo.kind === "fixed"
            ? promo.value
            : Math.round((line.unit_price * promo.value) / 10000);
        const unit_price = line.unit_price - discount;
        if (unit_price < 100)
          throw new Error("Цена билета после скидки должна быть не меньше 1 ₽");
        return {
          ...line,
          base_unit_price: line.unit_price,
          unit_price,
          total: unit_price * line.quantity,
        };
      })
    : lines;
  const total = discounted.reduce((sum, line) => sum + line.total, 0);
  return {
    quantity,
    lines: discounted,
    total,
    subtotal,
    discount_total: subtotal - total,
    promo: promo
      ? { code: promo.code, kind: promo.kind, value: promo.value }
      : null,
  };
}

export const pricingUpdateSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  schedule: priceScheduleSchema.optional(),
  promos: promoCodesSchema.optional(),
  tiers: z
    .array(
      z.object({
        quantity: z.number().int().min(1).max(100000),
        price: z.number().int().min(100).max(100000000),
      }),
    )
    .min(1)
    .max(10)
    .refine(
      (tiers) => tiers.reduce((n, tier) => n + tier.quantity, 0) <= 100000,
      "Общее количество билетов не должно превышать 100 000",
    ),
});

export const pricingRevision = (event) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        event.price,
        event.capacity,
        readTiers(event.price_tiers),
        readSchedule(event.price_schedule),
        readPromos(event.promo_codes),
      ]),
    )
    .digest("hex");

// Assign legacy orders to their existing quotas before editing the policy.
// Stored amounts remain authoritative, even if they differ from today's prices.
export function pricingAllocations(tiers, orders) {
  const legacyUsed = tiers.map(() => 0);
  return orders.map((order) => {
    if (order.price_breakdown)
      return {
        order,
        lines: orderPriceLines(order).map((line) =>
          tiers.length === 1 ? { ...line, tier: 0 } : line,
        ),
      };
    const lines = allocate(tiers, legacyUsed, order.quantity).map((line) => {
      legacyUsed[line.tier] += line.quantity;
      return {
        ...line,
        unit_price: order.unit_price,
        total: line.quantity * order.unit_price,
      };
    });
    orderPriceLines({ ...order, price_breakdown: JSON.stringify(lines) });
    return { order, lines };
  });
}

export const priceTiersSchema = z
  .array(
    z.object({
      up_to: z.number().int().min(1).max(100000).nullable(),
      price: z.number().int().min(100).max(100000000),
    }),
  )
  .min(2)
  .max(10)
  .refine(
    (tiers) =>
      tiers.every(
        (tier, index) =>
          (index === tiers.length - 1
            ? tier.up_to === null
            : tier.up_to !== null) &&
          (!index ||
            ((tier.up_to === null || tier.up_to > tiers[index - 1].up_to) &&
              tier.price > tiers[index - 1].price)),
      ),
    "Ступени должны идти по возрастанию, последняя — без верхней границы",
  );

export function readTiers(raw) {
  return raw
    ? priceTiersSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw)
    : null;
}

export function allocate(tiers, used, quantity) {
  let remaining = quantity;
  const lines = [];
  for (let index = 0; index < tiers.length && remaining; index++) {
    const tier = tiers[index];
    const capacity =
      tier.up_to === null
        ? Infinity
        : tier.up_to - (tiers[index - 1]?.up_to || 0);
    const count = Math.min(
      remaining,
      Math.max(0, capacity - (used[index] || 0)),
    );
    if (count)
      lines.push({
        tier: index,
        quantity: count,
        unit_price: tier.price,
        total: count * tier.price,
      });
    remaining -= count;
  }
  return lines;
}

// Historical fixed-price orders consume the earliest places without repricing them.
export function tierUsage(tiers, orders) {
  const used = tiers.map(() => 0);
  let legacy = 0;
  for (const order of orders) {
    if (!order.price_breakdown) legacy += order.quantity;
    else
      for (const line of JSON.parse(order.price_breakdown)) {
        if (
          !Number.isInteger(line.tier) ||
          !tiers[line.tier] ||
          !Number.isSafeInteger(line.quantity) ||
          line.quantity < 1
        )
          throw new Error("Некорректная сохранённая ценовая ступень");
        used[line.tier] += line.quantity;
      }
  }
  // Legacy sales always precede the introduction of the policy.
  const legacyLines = allocate(tiers, [], legacy);
  for (const line of legacyLines) used[line.tier] += line.quantity;
  return used;
}

export function orderPriceLines(order) {
  const lines = order.price_breakdown
    ? JSON.parse(order.price_breakdown)
    : [
        {
          quantity: order.quantity,
          unit_price: order.unit_price,
          total: order.total,
        },
      ];
  if (
    !Array.isArray(lines) ||
    !lines.length ||
    lines.some(
      (line) =>
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        !Number.isSafeInteger(line.unit_price) ||
        line.unit_price < 0 ||
        line.total !== line.quantity * line.unit_price,
    ) ||
    lines.reduce((n, line) => n + line.quantity, 0) !== order.quantity ||
    lines.reduce((n, line) => n + line.total, 0) !== order.total
  ) {
    throw new Error("Некорректная сохранённая стоимость заказа");
  }
  return lines;
}
