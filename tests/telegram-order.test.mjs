import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.mjs";
import { processOutbox, telegramOrderText } from "../server/delivery.mjs";
import { telegram } from "../server/telegram.mjs";
import nodemailer from "nodemailer";
import { testDatabase } from "./database-fixture.mjs";

async function fixture(t, { defaultChat = "-123", eventChat } = {}) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    DELIVERY_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "123:fixture",
  });
  if (defaultChat) process.env.TELEGRAM_CHAT_ID = defaultChat;
  else delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.SMSAERO_API_KEY;
  delete process.env.SMTP_HOST;
  t.after(() => {
    for (const key of Object.keys(process.env))
      if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  const { databaseUrl, cleanupDatabase } = await testDatabase();
  const app = await createApp({
    dbPath: ":memory:",
    databaseUrl,
    demo: true,
    testing: true,
  });
  t.after(async () => {
    await app.close();
    await cleanupDatabase?.();
  });
  const s = app.store;
  await s.setEventChat("red-moon", eventChat);
  await addOrder(s, "fixture", "red-moon");
  return s;
}
async function addOrder(s, id, eventId, oldProducer = false) {
  await s.run(
    `INSERT INTO orders(id,access_token,event_id,first_name,last_name,phone,email,quantity,unit_price,total,status,method,mode,created_at,expires_at,buyer_session,idempotency,request_hash,webhook_token)
     VALUES (?,?,?,'Тест','Гость','+79990000000','qa@example.com',1,500,500,'pending','sbp','live','2026-09-21','2026-10-01','session',?,'hash','hook')`,
    id,
    id,
    eventId,
    id,
  );
  if (oldProducer)
    await s.run(
      "INSERT OR IGNORE INTO outbox(id,order_id,channel,kind) VALUES (?,?,'telegram','created')",
      id,
      id,
    );
  else await s.enqueue(id, "created");
}
const run = (s) => processOutbox(s, "https://example.com", false);
test("annulled and explicitly marked test orders are not delivered even after a retry is queued", async (t) => {
  const s = await fixture(t);
  let sends = 0;
  t.mock.method(telegram, "send", async () => {
    sends++;
    return { status: "sent", providerId: "42" };
  });
  await s.run("UPDATE orders SET status='paid' WHERE id='fixture'");
  await s.manageOrder(
    "fixture",
    { action: "test", isTest: true, reason: "fixture" },
    "admin",
  );
  await s.run("UPDATE outbox SET status='retry'");
  await run(s);
  assert.equal(sends, 0);
  await s.manageOrder(
    "fixture",
    { action: "test", isTest: false, reason: "fixture" },
    "admin",
  );
  await s.manageOrder(
    "fixture",
    { action: "void", reason: "fixture" },
    "admin",
  );
  await s.run("UPDATE outbox SET status='retry'");
  await run(s);
  assert.equal(sends, 0);
  assert.equal((await s.get("SELECT status FROM outbox")).status, "disabled");
});
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
  await s.run("UPDATE outbox SET next_at=0 WHERE status='tg_retry'");
  await run(s);
  assert.deepEqual(ids, ["42", "42"]);
});
test("two events with the same Telegram message ID keep each order in its first chat across payment and SMS updates", async (t) => {
  const firstChat = "-1001701234567";
  const secondChat = "4503599627370495";
  const s = await fixture(t, { defaultChat: null, eventChat: firstChat });
  await s.run(
    `INSERT INTO events(id,title,subtitle,date,time,venue,address,price,capacity,description,dresscode,created_at)
     SELECT 'second','Второе мероприятие',subtitle,date,time,venue,address,price,capacity,description,dresscode,created_at FROM events WHERE id='red-moon'`,
  );
  await s.setEventChat("second", secondChat);
  await addOrder(s, "second-order", "second");
  await s.setEventChat("red-moon", null);
  await s.setEventChat("second", "-777");
  const sends = [],
    edits = [];
  t.mock.method(telegram, "send", async (text, chat) => {
    sends.push({ chat, text });
    return { status: "sent", providerId: "42" };
  });
  t.mock.method(telegram, "edit", async (id, text, chat) => {
    edits.push({ chat, id, text });
    return { status: "sent", providerId: id };
  });
  await run(s);
  assert.deepEqual(
    sends.map((x) => x.chat),
    [firstChat, secondChat],
  );
  assert.match(sends[1].text, /Второе мероприятие/);
  process.env.TELEGRAM_CHAT_ID = "-999";
  await s.markPaid("fixture");
  await s.markPaid("second-order");
  await run(s);
  assert.deepEqual(
    edits.map((x) => [x.chat, x.id]),
    [
      [firstChat, "42"],
      [secondChat, "42"],
    ],
  );
  assert.match(edits[0].text, /Статус: Оплачено/);
  assert.match(edits[1].text, /Второе мероприятие/);
  await run(s);
  assert.deepEqual(
    edits
      .slice(2)
      .map((x) => [x.chat, x.id])
      .sort(),
    [
      [firstChat, "42"],
      [secondChat, "42"],
    ],
  );
  await addOrder(s, "default-order", "red-moon");
  await addOrder(s, "updated-order", "second");
  await run(s);
  assert.deepEqual(
    sends.slice(2).map((x) => x.chat),
    ["-999", "-777"],
  );
});

