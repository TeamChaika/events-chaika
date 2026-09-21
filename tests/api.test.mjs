import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.mjs";
import pg from "pg";

const origin = "http://localhost:5173";
const guest = {
  first_name: "Тест",
  last_name: "Проверочный",
  phone: "+79990000000",
  email: "qa@example.com",
  quantity: 2,
  event_id: "red-moon",
  consent: true,
};
async function harness(t, options = {}) {
  let databaseUrl, cleanupDatabase;
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Tests require a local PostgreSQL instance");
    const pool = new pg.Pool({ connectionString: url.toString() });
    const schema = "test_" + randomUUID().replaceAll("-", "");
    await pool.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    databaseUrl = url.toString();
    cleanupDatabase = async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    };
  }
  const instance = await createApp({
    dbPath: ":memory:",
    databaseUrl,
    demo: true,
    origin,
    testing: true,
    ...options,
  });
  await instance.store.run(
    "UPDATE events SET date=?",
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await instance.close();
    await cleanupDatabase?.();
  });
  const request = async (
    path,
    { method = "GET", body, key, asOrigin = options.origin || origin } = {},
  ) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: asOrigin,
        Cookie: cookie,
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie();
    for (const c of set) {
      const value = c.split(";")[0];
      cookie = cookie
        .split("; ")
        .filter((s) => s.split("=")[0] !== value.split("=")[0])
        .concat(value)
        .filter(Boolean)
        .join("; ");
    }
    return { status: r.status, body: await r.json() };
  };
  await request("/config");
  const order = (body = guest, key = randomUUID()) =>
    request("/orders", { method: "POST", body, key });
  const login = (role = "admin") =>
    request("/auth/login", { method: "POST", body: { role, demo: true } });
  return { ...instance, request, order, login, databaseUrl, base };
}

test("SMS checks require admin and known SMS IDs are rechecked without resending", async (t) => {
  const h = await harness(t);
  assert.equal(
    (await h.request("/admin/smsaero/check", { method: "POST", body: {} }))
      .status,
    401,
  );
  await h.login("door");
  assert.equal(
    (await h.request("/admin/smsaero/check", { method: "POST", body: {} }))
      .status,
    403,
  );
  const result = await h.order();
  await h.store.markPaid(result.body.id);
  const job = await h.store.get(
    "SELECT id FROM outbox WHERE order_id=? AND channel='sms'",
    result.body.id,
  );
  await h.store.run(
    "UPDATE outbox SET status='unknown',provider_id='123',status_attempts=100 WHERE id=?",
    job.id,
  );
  await h.login();
  assert.equal(
    (
      await h.request(`/admin/deliveries/${job.id}/retry`, {
        method: "POST",
        body: {},
      })
    ).status,
    200,
  );
  const updated = await h.store.get("SELECT * FROM outbox WHERE id=?", job.id);
  assert.equal(updated.status, "submitted");
  assert.equal(updated.provider_id, "123");
  assert.equal(updated.status_attempts, 0);
  assert.equal(
    (
      await h.request(`/admin/deliveries/${job.id}/retry`, {
        method: "POST",
        body: {},
      })
    ).status,
    409,
  );
  await h.store.run("UPDATE outbox SET status='delivered' WHERE id=?", job.id);
  assert.equal(
    (
      await h.request(`/admin/deliveries/${job.id}/retry`, {
        method: "POST",
        body: {},
      })
    ).status,
    409,
  );
});

