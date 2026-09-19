import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openStore, seed } from "../server/store.mjs";
import { processOutbox, channelReady } from "../server/delivery.mjs";
import {
  sendSmsAero,
  readSmsAeroStatus,
  checkSmsAero,
} from "../server/smsaero.mjs";

const phone = "79990000000";
function setup(t) {
  const original = global.fetch;
  const values = {
    DELIVERY_ENABLED: "true",
    SMSAERO_EMAIL: "fixture@example.com",
    SMSAERO_API_KEY: "fixture-secret",
    SMSAERO_SIGN: "CHAIKATEAM",
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  t.after(() => {
    global.fetch = original;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
const response = (status = 0, extra = {}) =>
  Response.json({
    success: true,
    data: { id: 123, number: phone, status, ...extra },
  });
async function outbox(t) {
  setup(t);
  const store = await openStore(":memory:");
  t.after(() => store.db.close());
  await seed(store);
  const order = {
    id: randomUUID(),
    access_token: "fixture-token",
    event_id: "red-moon",
    first_name: "Тест",
    last_name: "Проверка",
    phone: "+" + phone,
    email: "qa@example.com",
    quantity: 1,
    unit_price: 500000,
    total: 500000,
    status: "paid",
    method: "sbp",
    mode: "live",
    created_at: new Date().toISOString(),
    expires_at: new Date().toISOString(),
    buyer_session: "fixture",
    idempotency: randomUUID(),
    request_hash: "fixture",
    webhook_token: "fixture",
  };
  await store.run(
    `INSERT INTO orders (${Object.keys(order).join(",")}) VALUES (${Object.keys(
      order,
    )
      .map(() => "?")
      .join(",")})`,
    ...Object.values(order),
  );
  const id = randomUUID();
  await store.run(
    "INSERT INTO outbox(id,order_id,channel,kind) VALUES (?,?,?,?)",
    id,
    order.id,
    "sms",
    "tickets",
  );
  return {
    store,
    id,
    order,
    job: () => store.get("SELECT * FROM outbox WHERE id=?", id),
  };
}
test("SMS Aero keeps auth out of URL and sends a single ticket link", async (t) => {
  const h = await outbox(t);
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://gate.smsaero.ru/v2/sms/send");
    assert.equal(options.redirect, "error");
    assert.equal(
      options.headers.Authorization,
      "Basic " +
        Buffer.from("fixture@example.com:fixture-secret").toString("base64"),
    );
    assert.equal(options.body.get("number"), phone);
    assert.equal(options.body.get("sign"), "CHAIKATEAM");
    assert.match(
      options.body.get("text"),
      /https:\/\/events\.example\.com\/order\/fixture-token/,
    );
    return response(0);
  };
  await processOutbox(h.store, "https://events.example.com", false);
  assert.equal((await h.job()).status, "submitted");
  assert.equal((await h.job()).provider_id, "123");
  await processOutbox(h.store, "https://events.example.com", false);
  assert.equal(calls, 1);
});
test("status reconciliation confirms delivery without another send", async (t) => {
  const h = await outbox(t);
  global.fetch = async () => response(8);
  await processOutbox(h.store, "https://events.example.com", false);
  await h.store.run("UPDATE outbox SET next_at=0 WHERE id=?", h.id);
  global.fetch = async (url, options) => {
    assert.equal(url, "https://gate.smsaero.ru/v2/sms/status");
    assert.equal(options.body.get("id"), "123");
    return response(1);
  };
  await processOutbox(h.store, "https://events.example.com", false);
  assert.equal((await h.job()).status, "delivered");
  assert.equal((await h.job()).status_attempts, 1);
});
test("uncertain send is not retried automatically and raw errors stay private", async (t) => {
  const h = await outbox(t);
  let calls = 0;
  global.fetch = async () => {
    calls++;
    throw new Error("fixture-secret " + phone);
  };
  await processOutbox(h.store, "https://events.example.com", false);
  await processOutbox(h.store, "https://events.example.com", false);
  assert.equal(calls, 1);
  assert.equal((await h.job()).status, "unknown");
  assert.doesNotMatch((await h.job()).error, /fixture-secret|79990000000/);
});
test("final rejection is recorded and not automatically resent", async (t) => {
  const h = await outbox(t);
  global.fetch = async () => response(6);
  await processOutbox(h.store, "https://events.example.com", false);
  assert.equal((await h.job()).status, "failed");
  assert.equal((await h.job()).provider_id, "123");
});
test("polling failure retains accepted ID and never sends again", async (t) => {
  const h = await outbox(t);
  global.fetch = async () => response(0);
  await processOutbox(h.store, "https://events.example.com", false);
  await h.store.run(
    "UPDATE outbox SET next_at=0,status_attempts=99 WHERE id=?",
    h.id,
  );
  global.fetch = async (url) => {
    assert.ok(url.endsWith("/sms/status"));
    throw new Error("offline");
  };
  await processOutbox(h.store, "https://events.example.com", false);
  assert.equal((await h.job()).status, "unknown");
  assert.equal((await h.job()).provider_id, "123");
});
test("phone, ID and response shape must match before accepting SMS status", async (t) => {
  setup(t);
  for (const data of [
    response(1, { number: "79990000001" }),
    response(1, { id: 456 }),
    response(9),
  ]) {
    global.fetch = async () => data;
    await assert.rejects(readSmsAeroStatus("123", phone), {
      message: "sms_unknown",
    });
  }
  global.fetch = async () => Response.json({ success: true, data: [] });
  await assert.rejects(sendSmsAero(phone, "fixture"), {
    message: "sms_unknown",
  });
});
test("account preflight and sandbox send use only the designated methods", async (t) => {
  setup(t);
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return url.endsWith("/auth")
      ? Response.json({ success: true, data: null })
      : response(1);
  };
  await checkSmsAero();
  await sendSmsAero(phone, "fixture", { test: true });
  assert.deepEqual(urls, [
    "https://gate.smsaero.ru/v2/auth",
    "https://gate.smsaero.ru/v2/sms/testsend",
  ]);
});
test("demo orders and missing settings cannot send real SMS", async (t) => {
  const h = await outbox(t);
  global.fetch = async () => assert.fail("Unexpected provider request");
  await processOutbox(h.store, "https://events.example.com", true);
  assert.equal((await h.job()).status, "disabled");
  delete process.env.SMSAERO_API_KEY;
  assert.equal(channelReady("sms"), false);
});
