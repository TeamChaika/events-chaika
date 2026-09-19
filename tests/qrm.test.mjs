import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStatus,
  paymentLink,
  readStatus,
  createPayment,
  checkMerchant,
} from "../server/qrm.mjs";
import { randomUUID } from "node:crypto";

test("status schema requires an exact integer amount", () => {
  assert.deepEqual(
    parseStatus({
      results: { operation_status_code: 5, operation_sum: 500000 },
    }),
    { operation_status_code: 5, operation_sum: 500000 },
  );
  assert.throws(() =>
    parseStatus({
      results: { operation_status_code: 5, operation_sum: "500000" },
    }),
  );
});
test("live terminal must match pinned merchant and have an active subscription", async (t) => {
  const previous = { ...process.env },
    original = global.fetch;
  Object.assign(process.env, {
    QRM_API_BASE_URL: "https://app.qrm.ooo",
    QRM_LIVE_API_KEY: "fixture",
    QRM_EXPECTED_MERCHANT_ID: "expected",
  });
  t.after(() => {
    global.fetch = original;
    for (const key of [
      "QRM_API_BASE_URL",
      "QRM_LIVE_API_KEY",
      "QRM_EXPECTED_MERCHANT_ID",
    ])
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
  });
  const merchant = {
    merchant_id: "expected",
    firm_name: "Fixture",
    qrt_is_b2c: true,
    requires_receipt: false,
    subscription_end_date: "2099-01-01",
  };
  global.fetch = async () =>
    Response.json({ ...merchant, merchant_id: "another" });
  await assert.rejects(checkMerchant("live"), /получатель/);
  global.fetch = async () =>
    Response.json({ ...merchant, subscription_end_date: "2020-01-01" });
  await assert.rejects(checkMerchant("live"), /не готов/);
  global.fetch = async () => Response.json(merchant);
  assert.equal((await checkMerchant("live")).merchant_id, "expected");
});
test("payment URLs reject untrusted domains and dangerous protocols", () => {
  assert.equal(
    paymentLink("https://qr.nspk.ru/test"),
    "https://qr.nspk.ru/test",
  );
  for (const u of [
    "javascript:alert(1)",
    "http://qr.nspk.ru/test",
    "https://nspk.ru.evil.example/a",
    "https://user:pass@qr.nspk.ru/a",
  ])
    assert.throws(() => paymentLink(u));
});
test("chunked SSE with keepalive is parsed and closed", async (t) => {
  const original = global.fetch;
  const old = process.env.QRM_API_KEY;
  process.env.QRM_API_KEY = "fixture-key";
  let cancelled = false;
  t.after(() => {
    global.fetch = original;
    if (old === undefined) delete process.env.QRM_API_KEY;
    else process.env.QRM_API_KEY = old;
  });
  global.fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const text of [
            ": heartbeat\r\n\r\n",
            'data: {"results":{"operation_status_code":',
            '5,"operation_sum":1000000}}\r\n\r\n',
          ])
            c.enqueue(new TextEncoder().encode(text));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  assert.equal(
    (await readStatus(randomUUID(), "sandbox")).operation_sum,
    1000000,
  );
  assert.equal(cancelled, true);
});
test("QRM creation preflights terminal, uses kopecks and correlates callback", async (t) => {
  const original = global.fetch;
  const old = process.env.QRM_API_KEY;
  process.env.QRM_API_KEY = "fixture-key";
  const calls = [];
  t.after(() => {
    global.fetch = original;
    if (old === undefined) delete process.env.QRM_API_KEY;
    else process.env.QRM_API_KEY = old;
  });
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify(
        url.includes("check-api-key")
          ? {
              merchant_id: "test-merchant",
              firm_name: "Fixture",
              qrt_is_b2c: true,
              requires_receipt: false,
            }
          : {
              results: {
                operation_id: randomUUID(),
                qr_link: "https://qr.nspk.ru/fixture",
              },
            },
      ),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  const order = {
    id: randomUUID(),
    mode: "sandbox",
    total: 1000000,
    unit_price: 500000,
    quantity: 2,
    webhook_token: "test-token",
    access_token: "access-token",
    email: "qa@example.com",
  };
  await createPayment(
    order,
    { title: "Тестовое событие" },
    "https://events.example.com",
  );
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.sum, 1000000);
  assert.equal(body.nomenclature[0].price, 500000);
  assert.ok(body.notification_url.includes(order.id));
});