test("rejected or uncertain initial sends never switch to the default or a changed event chat", async (t) => {
  const eventChat = "-1009876543210";
  const s = await fixture(t, { eventChat });
  const recipients = [];
  t.mock.method(telegram, "send", async (_text, chat) => {
    recipients.push(chat);
    throw new Error(
      recipients.length === 1 ? "telegram_rejected" : "telegram_unknown",
    );
  });
  await run(s);
  await s.setEventChat("red-moon", "-222");
  await s.run("UPDATE outbox SET next_at=0 WHERE status='tg_retry'");
  await run(s);
  await s.markPaid("fixture");
  await run(s);
  assert.deepEqual(recipients, [eventChat, eventChat]);
  assert.equal(
    (await s.get("SELECT status FROM outbox WHERE kind='created'")).status,
    "unknown",
  );
});

test("a delivery with no destination is skipped until a manual retry can bind its first chat", async (t) => {
  const s = await fixture(t, { defaultChat: null });
  const recipients = [];
  t.mock.method(telegram, "send", async (_text, chat) => {
    recipients.push(chat);
    return { status: "sent", providerId: "42" };
  });
  await run(s);
  assert.deepEqual(recipients, []);
  assert.equal((await s.get("SELECT status FROM outbox")).status, "disabled");
  await s.setEventChat("red-moon", "1234");
  await s.run("UPDATE outbox SET status='pending' WHERE status='disabled'");
  await run(s);
  assert.deepEqual(recipients, ["1234"]);
});

test("a legacy producer or stale worker cannot claim routed Telegram rows, including retries and rollback", async (t) => {
  const s = await fixture(t, { defaultChat: "-202" });
  await addOrder(s, "old-producer", "red-moon", true);
  // This is the exact scheduling predicate used by the previous release.
  const legacyJobs = () =>
    s.all(
      "SELECT * FROM outbox WHERE status IN ('pending','retry') AND next_at<=? ORDER BY rowid LIMIT 10",
      Date.now(),
    );
  assert.deepEqual(await legacyJobs(), []);
  const stale = await s.get("SELECT id FROM outbox WHERE order_id='fixture'");
  const claim = await s.run(
    "UPDATE outbox SET status='sending',attempts=attempts+1,next_at=?,provider_id=? WHERE id=? AND status IN ('pending','retry')",
    Date.now() + 120000,
    null,
    stale.id,
  );
  assert.equal(claim.changes, 0);
  await s.run(
    "UPDATE outbox SET status='disabled',error='Отправка не подключена или заказ тестовый' WHERE id=?",
    stale.id,
  );
  const recipients = [];
  t.mock.method(telegram, "send", async (_text, chat) => {
    recipients.push(chat);
    return { status: "sent", providerId: String(40 + recipients.length) };
  });
  const edits = [];
  t.mock.method(telegram, "edit", async (id, _text, chat) => {
    edits.push([id, chat]);
    return { status: "sent", providerId: id };
  });
  await run(s);
  assert.deepEqual(recipients, ["-202", "-202"]);
  await s.setEventChat("red-moon", "-303");
  await s.run("UPDATE outbox SET status='unknown' WHERE id=?", stale.id);
  // The old operator endpoint cleared provider_id and returned the row to pending.
  await s.run(
    "UPDATE outbox SET status='pending',next_at=0,provider_id=NULL,provider_status=NULL,status_attempts=0 WHERE id=? AND status='unknown'",
    stale.id,
  );
  assert.deepEqual(await legacyJobs(), []);
  await run(s);
  assert.deepEqual(edits, [["41", "-202"]]);
  await s.run(
    "INSERT INTO outbox(id,order_id,channel,kind) VALUES ('old-review','old-producer','telegram','review')",
  );
  assert.deepEqual(await legacyJobs(), []);
  await run(s);
  assert.deepEqual(edits[1], ["42", "-202"]);
});

