import { z } from "zod";

const API = "https://gate.smsaero.ru/v2";
export class SmsAeroError extends Error {
  constructor(outcome) {
    super(outcome === "rejected" ? "sms_rejected" : "sms_unknown");
    this.outcome = outcome;
  }
}
export function smsAeroReady() {
  return !!(
    process.env.SMSAERO_EMAIL?.trim() &&
    process.env.SMSAERO_API_KEY?.trim() &&
    process.env.SMSAERO_SIGN?.trim()
  );
}
async function request(path, parameters = {}) {
  if (!smsAeroReady()) throw new SmsAeroError("rejected");
  try {
    const response = await fetch(API + path, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.SMSAERO_EMAIL.trim()}:${process.env.SMSAERO_API_KEY.trim()}`,
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(parameters),
    });
    // No automatic failover: an uncertain POST may already have sent the SMS.
    if (!response.ok) {
      await response.body?.cancel();
      throw new SmsAeroError(
        [400, 401, 403, 422].includes(response.status) ? "rejected" : "unknown",
      );
    }
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 64000) throw new SmsAeroError("unknown");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.success === false) throw new SmsAeroError("rejected");
    if (body.success !== true) throw new SmsAeroError("unknown");
    return body.data;
  } catch (error) {
    if (error instanceof SmsAeroError) throw error;
    // Never propagate credentials, message text, phone numbers or raw provider responses.
    throw new SmsAeroError("unknown");
  }
}
const messageSchema = z.object({
  id: z.number().int().positive().safe(),
  number: z.union([z.string(), z.number().int().safe()]).transform(String),
  status: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(6),
    z.literal(8),
  ]),
});
function messageResult(data, phone, id) {
  const items = Array.isArray(data) ? data : [data];
  if (items.length !== 1) throw new SmsAeroError("unknown");
  const parsed = messageSchema.safeParse(items[0]);
  if (
    !parsed.success ||
    parsed.data.number !== phone ||
    (id !== undefined && String(parsed.data.id) !== String(id))
  )
    throw new SmsAeroError("unknown");
  const message = parsed.data;
  return {
    providerId: String(message.id),
    providerStatus: message.status,
    status:
      message.status === 1
        ? "delivered"
        : [2, 6].includes(message.status)
          ? "failed"
          : "submitted",
  };
}
export async function checkSmsAero() {
  await request("/auth");
  return { authorized: true };
}
export async function sendSmsAero(phone, text, { test = false } = {}) {
  const number = phone.replace(/\D/g, "");
  const data = await request(test ? "/sms/testsend" : "/sms/send", {
    number,
    text,
    sign: process.env.SMSAERO_SIGN?.trim(),
  });
  return messageResult(data, number);
}
export async function readSmsAeroStatus(id, phone) {
  if (!/^\d+$/.test(String(id))) throw new SmsAeroError("unknown");
  return messageResult(
    await request("/sms/status", { id: String(id) }),
    phone.replace(/\D/g, ""),
    id,
  );
}