test("server calculates total; pending order has no tickets", async (t) => {
  const h = await harness(t);
  const r = await h.order({ ...guest, total: 1, unit_price: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.body.total, 1000000);
  assert.equal(r.body.status, "pending");
  assert.equal(r.body.tickets.length, 0);
});
test("idempotent checkout returns the same order, rejects changed input", async (t) => {
  const h = await harness(t),
    key = randomUUID();
  const a = await h.order(guest, key),
    b = await h.order(guest, key);
  assert.equal(a.body.id, b.body.id);
  assert.equal((await h.store.get("SELECT COUNT(*) n FROM orders")).n, 1);
  const changed = await h.order({ ...guest, quantity: 3 }, key);
  assert.equal(changed.status, 409);
});
test("parallel last-seat reservations cannot oversell", async (t) => {
  const h = await harness(t);
  await h.store.run("UPDATE events SET capacity=2");
  const results = await Promise.all([h.order(), h.order()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await h.store.event("red-moon")).available, 0);
});
test("payment issues one QR per guest exactly once", async (t) => {
  const h = await harness(t),
    r = await h.order(),
    path = "/orders/" + r.body.access_token;
  await Promise.all([
    h.request(path + "/demo-pay", { method: "POST", body: {} }),
    h.request(path + "/demo-pay", { method: "POST", body: {} }),
  ]);
  const paid = await h.request(path);
  assert.equal(paid.body.status, "paid");
  assert.equal(paid.body.tickets.length, 2);
  assert.notEqual(paid.body.tickets[0].code, paid.body.tickets[1].code);
  assert.equal(
    (await h.store.get("SELECT COUNT(*) n FROM outbox WHERE kind='tickets'")).n,
    3,
  );
});
test("QR check-in is atomic and rejects a second entry", async (t) => {
  const h = await harness(t),
    r = await h.order();
  await h.request("/orders/" + r.body.access_token + "/demo-pay", {
    method: "POST",
    body: {},
  });
  const code = (await h.store.get("SELECT code FROM tickets")).code;
  await h.login("door");
  const results = await Promise.all([
    h.request("/checkin", {
      method: "POST",
      body: { code, event_id: "red-moon" },
    }),
    h.request("/checkin", {
      method: "POST",
      body: { code, event_id: "red-moon" },
    }),
  ]);
  assert.deepEqual(results.map((r) => r.body.accepted).sort(), [false, true]);
});
test("wrong event and unknown tickets cannot enter", async (t) => {
  const h = await harness(t),
    r = await h.order();
  await h.store.markPaid(r.body.id);
  await h.login("door");
  const code = (await h.store.get("SELECT code FROM tickets")).code;
  assert.equal(
    (
      await h.request("/checkin", {
        method: "POST",
        body: { code, event_id: "other" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.request("/checkin", {
        method: "POST",
        body: { code: "a".repeat(48), event_id: "red-moon" },
      })
    ).status,
    404,
  );
  assert.equal(
    (await h.store.get("SELECT used_at FROM tickets")).used_at,
    null,
  );
});
test("staff authorization and CSRF are enforced", async (t) => {
  const h = await harness(t);
  assert.equal((await h.request("/admin/overview")).status, 401);
  await h.login("door");
  const overview = await h.request("/admin/overview");
  assert.equal(overview.body.orders, undefined);
  assert.equal(
    (await h.request("/admin/issue", { method: "POST", body: guest })).status,
    403,
  );
  assert.equal(
    (
      await h.request("/auth/logout", {
        method: "POST",
        body: {},
        asOrigin: "https://evil.example",
      })
    ).status,
    403,
  );
});
test("invite tickets are free; cash requires receipt confirmation; issue is idempotent", async (t) => {
  const h = await harness(t);
  await h.login();
  const key = randomUUID();
  const issue = () =>
    h.request("/admin/issue", {
      method: "POST",
      key,
      body: { ...guest, method: "invite" },
    });
  const a = await issue(),
    b = await issue();
  assert.equal(a.status, 201);
  assert.equal(a.body.url, b.body.url);
  assert.equal((await h.store.get("SELECT total FROM orders")).total, 0);
  assert.equal((await h.store.get("SELECT COUNT(*) n FROM tickets")).n, 2);
  assert.equal(
    (
      await h.request("/admin/issue", {
        method: "POST",
        key: randomUUID(),
        body: { ...guest, method: "cash" },
      })
    ).status,
    400,
  );
});
test("price changes do not rewrite existing orders", async (t) => {
  const h = await harness(t),
    r = await h.order();
  await h.login();
  const e = await h.store.event("red-moon");
  const updated = await h.request("/admin/events/red-moon", {
    method: "PUT",
    body: { ...e, price: 600000, published: true, sales_open: true },
  });
  assert.equal(updated.status, 200);
  const another = await h.order();
  assert.equal(another.body.total, 1200000);
  assert.equal(
    (await h.store.get("SELECT total FROM orders WHERE id=?", r.body.id)).total,
    1000000,
  );
});
test("capacity cannot be reduced below reserved seats", async (t) => {
  const h = await harness(t);
  await h.order();
  await h.login();
  const e = await h.store.event("red-moon");
  assert.equal(
    (
      await h.request("/admin/events/red-moon", {
        method: "PUT",
        body: { ...e, capacity: 1, published: true, sales_open: true },
      })
    ).status,
    409,
  );
});
test("demo expiry releases reservations and refuses simulated late pay", async (t) => {
  const h = await harness(t),
    r = await h.order();
  await h.store.run("UPDATE orders SET expires_at=?", "2000-01-01");
  await h.tick();
  assert.equal((await h.store.event("red-moon")).available, 200);
  assert.equal(
    (
      await h.request("/orders/" + r.body.access_token + "/demo-pay", {
        method: "POST",
        body: {},
      })
    ).status,
    409,
  );
});
test("missing consent, invalid quantity and hidden event are rejected", async (t) => {
  const h = await harness(t);
  assert.equal((await h.order({ ...guest, consent: false })).status, 400);
  assert.equal((await h.order({ ...guest, quantity: 0 })).status, 400);
  await h.store.run("UPDATE events SET published=0");
  assert.equal((await h.order()).status, 409);
});
test("QRM callback body cannot mark a demo order as paid", async (t) => {
  const h = await harness(t),
    r = await h.order();
  const saved = await h.store.get("SELECT * FROM orders WHERE id=?", r.body.id);
  const path = "/webhooks/qrm/" + saved.id + "/";
  assert.equal(
    (await h.request(path + "wrong", { method: "POST", body: { status: 5 } }))
      .status,
    403,
  );
  await h.request(path + saved.webhook_token, {
    method: "POST",
    body: { operation_status_code: 5 },
  });
  assert.equal(
    (await h.store.get("SELECT status FROM orders")).status,
    "pending",
  );
});
test("demo jobs are not sent externally", async (t) => {
  const h = await harness(t),
    r = await h.order();
  await h.store.markPaid(r.body.id);
  await h.tick();
  assert.equal(
    (await h.store.all("SELECT status FROM outbox")).every(
      (j) => j.status === "disabled",
    ),
    true,
  );
});
test("live application with disabled QRM cannot create orders or simulate payments", async (t) => {
  const h = await harness(t, { demo: false });
  assert.equal((await h.order()).status, 503);
  assert.equal(
    (await h.request("/orders/a/demo-pay", { method: "POST", body: {} }))
      .status,
    404,
  );
  assert.equal(
    (await h.request("/auth/login", { method: "POST", body: { demo: true } }))
      .status,
    401,
  );
});

test("QRM confirmation checks saved operation amount, ignores forged callback and never downgrades paid", async (t) => {
  const originalFetch = global.fetch;
  const oldMode = process.env.QRM_MODE,
    oldKey = process.env.QRM_API_KEY;
  process.env.QRM_MODE = "sandbox";
  process.env.QRM_API_KEY = "fixture-only";
  let status = 3,
    amount = 1000000,
    posts = 0;
  const operation = randomUUID();
  global.fetch = async (url, init) => {
    if (String(url).startsWith("https://app.devwapiserv.qrm.ooo")) {
      let data;
      if (String(url).includes("check-api-key"))
        data = {
          merchant_id: "fixture",
          firm_name: "Fixture",
          qrt_is_b2c: true,
          requires_receipt: false,
        };
      else if (String(url).includes("sse-operations"))
        data = {
          results: { operation_status_code: status, operation_sum: amount },
        };
      else {
        posts++;
        data = {
          results: {
            operation_id: operation,
            qr_link: "https://qr.nspk.ru/fixture",
          },
        };
      }
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(url, init);
  };
  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of [
      ["QRM_MODE", oldMode],
      ["QRM_API_KEY", oldKey],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const h = await harness(t, {
      demo: false,
      origin: "https://events.example.com",
    }),
    r = await h.order();
  assert.equal(r.status, 201);
  assert.equal(posts, 1);
  const o = await h.store.get("SELECT * FROM orders WHERE id=?", r.body.id);
  const callback = "/webhooks/qrm/" + o.id + "/" + o.webhook_token;
  await h.request(callback, {
    method: "POST",
    body: { operation_status_code: 5 },
  });
  assert.equal(
    (await h.store.get("SELECT status FROM orders")).status,
    "pending",
  );
  status = 5;
  amount = 1;
  await h.request(callback, { method: "POST", body: {} });
  assert.equal(
    (await h.store.get("SELECT status FROM orders")).status,
    "pending",
  );
  assert.equal((await h.store.get("SELECT COUNT(*) n FROM tickets")).n, 0);
  amount = 1000000;
  await h.request(callback, { method: "POST", body: {} });
  assert.equal((await h.store.get("SELECT status FROM orders")).status, "paid");
  status = 3;
  await h.request(callback, { method: "POST", body: {} });
  assert.equal((await h.store.get("SELECT status FROM orders")).status, "paid");
  assert.equal((await h.store.get("SELECT COUNT(*) n FROM tickets")).n, 2);
  const code = (await h.store.get("SELECT code FROM tickets")).code;
  await assert.rejects(
    async () => await h.store.checkin(code, "red-moon", "door", false),
    /Тестовый билет/,
  );
});

test("uncertain QRM POST is persisted and never blindly repeated", async (t) => {
  const originalFetch = global.fetch,
    oldMode = process.env.QRM_MODE,
    oldKey = process.env.QRM_API_KEY;
  process.env.QRM_MODE = "sandbox";
  process.env.QRM_API_KEY = "fixture-only";
  let posts = 0;
  global.fetch = async (url, init) => {
    if (String(url).startsWith("https://app.devwapiserv.qrm.ooo")) {
      if (String(url).includes("check-api-key"))
        return new Response(
          JSON.stringify({
            merchant_id: "fixture",
            firm_name: "Fixture",
            qrt_is_b2c: true,
            requires_receipt: false,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      posts++;
      throw new TypeError("fixture timeout");
    }
    return originalFetch(url, init);
  };
  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of [
      ["QRM_MODE", oldMode],
      ["QRM_API_KEY", oldKey],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const h = await harness(t, {
      demo: false,
      origin: "https://events.example.com",
    }),
    key = randomUUID();
  const a = await h.order(guest, key),
    b = await h.order(guest, key);
  assert.equal(a.body.status, "unknown");
  assert.equal(a.body.id, b.body.id);
  assert.equal(posts, 1);
  assert.equal((await h.store.get("SELECT COUNT(*) n FROM tickets")).n, 0);
});

test("poster upload requires admin and rejects executable formats and forged image types", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "chaika-media-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const h = await harness(t, { mediaDir: directory });
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ6EAAAAASUVORK5CYII=";
  assert.equal(
    (await h.request("/admin/media", { method: "POST", body: { data: image } }))
      .status,
    401,
  );
  await h.login("door");
  assert.equal(
    (await h.request("/admin/media", { method: "POST", body: { data: image } }))
      .status,
    403,
  );
  await h.login();
  assert.equal(
    (
      await h.request("/admin/media", {
        method: "POST",
        body: { data: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.request("/admin/media", {
        method: "POST",
        body: { data: "data:image/png;base64,PHN2Zz48L3N2Zz4=" },
      })
    ).status,
    400,
  );
  const uploaded = await h.request("/admin/media", {
    method: "POST",
    body: { data: image },
  });
  assert.equal(uploaded.status, 201);
  assert.match(uploaded.body.url, /^\/media\/[a-f0-9]{48}\.png$/);
  const poster = await fetch(h.base + uploaded.body.url);
  assert.equal(poster.status, 200);
  assert.ok((await poster.arrayBuffer()).byteLength > 8);
  const e = await h.store.event("red-moon");
  const saved = await h.request("/admin/events/red-moon", {
    method: "PUT",
    body: {
      ...e,
      published: true,
      sales_open: true,
      hero_image: uploaded.body.url,
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.hero_image, uploaded.body.url);
});

test("event creation and cash issue work without changing the agreed initial price", async (t) => {
  const h = await harness(t);
  await h.login();
  const e = await h.store.event("red-moon");
  const created = await h.request("/admin/events", {
    method: "POST",
    body: {
      ...e,
      title: "Другое событие",
      price: 700000,
      published: false,
      sales_open: false,
    },
  });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.id, "red-moon");
  assert.equal((await h.request("/events")).body.length, 1);
  const cash = await h.request("/admin/issue", {
    method: "POST",
    key: randomUUID(),
    body: { ...guest, method: "cash", cash_received: true },
  });
  assert.equal(cash.status, 201);
  const order = await h.store.get("SELECT * FROM orders WHERE method='cash'");
  assert.equal(order.status, "paid");
  assert.equal(order.total, 1000000);
});

test(
  "PostgreSQL survives a new app instance and serializes check-in across instances",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const first = await harness(t);
    const order = await first.order();
    await first.store.markPaid(order.body.id);
    const code = (
      await first.store.get("SELECT code FROM tickets ORDER BY ordinal LIMIT 1")
    ).code;
    await first.login();
    const uploaded = await first.request("/admin/media", {
      method: "POST",
      body: {
        data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ6EAAAAASUVORK5CYII=",
      },
    });
    assert.equal(uploaded.status, 201);
    const second = await createApp({
      databaseUrl: first.databaseUrl,
      demo: true,
      origin,
      testing: true,
    });
    try {
      assert.equal(
        (
          await second.store.get(
            "SELECT status FROM orders WHERE id=?",
            order.body.id,
          )
        ).status,
        "paid",
      );
      const media = await second.store.get(
        "SELECT content FROM media WHERE filename=?",
        uploaded.body.url.split("/").pop(),
      );
      assert.ok(media.content.length > 8);
      const outcomes = await Promise.all([
        first.store.checkin(code, "red-moon", "door", true),
        second.store.checkin(code, "red-moon", "door", true),
      ]);
      assert.deepEqual(outcomes.map((r) => r.accepted).sort(), [false, true]);
    } finally {
      await second.close();
    }
  },
);

test("startup preserves another instance's in-flight payment and delivery", async (t) => {
  const h = await harness(t);
  const r = await h.order();
  await h.store.run(
    "UPDATE orders SET status='creating',mode='live' WHERE id=?",
    r.body.id,
  );
  await h.store.run(
    "UPDATE outbox SET status='sending',next_at=?",
    Date.now() + 120000,
  );
  await h.tick();
  assert.equal(
    (await h.store.get("SELECT status FROM orders")).status,
    "creating",
  );
  assert.equal(
    (await h.store.get("SELECT status FROM outbox")).status,
    "sending",
  );
  await h.store.run("UPDATE orders SET created_at='2000-01-01'");
  await h.store.run("UPDATE outbox SET next_at=0");
  await h.tick();
  assert.equal(
    (await h.store.get("SELECT status FROM orders")).status,
    "unknown",
  );
  assert.equal(
    (await h.store.get("SELECT status FROM outbox")).status,
    "unknown",
  );
});

test("ephemeral hosting fails closed without PostgreSQL", async () => {
  const old = process.env.REQUIRE_POSTGRES;
  process.env.REQUIRE_POSTGRES = "true";
  try {
    await assert.rejects(
      () => createApp({ databaseUrl: "", testing: true }),
      /DATABASE_URL is required/,
    );
  } finally {
    if (old === undefined) delete process.env.REQUIRE_POSTGRES;
    else process.env.REQUIRE_POSTGRES = old;
  }
});

test("five real QR images admit three guests first and two later, with shared counters", async (t) => {
  const { PNG } = await import("pngjs");
  const {
    RGBLuminanceSource,
    BinaryBitmap,
    HybridBinarizer,
    QRCodeReader,
    DecodeHintType,
  } = await import("@zxing/library");
  const h = await harness(t);
  const order = await h.order({ ...guest, quantity: 5 });
  await h.store.markPaid(order.body.id);
  const paid = await h.request("/orders/" + order.body.access_token);
  assert.equal(paid.body.tickets.length, 5);
  const decoded = paid.body.tickets.map((ticket) => {
    const png = PNG.sync.read(
      Buffer.from(ticket.qr_image.split(",")[1], "base64"),
    );
    const pixels = new Int32Array(png.width * png.height);
    for (let i = 0; i < pixels.length; i++)
      pixels[i] =
        (png.data[i * 4] << 16) |
        (png.data[i * 4 + 1] << 8) |
        png.data[i * 4 + 2];
    return new QRCodeReader()
      .decode(
        new BinaryBitmap(
          new HybridBinarizer(
            new RGBLuminanceSource(pixels, png.width, png.height),
          ),
        ),
        // The API supplies a clean QR image; camera perspective needs a device check.
        new Map([[DecodeHintType.PURE_BARCODE, true]]),
      )
      .getText();
  });
  assert.equal(
    (await h.request("/checkin/summary?event_id=red-moon")).status,
    401,
  );
  await h.login("door");
  for (let i = 0; i < 3; i++) {
    const scan = await h.request("/checkin", {
      method: "POST",
      body: { code: decoded[i], event_id: "red-moon" },
    });
    assert.equal(scan.body.accepted, true);
    assert.deepEqual(scan.body.group, {
      issued: 5,
      checked: i + 1,
      remaining: 4 - i,
    });
  }
  const counts = await h.request("/checkin/summary?event_id=red-moon");
  assert.equal(counts.body.checked, 3);
  assert.equal(counts.body.remaining, 2);
  const duplicate = await h.request("/checkin", {
    method: "POST",
    body: { code: decoded[0], event_id: "red-moon" },
  });
  assert.equal(duplicate.body.accepted, false);
  assert.deepEqual(duplicate.body.group, {
    issued: 5,
    checked: 3,
    remaining: 2,
  });
  for (const code of decoded.slice(3))
    assert.equal(
      (
        await h.request("/checkin", {
          method: "POST",
          body: { code, event_id: "red-moon" },
        })
      ).body.accepted,
      true,
    );
  const final = await h.request("/checkin/summary?event_id=red-moon");
  assert.equal(final.body.checked, 5);
  assert.equal(final.body.remaining, 0);
  await h.login();
  const overview = await h.request("/admin/overview");
  assert.equal(
    overview.body.orders.find((o) => o.id === order.body.id).checked_count,
    5,
  );
});

test("live attendance counts exclude demo tickets and invalid orders", async (t) => {
  const h = await harness(t);
  const demoOrder = await h.order({ ...guest, quantity: 2 });
  await h.store.markPaid(demoOrder.body.id);
  const realOrder = await h.order({ ...guest, quantity: 3 });
  await h.store.markPaid(realOrder.body.id);
  await h.store.run(
    "UPDATE orders SET mode='live' WHERE id=?",
    realOrder.body.id,
  );
  assert.deepEqual(await h.store.attendance("red-moon"), {
    issued: 3,
    checked: 0,
    remaining: 3,
  });
  await h.store.run(
    "UPDATE orders SET status='cancelled' WHERE id=?",
    realOrder.body.id,
  );
  assert.deepEqual(await h.store.attendance("red-moon"), {
    issued: 0,
    checked: 0,
    remaining: 0,
  });
});