test("unconfirmed historical messages cannot starve a new Telegram order, email or SMS", async (t) => {
  const s = await fixture(t);
  for (let i = 0; i < 35; i++) {
    const id = i === 0 ? "fixture" : `held-${i}`;
    if (i) await addOrder(s, id, "red-moon");
    await s.run(
      "UPDATE outbox SET status=?,attempts=1,provider_id=NULL WHERE order_id=?",
      i % 2 ? "sent" : "unknown",
      id,
    );
    await s.enqueue(id, "review");
  }
  await addOrder(s, "new-order", "red-moon");
  await s.markPaid("new-order");
  Object.assign(process.env, {
    SMTP_HOST: "fixture",
    SMTP_USER: "fixture",
    SMTP_PASS: "fixture",
    MAIL_FROM: "qa@example.com",
    SMSAERO_EMAIL: "qa@example.com",
    SMSAERO_API_KEY: "fixture",
    SMSAERO_SIGN: "fixture",
  });
  const mail = t.mock.fn(async () => ({ accepted: ["qa@example.com"] }));
  t.mock.method(nodemailer, "createTransport", () => ({ sendMail: mail }));
  const sms = t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /smsaero\.ru\/v2\/sms\/send$/);
    return Response.json({
      success: true,
      data: { id: 321, number: "79990000000", status: 1 },
    });
  });
  const sends = t.mock.method(telegram, "send", async () => ({
    status: "sent",
    providerId: "77",
  }));
  const edits = t.mock.method(telegram, "edit", async (id) => ({
    status: "sent",
    providerId: id,
  }));
  await run(s);
  assert.equal(
    Number(
      (
        await s.get(
          "SELECT COUNT(*) AS n FROM outbox WHERE status='waiting_message'",
        )
      ).n,
    ),
    35,
  );
  assert.equal(mail.mock.callCount(), 1);
  assert.equal(sms.mock.callCount(), 1);
  assert.equal(sends.mock.callCount(), 1);
  assert.equal(edits.mock.callCount(), 1);
  const tickets = await s.all(
    "SELECT channel,status FROM outbox WHERE order_id='new-order' AND kind='tickets' ORDER BY channel",
  );
  assert.deepEqual(
    tickets.map((j) => [j.channel, j.status]),
    [
      ["email", "sent"],
      ["sms", "delivered"],
      ["telegram", "sent"],
    ],
  );
});

test("the old default @username resolves to a numeric chat before sending and is then immutable", async (t) => {
  const s = await fixture(t, { defaultChat: "@legacy_group" });
  const lookup = t.mock.method(telegram, "resolveChat", async (alias) => {
    assert.equal(alias, "@legacy_group");
    if (lookup.mock.callCount() === 0) throw new Error("telegram_unknown");
    return "-123456789";
  });
  const sends = t.mock.method(telegram, "send", async (_text, chat) => {
    assert.equal(chat, "-123456789");
    assert.equal(
      (
        await s.get(
          "SELECT chat_id FROM order_telegram_destinations WHERE order_id='fixture'",
        )
      ).chat_id,
      chat,
    );
    return { status: "sent", providerId: "42" };
  });
  const edits = t.mock.method(telegram, "edit", async (id, _text, chat) => {
    assert.equal(chat, "-123456789");
    return { status: "sent", providerId: id };
  });
  await run(s);
  assert.equal(sends.mock.callCount(), 0);
  assert.equal((await s.get("SELECT attempts FROM outbox")).attempts, 0);
  process.env.TELEGRAM_CHAT_ID = "@different_group";
  await s.run("UPDATE outbox SET next_at=0");
  await run(s);
  await s.enqueue("fixture", "review");
  await run(s);
  assert.equal(lookup.mock.callCount(), 2);
  assert.equal(sends.mock.callCount(), 1);
  assert.equal(edits.mock.callCount(), 1);
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
  assert.match(text, /требуется проверка заказа/);
  assert.match(text, /Билеты ещё не выпущены/);
  assert.match(text, /СМС не доставлено/);
});

test("paid Telegram message contains one group ticket link for manual forwarding", () => {
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
  assert.ok(text.includes(`https://example.com/ticket/${tickets[0].code}`));
  assert.equal(
    (text.match(/https:\/\/example.com\/ticket\//g) || []).length,
    1,
  );
  assert.match(text, /Билетов: 5/);
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
