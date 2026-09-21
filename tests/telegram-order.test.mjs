import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.mjs";
import { processOutbox, telegramOrderText } from "../server/delivery.mjs";
import { telegram } from "../server/telegram.mjs";

async function fixture(t) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    DELIVERY_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "123:fixture",
    TELEGRAM_CHAT_ID: "-123",
  });
  delete process.env.SMSAERO_API_KEY;
  delete process.env.SMTP_HOST;
  t.after(() => {
    for (const key of Object.keys(process.env))
      if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  const app = await createApp({
    dbPath: ":memory:",
    demo: true,
    testing: true,
  });
  t.after(() => app.close());
  const s = app.store;
  await s.run(`INSERT INTO orders(id,access_token,event_id,first_name,last_name,phone,email,quantity,unit_price,total,status,method,mode,created_at,expires_at,buyer_session,idempotency,request_hash,webhook_token)
    VALUES ('fixture','access','red-moon','Тест','Гость','+79990000000','qa@example.com',1,500,500,'pending','sbp','live','2026-09-21','2026-10-01','session','key','hash','hook')`);
  await s.enqueue("fixture", "created");
  return s;
}
const run = (s) => processOutbox(s, "https://example.com", false);
test("one Telegram message is edited after payment and confirmed SMS delivery", async (t) => {
  const s = await fixture(t);
  const sent = [],
    edited = [];
  t.mock.method(telegram, "send", async (text) => {
    sent.push(text);
    return { status: "sent", providerId: "42" };
  });
  t.mock.method(telegram, "edit", async (id, text) => {
    edited.push({ id, text });
    return { status: "sent", providerId: id };
  });
  await run(s);
  assert.match(sent[0], /Ожидает оплаты/);
  await s.run("UPDATE orders SET status='paid' WHERE id='fixture'");
  await s.run(
    "INSERT INTO tickets(id,code,order_id,ordinal) VALUES ('ticket','code','fixture',1)",
  );
  await s.enqueue("fixture", "tickets");
  await s.run(
    "UPDATE outbox SET status='submitted',provider_id='123' WHERE channel='sms'",
  );
  await run(s);
  assert.equal(sent.length, 1);
  assert.equal(edited[0].id, "42");
  assert.match(edited[0].text, /Статус: Оплачено/);
  assert.match(edited[0].text, /Билеты выпущены: 1/);
  assert.match(edited[0].text, /ожидаем доставку/);
  assert.doesNotMatch(edited[0].text, /СМС доставлено/);
  await s.run("UPDATE outbox SET status='delivered' WHERE channel='sms'");
  await run(s);
  assert.equal(edited.length, 2);
  assert.match(edited[1].text, /СМС доставлено/);
  await run(s);
  assert.equal(edited.length, 2);
  assert.equal(sent.length, 1);
});
test("parallel workers serialize sends and edits for the same order", async (t) => {
  const s = await fixture(t);
  await s.enqueue("fixture", "review");
  let sends = 0,
    active = 0;
  t.mock.method(telegram, "send", async () => {
    sends++;
    active++;
    await new Promise((r) => setTimeout(r, 25));
    active--;
    return { status: "sent", providerId: "42" };
  });
  t.mock.method(telegram, "edit", async (id) => {
    assert.equal(active, 0);
    return { status: "sent", providerId: id };
  });
  await Promise.all([run(s), run(s)]);
  assert.equal(sends, 1);
});
test("unknown initial send does not create another message for a later lifecycle event", async (t) => {
  const s = await fixture(t);
  let sends = 0;
  t.mock.method(telegram, "send", async () => {
    sends++;
    throw new Error("telegram_unknown");
  });
  await run(s);
  await s.enqueue("fixture", "review");
  await run(s);
  assert.equal(sends, 1);
});
test("uncertain edit retries the same message ID instead of sending again", async (t) => {
  const s = await fixture(t);
  t.mock.method(telegram, "send", async () => ({
    status: "sent",
    providerId: "42",
  }));
  await run(s);
  await s.enqueue("fixture", "review");
  const ids = [];
  t.mock.method(telegram, "edit", async (id) => {
    ids.push(id);
    if (ids.length === 1) throw new Error("telegram_unknown");
    return { status: "sent", providerId: id };
  });
  await run(s);
  await s.run("UPDATE outbox SET next_at=0 WHERE status='retry'");
  await run(s);
  assert.deepEqual(ids, ["42", "42"]);
});
test("failed SMS and payment review are not reported as delivered or issued", () => {
  const text = telegramOrderText(
    {
      status: "paid_review",
      method: "sbp",
      id: "fixture",
      total: 500,
      quantity: 1,
    },
    { title: "Ночь" },
    [],
    { status: "failed" },
  );
  assert.match(text, /требуется проверка мест/);
  assert.match(text, /Билеты ещё не выпущены/);
  assert.match(text, /СМС не доставлено/);
});

test("paid Telegram message contains one numbered direct link per ticket for manual forwarding", () => {
  const tickets = Array.from({ length: 5 }, (_, i) => ({
    ordinal: i + 1,
    code: String(i).repeat(48),
  }));
  const order = {
    status: "paid",
    method: "sbp",
    id: "fixture",
    total: 2500,
    quantity: 5,
  };
  const text = telegramOrderText(
    order,
    { title: "Ночь" },
    tickets,
    { status: "failed" },
    "https://example.com",
  );
  for (const ticket of tickets)
    assert.ok(
      text.includes(
        `Билет ${ticket.ordinal}: https://example.com/ticket/${ticket.code}`,
      ),
    );
  assert.doesNotMatch(text, /\/order\//);
  assert.ok(text.length < 4096);
  const pending = telegramOrderText(
    { ...order, status: "pending" },
    { title: "Ночь" },
    [],
    undefined,
    "https://example.com",
  );
  assert.doesNotMatch(pending, /\/ticket\//);
});
