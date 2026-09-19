import { z } from "zod";
export class ProviderError extends Error {
  constructor(outcome, message) {
    super(message);
    this.outcome = outcome;
  }
}
export function providerConfig(mode) {
  if (!["sandbox", "live"].includes(mode))
    throw new ProviderError("failed", "Оплата QRM не настроена");
  const host =
    mode === "sandbox"
      ? "https://app.devwapiserv.qrm.ooo"
      : process.env.QRM_API_BASE_URL;
  const key =
    mode === "sandbox" ? process.env.QRM_API_KEY : process.env.QRM_LIVE_API_KEY;
  if (!host || !key)
    throw new ProviderError("failed", "Заполните серверные настройки QRM");
  const u = new URL(host);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    !["qrm.ooo", "qrmanager.ru"].some((d) => u.hostname.endsWith("." + d)) ||
    (mode === "live" && /dev|test|sandbox/.test(u.hostname))
  )
    throw new ProviderError("failed", "Недопустимый адрес QRM");
  return { host: u.origin, key };
}
async function limitedText(response, limit = 64000) {
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new ProviderError("unknown", "Слишком большой ответ QRM");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString();
}
async function request(mode, path, init = {}) {
  const { host, key } = providerConfig(mode);
  try {
    const r = await fetch(host + path, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: {
        "X-Api-Key": key,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!r.ok)
      throw new ProviderError(
        [400, 401, 403, 422].includes(r.status) ? "failed" : "unknown",
        `QRM HTTP ${r.status}`,
      );
    return r;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError("unknown", "Нет подтверждённого ответа QRM");
  }
}
export function paymentLink(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !["qrm.ooo", "qrmanager.ru", "nspk.ru"].some(
      (d) => u.hostname === d || u.hostname.endsWith("." + d),
    )
  )
    throw new ProviderError("unknown", "Недопустимая платёжная ссылка");
  return u.href;
}
export async function checkMerchant(mode) {
  const data = JSON.parse(
    await limitedText(await request(mode, "/users/check-api-key/")),
  );
  const m = z
    .object({
      merchant_id: z.string().min(1),
      firm_name: z.string(),
      qrt_is_b2c: z.boolean(),
      subscription_end_date: z.string().nullish(),
      requires_receipt: z.boolean(),
      is_nomenclature: z.boolean().optional(),
    })
    .parse(data);
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Simferopol",
  }).format(new Date());
  if (
    !m.qrt_is_b2c ||
    (mode === "live" &&
      ((m.subscription_end_date && m.subscription_end_date < today) ||
        /тестовая/i.test(m.firm_name)))
  )
    throw new ProviderError("failed", "Терминал QRM не готов к оплате");
  if (
    mode === "live" &&
    (!process.env.QRM_EXPECTED_MERCHANT_ID ||
      m.merchant_id !== process.env.QRM_EXPECTED_MERCHANT_ID)
  )
    throw new ProviderError("failed", "Не подтверждён получатель платежа");
  return m;
}
export async function createPayment(order, event, origin) {
  const merchant = await checkMerchant(order.mode);
  const input = {
    sum: order.total,
    ttl: 15,
    // QRM's live validator rejects decorative separators in payment purposes.
    payment_purpose: `Chaika Team Events ${order.id}`,
    notification_url: `${origin}/api/webhooks/qrm/${order.id}/${order.webhook_token}`,
    redirect_url: `${origin}/order/${order.access_token}`,
    ...(merchant.requires_receipt ? { customer_email: order.email } : {}),
    ...(order.mode === "sandbox" ||
    merchant.requires_receipt ||
    merchant.is_nomenclature
      ? {
          nomenclature: [
            {
              name: `Билет: ${event.title}`.slice(0, 100),
              count: order.quantity,
              price: order.unit_price,
              amount: order.total,
              payment_method: 4,
            },
          ],
        }
      : {}),
  };
  // QRM does not document POST idempotency. Persist first, never retry an uncertain creation.
  const response = await request(order.mode, "/operations/qr-code/", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const result = z
    .object({
      results: z.object({
        operation_id: z.uuid(),
        qr_link: z.string(),
        payment_page_link: z.string().nullish(),
      }),
    })
    .parse(JSON.parse(await limitedText(response))).results;
  return {
    operationId: result.operation_id,
    qrUrl: paymentLink(result.qr_link),
    paymentUrl: paymentLink(result.payment_page_link || result.qr_link),
    merchantId: merchant.merchant_id,
  };
}
export const parseStatus = (value) =>
  z
    .object({
      results: z.object({
        operation_status_code: z.number().int(),
        operation_sum: z.number().int().nonnegative(),
      }),
    })
    .parse(value).results;
export async function readStatus(operationId, mode) {
  z.uuid().parse(operationId);
  const response = await request(
    mode,
    `/api/v2/sse-operations/${operationId}/qr-status/`,
    { headers: { Accept: "text/event-stream, application/json" } },
  );
  if (response.headers.get("content-type")?.includes("application/json"))
    return parseStatus(JSON.parse(await limitedText(response)));
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done)
        throw new ProviderError("unknown", "QRM завершил поток без статуса");
      size += value.length;
      if (size > 64000)
        throw new ProviderError("unknown", "Слишком большой поток QRM");
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const lines = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = lines
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) return parseStatus(JSON.parse(data));
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
