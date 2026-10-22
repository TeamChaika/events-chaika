import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.mjs";
import { currentLegalDocuments } from "../server/legal.mjs";
import pg from "pg";
import { paymentSettings } from "../server/payment-settings.mjs";

const origin = "http://localhost:5173";
// These are technical test fixtures, not approved real-world legal texts.
const fixtureLegalDocuments = currentLegalDocuments.map((doc) => ({
  ...doc,
  version: "fixture.1",
  status: "published",
  content: `# ${doc.title}\n\nTechnical test fixture: ${doc.slug}.`,
}));
const guest = {
  first_name: "Тест",
  last_name: "Проверочный",
  phone: "+79990000000",
  email: "qa@example.com",
  quantity: 2,
  event_id: "red-moon",
  consent: true,
};

test("admin stores a verified Livadia key encrypted; credentials survive reload without being exposed or replacing the terminal", async (t) => {
  const keys = [
    "QRM_SETTINGS_ENCRYPTION_KEY",
    "QRM_LIVADIA_EXPECTED_MERCHANT_ID",
  ];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.QRM_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64",
  );
  delete process.env.QRM_LIVADIA_EXPECTED_MERCHANT_ID;
  const originalFetch = global.fetch;
  let merchantId = "fixture-livadia",
    providerCalls = 0;
  const secret = "fixture-secret-123456789";
  global.fetch = async (url, init) => {
    if (!String(url).startsWith("https://app.wapiserv.qrm.ooo/"))
      return originalFetch(url, init);
    assert.ok(
      String(url).endsWith("/users/check-api-key/"),
      "settings must not create a payment",
    );
    assert.equal(init.headers["X-Api-Key"], secret);
    providerCalls++;
    return Response.json({
      merchant_id: merchantId,
      firm_name: "Ливадия Fixture",
      qrt_is_b2c: true,
      requires_receipt: false,
      subscription_end_date: "2099-01-01",
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
  const h = await harness(t);
  const input = { host: "https://app.wapiserv.qrm.ooo", key: secret };
  assert.equal((await h.request("/admin/qrm/livadia")).status, 401);
  assert.equal(
    (await h.request("/admin/qrm/livadia", { method: "PUT", body: input }))
      .status,
    401,
  );
  await h.login("door");
  assert.equal(
    (await h.request("/admin/qrm/livadia", { method: "PUT", body: input }))
      .status,
    403,
  );
  await h.login();
  assert.equal(
    (
      await h.request("/admin/qrm/livadia", {
        method: "PUT",
        body: input,
        asOrigin: "https://evil.example",
      })
    ).status,
    403,
  );
  delete process.env.QRM_SETTINGS_ENCRYPTION_KEY;
  assert.equal(
    (await h.request("/admin/qrm/livadia", { method: "PUT", body: input }))
      .status,
    503,
  );
  process.env.QRM_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64",
  );
  assert.equal(providerCalls, 0);
  const save = await h.request("/admin/qrm/livadia", {
    method: "PUT",
    body: input,
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.configured, true);
  assert.equal(JSON.stringify(save).includes(secret), false);
  const stored = await h.store.get(
    "SELECT * FROM payment_accounts WHERE id='livadia'",
  );
  assert.equal(JSON.stringify(stored).includes(secret), false);
  const reloaded = paymentSettings(h.store);
  assert.equal((await reloaded.resolve("livadia")).key, secret);
  assert.equal(
    (await reloaded.resolve("livadia")).merchantId,
    "fixture-livadia",
  );
  assert.equal(await reloaded.resolve("default"), "default");
  for (const path of [
    "/admin/qrm/livadia",
    "/events",
    "/config",
    "/admin/overview",
  ])
    assert.equal(
      JSON.stringify((await h.request(path)).body).includes(secret),
      false,
    );
  assert.equal(
    JSON.stringify(await h.store.all("SELECT * FROM audit")).includes(secret),
    false,
  );
  merchantId = "another-terminal";
  assert.equal(
    (await h.request("/admin/qrm/livadia", { method: "PUT", body: input }))
      .status,
    409,
  );
  assert.equal(
    (await reloaded.resolve("livadia")).merchantId,
    "fixture-livadia",
  );
  const beforeUnsafe = providerCalls;
  await assert.rejects(
    reloaded.save({ ...input, host: "https://127.0.0.1" }, "fixture"),
  );
  assert.equal(providerCalls, beforeUnsafe);
  await h.store.run(
    "UPDATE payment_accounts SET encrypted_config=? WHERE id='livadia'",
    "broken",
  );
  await assert.rejects(reloaded.resolve("livadia"), { status: 503 });
});

test("event terminals are isolated, missing Livadia credentials fail closed, and orders retain their terminal", async (t) => {
  const before = { ...process.env };
  const originalFetch = global.fetch;
  const env = {
    QRM_MODE: "live",
    QRM_API_BASE_URL: "https://app.qrm.ooo",
    QRM_LIVE_API_KEY: "default-fixture",
    QRM_EXPECTED_MERCHANT_ID: "default-merchant",
    QRM_LIVADIA_MODE: "live",
    QRM_LIVADIA_API_BASE_URL: "https://app.qrm.ooo",
    QRM_LIVADIA_LIVE_API_KEY: "",
    QRM_LIVADIA_EXPECTED_MERCHANT_ID: "livadia-merchant",
    QRM_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  };
  Object.assign(process.env, env);
  const calls = [],
    operations = new Map();
  global.fetch = async (url, init) => {
    if (!String(url).startsWith("https://app.qrm.ooo/"))
      return originalFetch(url, init);
    const accountKey = init.headers["X-Api-Key"];
    calls.push({ url, accountKey });
    const merchant = accountKey.startsWith("livadia-fixture")
      ? "livadia-merchant"
      : "default-merchant";
    if (String(url).endsWith("/users/check-api-key/"))
      return Response.json({
        merchant_id: merchant,
        firm_name: "Fixture",
        qrt_is_b2c: true,
        requires_receipt: false,
        subscription_end_date: "2099-01-01",
      });
    if (init.method === "POST") {
      const id = randomUUID();
      operations.set(id, { key: accountKey, sum: JSON.parse(init.body).sum });
      return Response.json({
        results: { operation_id: id, qr_link: "https://qr.nspk.ru/fixture" },
      });
    }
    const operation = operations.get(String(url).split("/").at(-3));
    assert.ok(operation, "reconcile must reference a created operation");
    assert.equal(
      accountKey,
      operation.key,
      "status checks must use the original terminal",
    );
    return Response.json({
      results: { operation_status_code: 5, operation_sum: operation.sum },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
    for (const key of Object.keys(env)) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
  const h = await harness(t, {
    demo: false,
    origin: "https://events.example.com",
  });
  await h.store
    .run(`INSERT INTO events (id,title,subtitle,date,time,venue,address,price,capacity,description,dresscode,age,published,sales_open,created_at,payment_account,layout,contact_phone)
    SELECT 'odisseya','Одиссея',subtitle,date,time,'Ливадия',address,800000,60,description,'',-1,1,1,created_at,'livadia','odisseya','+7 (978) 687-20-64' FROM events WHERE id='red-moon'`);
  assert.equal((await h.request("/config")).body.paymentReady, true);
  assert.equal(
    (await h.request("/config?event=odisseya")).body.paymentReady,
    false,
  );
  assert.equal((await h.request("/config?event=missing")).status, 404);
  const customer = { ...guest, event_id: "odisseya", quantity: 5 };
  assert.equal((await h.order(customer)).status, 503);
  assert.equal((await h.store.get("SELECT COUNT(*) AS n FROM orders")).n, 0);
  assert.equal(calls.length, 0);
  process.env.QRM_LIVADIA_LIVE_API_KEY = "livadia-fixture";
  assert.equal(
    (await h.request("/config?event=odisseya")).body.paymentReady,
    true,
  );
  await paymentSettings(h.store).save(
    { host: "https://app.qrm.ooo", key: "livadia-fixture-encrypted" },
    "fixture",
  );
  delete process.env.QRM_LIVADIA_LIVE_API_KEY;
  assert.equal(
    (await h.request("/config?event=odisseya")).body.paymentReady,
    true,
  );
  const key = randomUUID();
  const created = await h.order(customer, key);
  assert.equal(created.status, 201);
  assert.equal(created.body.total, 4000000);
  let saved = await h.store.get(
    "SELECT * FROM orders WHERE id=?",
    created.body.id,
  );
  assert.equal(saved.payment_account, "livadia");
  assert.equal(saved.merchant_id, "livadia-merchant");
  const other = await h.order();
  assert.equal(other.status, 201);
  assert.equal(
    (
      await h.store.get(
        "SELECT payment_account FROM orders WHERE id=?",
        other.body.id,
      )
    ).payment_account,
    "default",
  );
  await h.store.run(
    "UPDATE events SET payment_account='default' WHERE id='odisseya'",
  );
  const count = calls.length;
  const repeated = await h.order(customer, key);
  assert.equal(repeated.body.id, created.body.id);
  assert.equal(
    calls.length,
    count,
    "an idempotent retry must not create another payment",
  );
  const callback = await h.request(
    `/webhooks/qrm/${saved.id}/${saved.webhook_token}`,
    { method: "POST", body: {} },
  );
  assert.equal(callback.status, 200);
  saved = await h.store.get("SELECT * FROM orders WHERE id=?", saved.id);
  assert.equal(saved.status, "paid");
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM tickets WHERE order_id=?",
        saved.id,
      )
    ).n,
    5,
  );
  const publicResponse = JSON.stringify((await h.request("/events")).body);
  assert.ok(
    !publicResponse.includes("fixture") && !publicResponse.includes("merchant"),
  );
});

test("admin event settings preserve terminal and layout for older clients and reject unknown accounts", async (t) => {
  const h = await harness(t);
  await h.login();
  const event = await h.store.event("red-moon");
  const input = {
    ...event,
    published: true,
    sales_open: true,
    title: "Одиссея",
    capacity: 60,
    price_tiers: null,
    price: 800000,
    venue: "Ливадия",
    age: -1,
    dresscode: "",
    contact_phone: "+7 (978) 687-20-64",
    payment_account: "livadia",
    layout: "odisseya",
    hero_image: "/assets/odisseya.jpg",
  };
  const created = await h.request("/admin/events", {
    method: "POST",
    body: input,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.capacity, 60);
  assert.equal(created.body.payment_account, "livadia");
  const legacy = { ...input };
  delete legacy.payment_account;
  delete legacy.layout;
  delete legacy.contact_phone;
  const updated = await h.request(`/admin/events/${created.body.id}`, {
    method: "PUT",
    body: legacy,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.payment_account, "livadia");
  assert.equal(updated.body.layout, "odisseya");
  assert.equal(updated.body.contact_phone, input.contact_phone);
  assert.equal(
    (
      await h.request("/admin/events", {
        method: "POST",
        body: { ...input, payment_account: "unknown" },
      })
    ).status,
    400,
  );
});
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
    legalDocuments: fixtureLegalDocuments,
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
  const catalog = (await request("/legal")).body;
  const acceptances = Object.fromEntries(
    catalog.documents
      .filter((doc) => ["terms", "consent"].includes(doc.slug))
      .map((doc) => [doc.slug, { accepted: true, hash: doc.hash }]),
  );
  const order = (body = guest, key = randomUUID()) =>
    request("/orders", { method: "POST", body: { acceptances, ...body }, key });
  const login = (role = "admin") =>
    request("/auth/login", { method: "POST", body: { role, demo: true } });
  return {
    ...instance,
    request,
    order,
    login,
    databaseUrl,
    base,
    acceptances,
    catalog,
  };
}

const marketingBody = (h, extra = {}) => ({
  ...guest,
  ...extra,
  acceptances: {
    ...h.acceptances,
    marketing: {
      accepted: true,
      hash: h.catalog.documents.find((d) => d.slug === "marketing").hash,
    },
  },
});

const employeeInput = (username = "anna.door", role = "door") => ({
  username,
  display_name: "Анна · контроль входа",
  role,
  password: "Test-only-password-2026",
});
function employeeClient(h) {
  let cookie = "";
  return async (path, method = "GET", body) => {
    const response = await fetch(h.base + "/api" + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const value of response.headers.getSetCookie())
      if (value.startsWith("staff=")) cookie = value.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
}

test("individual staff logins are normalized, salted, private and cannot forge admin access", async (t) => {
  const h = await harness(t);
  const stranger = employeeClient(h);
  assert.equal((await stranger("/admin/staff")).status, 401);
  await h.login();
  const created = await h.request("/admin/staff", {
    method: "POST",
    body: employeeInput(" Anna.Door "),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.username, "anna.door");
  assert.equal("password_hash" in created.body, false);
  const second = await h.request("/admin/staff", {
    method: "POST",
    body: employeeInput("boris.door"),
  });
  assert.equal(second.status, 201);
  const rows = await h.store.all("SELECT password_hash FROM staff_accounts");
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  assert.ok(
    rows.every((row) => !row.password_hash.includes(employeeInput().password)),
  );
  assert.equal(
    (
      await h.request("/admin/staff", {
        method: "POST",
        body: employeeInput("ANNA.DOOR"),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.request("/admin/staff", {
        method: "POST",
        body: { ...employeeInput("weak"), password: "short" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await stranger("/auth/login", "POST", {
        username: "anna.door",
        password: "wrong",
        demo: true,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await stranger("/auth/login", "POST", {
        username: "unknown",
        password: employeeInput().password,
      })
    ).status,
    401,
  );
  const login = await stranger("/auth/login", "POST", {
    username: "ANNA.DOOR",
    password: employeeInput().password,
    role: "admin",
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.role, "door");
  assert.equal(login.body.staff_id, created.body.id);
  assert.equal(login.body.display_name, employeeInput().display_name);
  const overview = await stranger("/admin/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.orders, undefined);
  assert.equal((await stranger("/admin/staff")).status, 403);
  assert.equal(
    (await stranger("/admin/staff", "POST", employeeInput("forged", "admin")))
      .status,
    403,
  );
  assert.equal(
    (
      await stranger(`/admin/staff/${created.body.id}`, "PATCH", {
        active: false,
      })
    ).status,
    403,
  );
  assert.equal((await stranger("/auth")).body.staff_id, created.body.id);
  assert.ok((await h.request("/admin/staff")).body[0].last_login_at);
  assert.ok(
    (await h.request("/admin/staff")).body.every(
      (row) => !("password_hash" in row),
    ),
  );
});

test("email-shaped staff usernames support creation, normalized login and role boundaries", async (t) => {
  const h = await harness(t);
  await h.login();
  for (const [username, role] of [
    ["1@chaika.team", "admin"],
    ["dvor@chaika.team", "door"],
  ]) {
    const created = await h.request("/admin/staff", {
      method: "POST",
      body: employeeInput(` ${username.toUpperCase()} `, role),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.username, username);
    assert.equal(
      (
        await h.request("/admin/staff", {
          method: "POST",
          body: employeeInput(username, role),
        })
      ).status,
      409,
    );
    const client = employeeClient(h);
    const login = await client("/auth/login", "POST", {
      username: username.toUpperCase(),
      password: employeeInput().password,
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.role, role);
    assert.equal(
      (await client("/admin/staff")).status,
      role === "admin" ? 200 : 403,
    );
  }
  assert.equal(
    (
      await h.request("/admin/staff", {
        method: "POST",
        body: employeeInput("bad name@chaika.team"),
      })
    ).status,
    400,
  );
});

test("first individual controller retires old scanner sessions without locking out the owner", async (t) => {
  const h = await harness(t);
  const shared = employeeClient(h);
  assert.equal((await shared("/auth")).body.legacy_door_login, true);
  assert.equal(
    (await shared("/auth/login", "POST", { role: "door", demo: true })).status,
    200,
  );
  await h.login();
  const created = await h.request("/admin/staff", {
    method: "POST",
    body: employeeInput(),
  });
  assert.equal(created.status, 201);
  assert.equal((await shared("/auth")).body.legacy_door_login, false);
  assert.equal((await shared("/admin/overview")).status, 401);
  assert.equal(
    (await shared("/auth/login", "POST", { role: "door", demo: true })).status,
    401,
  );
  await h.request(`/admin/staff/${created.body.id}`, {
    method: "PATCH",
    body: { active: false },
  });
  assert.equal(
    (await shared("/auth/login", "POST", { role: "door", demo: true })).status,
    401,
  );
  assert.equal((await h.request("/admin/staff")).status, 200);
});

test("password resets and disabling immediately revoke every device but preserve other employees", async (t) => {
  const h = await harness(t);
  await h.login();
  const one = (
    await h.request("/admin/staff", { method: "POST", body: employeeInput() })
  ).body;
  await h.request("/admin/staff", {
    method: "POST",
    body: employeeInput("boris"),
  });
  const phone = employeeClient(h),
    tablet = employeeClient(h),
    other = employeeClient(h);
  const credentials = {
    username: "anna.door",
    password: employeeInput().password,
  };
  assert.equal((await phone("/auth/login", "POST", credentials)).status, 200);
  assert.equal((await tablet("/auth/login", "POST", credentials)).status, 200);
  await other("/auth/login", "POST", { ...credentials, username: "boris" });
  const reset = await h.request(`/admin/staff/${one.id}`, {
    method: "PATCH",
    body: { password: "New-test-only-password" },
  });
  assert.equal(reset.status, 200);
  assert.equal((await phone("/checkin/summary?event_id=red-moon")).status, 401);
  assert.equal(
    (await tablet("/wristbands/summary?event_id=red-moon")).status,
    401,
  );
  assert.equal((await other("/admin/overview")).status, 200);
  assert.equal((await phone("/auth/login", "POST", credentials)).status, 401);
  const updated = { ...credentials, password: "New-test-only-password" };
  assert.equal((await phone("/auth/login", "POST", updated)).status, 200);
  assert.equal(
    (
      await h.request(`/admin/staff/${one.id}`, {
        method: "PATCH",
        body: { active: false },
      })
    ).status,
    200,
  );
  assert.equal((await phone("/admin/overview")).status, 401);
  assert.equal((await phone("/auth/login", "POST", updated)).status, 401);
  await h.request(`/admin/staff/${one.id}`, {
    method: "PATCH",
    body: { active: true },
  });
  assert.equal((await phone("/admin/overview")).status, 401);
  assert.equal((await phone("/auth/login", "POST", updated)).status, 200);
  const records = await h.store.all(
    "SELECT action FROM audit WHERE entity=?",
    one.id,
  );
  assert.deepEqual(
    records.map((row) => row.action).sort(),
    [
      "staff_created",
      "staff_password_changed",
      "staff_disabled",
      "staff_enabled",
    ].sort(),
  );
});

test("personal administrators keep their own session safe and management requires the correct origin", async (t) => {
  const h = await harness(t);
  await h.login();
  const created = (
    await h.request("/admin/staff", {
      method: "POST",
      body: employeeInput("manager", "admin"),
    })
  ).body;
  const manager = employeeClient(h);
  assert.equal(
    (
      await manager("/auth/login", "POST", {
        username: "manager",
        password: employeeInput().password,
        role: "door",
      })
    ).body.role,
    "admin",
  );
  assert.equal((await manager("/admin/staff")).status, 200);
  assert.equal(
    (await manager(`/admin/staff/${created.id}`, "PATCH", { active: false }))
      .status,
    409,
  );
  assert.equal(
    (
      await manager(`/admin/staff/${created.id}`, "PATCH", {
        password: "Changed-test-password",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.request("/admin/staff", {
        method: "POST",
        body: employeeInput(),
        asOrigin: "https://untrusted.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.request(`/admin/staff/${created.id}`, {
        method: "PATCH",
        body: { role: "door" },
      })
    ).status,
    400,
  );
});

test("scanner and wristband records identify the employee and remain independent", async (t) => {
  const h = await harness(t);
  const order = await h.order();
  assert.equal(order.status, 201);
  const paid = await h.request(`/orders/${order.body.access_token}/demo-pay`, {
    method: "POST",
    body: {},
  });
  assert.equal(paid.status, 200);
  const ticket = await h.store.get(
    "SELECT code FROM tickets WHERE order_id=? ORDER BY ordinal",
    order.body.id,
  );
  await h.login();
  const created = (
    await h.request("/admin/staff", { method: "POST", body: employeeInput() })
  ).body;
  const employee = employeeClient(h);
  await employee("/auth/login", "POST", {
    username: "anna.door",
    password: employeeInput().password,
  });
  const input = {
    event_id: "red-moon",
    code: ticket.code,
    quantity: 1,
    expected_checked: 0,
    request_id: randomUUID(),
  };
  assert.equal(
    (await employee("/wristbands/group", "POST", input)).status,
    200,
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM tickets WHERE used_at IS NOT NULL",
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await employee("/checkin/group", "POST", {
        ...input,
        request_id: randomUUID(),
      })
    ).status,
    200,
  );
  assert.equal(
    (await h.store.get("SELECT actor FROM wristband_batches")).actor,
    `staff:${created.id}`,
  );
  assert.equal(
    (await h.store.get("SELECT used_by FROM tickets WHERE used_at IS NOT NULL"))
      .used_by,
    `staff:${created.id}`,
  );
  await employee("/auth/logout", "POST", {});
  assert.equal((await employee("/admin/overview")).status, 401);
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM staff_sessions")).n,
    0,
  );
});

test("live staff login requires credentials and expired personal sessions are rejected", async (t) => {
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "Fixture-owner-password-2026";
  t.after(() => {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  });
  const h = await harness(t, { demo: false });
  assert.equal((await h.login()).status, 401);
  assert.equal(
    (
      await h.request("/auth/login", {
        method: "POST",
        body: { password: process.env.ADMIN_PASSWORD },
      })
    ).status,
    200,
  );
  assert.equal(
    (await h.request("/admin/staff", { method: "POST", body: employeeInput() }))
      .status,
    201,
  );
  const employee = employeeClient(h);
  assert.equal(
    (
      await employee("/auth/login", "POST", {
        username: "anna.door",
        demo: true,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await employee("/auth/login", "POST", {
        username: "anna.door",
        password: employeeInput().password,
      })
    ).status,
    200,
  );
  await h.store.run(
    "UPDATE sessions SET expires_at=? WHERE id IN (SELECT session_id FROM staff_sessions)",
    Date.now() - 1,
  );
  assert.equal((await employee("/admin/overview")).status, 401);
  assert.equal((await employee("/auth")).body.role, null);
  assert.equal((await h.request("/admin/staff")).status, 200);
});

test("staff on shared Wi-Fi can sign in without consuming the failed-login allowance", async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 16; i++) assert.equal((await h.login()).status, 200);
  for (let i = 0; i < 15; i++)
    assert.equal(
      (
        await h.request("/auth/login", {
          method: "POST",
          body: { password: "wrong-password" },
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await h.request("/auth/login", {
        method: "POST",
        body: { password: "wrong-password" },
      })
    ).status,
    429,
  );
});

test("advertising is optional, never inferred, and requires the displayed document hash", async (t) => {
  const h = await harness(t);
  const ordinary = await h.order();
  assert.equal(ordinary.status, 201);
  assert.equal(ordinary.body.unsubscribe_url, null);
  for (const accepted of [false, "true", 1]) {
    const body = marketingBody(h);
    body.acceptances.marketing = { accepted, hash: "stale" };
    assert.equal((await h.order(body)).status, 201);
  }
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM sms_consents")).n,
    0,
  );
  const stale = marketingBody(h);
  stale.acceptances.marketing.hash = "0".repeat(64);
  assert.equal((await h.order(stale)).status, 409);
  assert.equal((await h.store.get("SELECT COUNT(*) AS n FROM orders")).n, 4);
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM sms_consents")).n,
    0,
  );
});

test("SMS opt-in stores server evidence and unsubscribe does not cancel tickets or resubscribe on retry", async (t) => {
  const h = await harness(t);
  const key = randomUUID();
  const body = marketingBody(h, {
    accepted_at: "1900-01-01",
    content: "forged",
  });
  const created = await h.order(body, key);
  assert.equal(created.status, 201);
  const saved = await h.store.get(
    "SELECT a.*,d.content FROM sms_consents a JOIN legal_documents d ON d.hash=a.document_hash WHERE order_id=?",
    created.body.id,
  );
  assert.equal(saved.accepted_at, created.body.created_at);
  assert.match(saved.buyer_session, /^[a-f0-9]{64}$/);
  assert.match(saved.unsubscribe_token, /^[a-f0-9]{48}$/);
  assert.equal(
    saved.content,
    fixtureLegalDocuments.find((d) => d.slug === "marketing").content,
  );
  const subscription = "/marketing/" + saved.unsubscribe_token;
  const unsubscribe = subscription + "/unsubscribe";
  assert.equal(
    created.body.unsubscribe_url,
    "/unsubscribe/" + saved.unsubscribe_token,
  );
  assert.deepEqual((await h.request(subscription)).body, { subscribed: true });
  assert.equal(
    (
      await h.store.get(
        "SELECT withdrawn_at FROM sms_consents WHERE order_id=?",
        created.body.id,
      )
    ).withdrawn_at,
    null,
  );
  const adminUrl = `/admin/orders/${created.body.id}/acceptances`;
  assert.equal((await h.request(adminUrl)).status, 401);
  await h.login("door");
  assert.equal((await h.request(adminUrl)).status, 403);
  await h.login();
  assert.equal(
    (await h.request(adminUrl)).body.find((r) => r.kind === "marketing")
      .withdrawn_at,
    null,
  );
  const second = await h.order(
    marketingBody(h, { phone: "8 (999) 000-00-00" }),
  );
  const otherPhone = await h.order(marketingBody(h, { phone: "+79991111111" }));
  assert.equal(second.status, 201);
  assert.equal(otherPhone.status, 201);
  await h.store.markPaid(created.body.id);
  const ticket = await h.store.get(
    "SELECT code FROM tickets WHERE order_id=? ORDER BY ordinal",
    created.body.id,
  );
  assert.equal(
    (await h.request(`/tickets/${ticket.code}`)).body.unsubscribe_url,
    created.body.unsubscribe_url,
  );
  assert.equal(
    (
      await h.request(unsubscribe, {
        method: "POST",
        body: {},
        asOrigin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.request("/marketing/" + "0".repeat(48) + "/unsubscribe", {
        method: "POST",
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (await h.request(unsubscribe, { method: "POST", body: {} })).status,
    200,
  );
  const withdrawn = await h.store.get(
    "SELECT * FROM sms_consents WHERE order_id=?",
    created.body.id,
  );
  assert.ok(withdrawn.withdrawn_at);
  assert.equal(
    (
      await h.store.get(
        "SELECT withdrawn_at FROM sms_consents WHERE order_id=?",
        second.body.id,
      )
    ).withdrawn_at,
    withdrawn.withdrawn_at,
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT withdrawn_at FROM sms_consents WHERE order_id=?",
        otherPhone.body.id,
      )
    ).withdrawn_at,
    null,
  );
  assert.deepEqual((await h.request(subscription)).body, { subscribed: false });
  assert.equal(
    (await h.request(unsubscribe, { method: "POST", body: {} })).status,
    200,
  );
  assert.equal((await h.order(body, key)).status, 200);
  assert.equal(
    (
      await h.store.get(
        "SELECT withdrawn_at FROM sms_consents WHERE order_id=?",
        created.body.id,
      )
    ).withdrawn_at,
    withdrawn.withdrawn_at,
  );
  assert.equal(
    (await h.request(adminUrl)).body.find((r) => r.kind === "marketing")
      .withdrawn_at,
    withdrawn.withdrawn_at,
  );
  assert.equal((await h.request(`/tickets/${ticket.code}`)).status, 200);
  assert.equal(
    (await h.store.get("SELECT status FROM orders WHERE id=?", created.body.id))
      .status,
    "paid",
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM outbox WHERE kind NOT IN ('created','tickets')",
      )
    ).n,
    0,
  );
  await h.order(); // A later purchase without the checkbox is not a resubscription.
  assert.deepEqual((await h.request(subscription)).body, { subscribed: false });
  const renewed = await h.order(marketingBody(h, { phone: "79990000000" }));
  assert.equal(renewed.status, 201);
  assert.deepEqual((await h.request(subscription)).body, { subscribed: true });
  await h.request(unsubscribe, { method: "POST", body: {} }); // Old links keep working.
  assert.ok(
    (
      await h.store.get(
        "SELECT withdrawn_at FROM sms_consents WHERE order_id=?",
        renewed.body.id,
      )
    ).withdrawn_at,
  );
});

test("SMS opt-in rolls back with an unsuccessful order", async (t) => {
  const h = await harness(t);
  t.mock.method(h.store, "enqueue", async () => {
    throw new Error("fixture rollback");
  });
  assert.equal((await h.order(marketingBody(h))).status, 500);
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM sms_consents")).n,
    0,
  );
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM order_acceptances")).n,
    0,
  );
  assert.equal((await h.store.get("SELECT COUNT(*) AS n FROM orders")).n, 0);
});

test("an unfinished optional marketing document does not block completed purchase documents", async (t) => {
  const h = await harness(t, {
    demo: false,
    legalDocuments: fixtureLegalDocuments.map((d) =>
      d.slug === "marketing" ? { ...d, status: "draft" } : d,
    ),
  });
  assert.equal(h.catalog.checkout_ready, true);
  assert.equal(h.catalog.marketing_ready, false);
  assert.equal(
    h.catalog.documents.some((d) => d.slug === "marketing"),
    false,
  );
});

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
  assert.equal((await h.order({ ...guest, acceptances: {} })).status, 400);
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
      legalDocuments: fixtureLegalDocuments,
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

test("door search matches Russian names and formatted phones without admitting anyone", async (t) => {
  const h = await harness(t);
  const order = await h.order({
    ...guest,
    first_name: "Семён",
    last_name: "Петров",
    phone: "+79787876854",
    quantity: 5,
  });
  await h.store.markPaid(order.body.id);
  const search = (query, extra = {}) =>
    h.request("/checkin/search", {
      method: "POST",
      body: { event_id: "red-moon", query },
      ...extra,
    });
  assert.equal((await search("Петров")).status, 401);
  await h.login("door");
  assert.equal(
    (await search("Петров", { asOrigin: "https://evil.example" })).status,
    403,
  );
  for (const query of [
    "СЕМЕН",
    "петров семён",
    "сем петр",
    "+7 (978) 787-68-54",
    "8 (978) 787-68-54",
    "9787876854",
    "6854",
  ]) {
    const r = await search(query);
    assert.equal(r.status, 200);
    assert.equal(r.body.orders.length, 1, query);
    const found = r.body.orders[0];
    assert.equal(found.id, order.body.id);
    assert.deepEqual(found.group, { issued: 5, checked: 0, remaining: 5 });
    assert.equal(found.tickets.length, 5);
    for (const field of [
      "email",
      "access_token",
      "payment_url",
      "webhook_token",
      "total",
    ])
      assert.equal(field in found, false);
  }
  for (const query of ["", "я", "123", "%", "_", "a".repeat(121)])
    assert.equal((await search(query)).status, 400);
  for (const query of ["Петров%", "Петров_", "' OR 1=1 --"])
    assert.equal((await search(query)).body.orders.length, 0);
  assert.equal((await h.store.attendance("red-moon", true)).checked, 0);
});

test("search scopes to the selected event and valid live orders and limits broad results", async (t) => {
  const h = await harness(t);
  const r = await h.order({
    ...guest,
    first_name: "Мария",
    last_name: "Тестовая",
    quantity: 1,
  });
  await h.store.markPaid(r.body.id);
  assert.equal(
    (await h.store.searchTickets("red-moon", "Мария")).orders.length,
    0,
  );
  await h.store.run("UPDATE orders SET mode='live' WHERE id=?", r.body.id);
  assert.equal(
    (await h.store.searchTickets("red-moon", "Мария")).orders.length,
    1,
  );
  assert.equal(
    (await h.store.searchTickets("another-event", "Мария")).orders.length,
    0,
  );
  await h.store.run(
    "UPDATE orders SET status='cancelled' WHERE id=?",
    r.body.id,
  );
  assert.equal(
    (await h.store.searchTickets("red-moon", "Мария")).orders.length,
    0,
  );
  await h.store.run("UPDATE orders SET status='paid' WHERE id=?", r.body.id);
  const original = await h.store.get(
    "SELECT * FROM orders WHERE id=?",
    r.body.id,
  );
  for (let i = 0; i < 22; i++) {
    const copy = {
      ...original,
      id: randomUUID(),
      access_token: randomUUID(),
      idempotency: randomUUID(),
    };
    await h.store.run(
      `INSERT INTO orders (${Object.keys(copy).join(",")}) VALUES (${Object.keys(
        copy,
      )
        .map(() => "?")
        .join(",")})`,
      ...Object.values(copy),
    );
    await h.store.run(
      "INSERT INTO tickets(id,code,order_id,ordinal) VALUES (?,?,?,1)",
      randomUUID(),
      randomUUID(),
      copy.id,
    );
  }
  const results = await h.store.searchTickets("red-moon", "Мария");
  assert.equal(results.orders.length, 20);
  assert.equal(results.more, true);
});

test("one group QR admits three then two guests; retries and stale confirmations cannot add extra guests", async (t) => {
  const h = await harness(t);
  const order = await h.order({ ...guest, quantity: 5 });
  await h.store.markPaid(order.body.id);
  const tickets = await h.store.all(
    "SELECT * FROM tickets WHERE order_id=? ORDER BY ordinal",
    order.body.id,
  );
  const code = tickets[4].code;
  const publicTicket = () => h.request(`/tickets/${code}`);
  assert.deepEqual((await publicTicket()).body.group, {
    issued: 5,
    checked: 0,
    remaining: 5,
  });
  const preview = () =>
    h.request("/checkin/preview", {
      method: "POST",
      body: {
        code: origin + "/ticket/" + code + "?v=test",
        event_id: "red-moon",
      },
    });
  const requestId = randomUUID();
  const admit = (quantity, expected_checked, request_id = requestId) =>
    h.request("/checkin/group", {
      method: "POST",
      body: {
        code,
        event_id: "red-moon",
        quantity,
        expected_checked,
        request_id,
      },
    });
  assert.equal((await preview()).status, 401);
  assert.equal((await admit(3, 0)).status, 401);
  await h.login("door");
  const before = await preview();
  assert.equal(before.body.group.remaining, 5);
  assert.equal((await h.store.attendance("red-moon", true)).checked, 0);
  assert.equal((await admit(6, 0)).status, 409);
  assert.equal((await admit(0, 0)).status, 400);
  const first = await admit(3, 0);
  assert.equal(first.status, 200);
  assert.equal(first.body.admitted, 3);
  assert.deepEqual(first.body.ordinals, [5, 1, 2]);
  assert.deepEqual(first.body.group, { issued: 5, checked: 3, remaining: 2 });
  const partlyUsed = await publicTicket();
  assert.ok(partlyUsed.body.used_at);
  assert.deepEqual(partlyUsed.body.group, {
    issued: 5,
    checked: 3,
    remaining: 2,
  });
  assert.equal(partlyUsed.body.code, code);
  assert.equal(partlyUsed.body.order_id, undefined);
  const retry = await admit(3, 0);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);
  assert.equal(retry.body.group.checked, 3);
  assert.equal((await admit(2, 0)).status, 409);
  assert.equal((await admit(1, 0, randomUUID())).status, 409);
  assert.equal((await preview()).body.group.remaining, 2);
  const last = await admit(2, 3, randomUUID());
  assert.equal(last.status, 200);
  assert.equal(last.body.group.checked, 5);
  assert.equal(last.body.group.remaining, 0);
  assert.deepEqual((await publicTicket()).body.group, {
    issued: 5,
    checked: 5,
    remaining: 0,
  });
  assert.equal((await admit(1, 5, randomUUID())).status, 409);
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM audit WHERE action='checkin'",
      )
    ).n,
    5,
  );
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM checkin_batches")).n,
    2,
  );
});

test("checkout requires separate affirmative acceptances of the current server texts", async (t) => {
  const h = await harness(t);
  for (const [body, status] of [
    [{ ...guest, acceptances: undefined }, 400],
    [
      {
        ...guest,
        acceptances: {
          ...h.acceptances,
          terms: { ...h.acceptances.terms, accepted: false },
        },
      },
      400,
    ],
    [
      {
        ...guest,
        acceptances: {
          ...h.acceptances,
          consent: { ...h.acceptances.consent, accepted: "true" },
        },
      },
      400,
    ],
    [
      {
        ...guest,
        acceptances: {
          ...h.acceptances,
          consent: { accepted: true, hash: "0".repeat(64) },
        },
      },
      409,
    ],
  ]) {
    assert.equal((await h.order(body)).status, status);
  }
  assert.equal((await h.store.get("SELECT COUNT(*) AS n FROM orders")).n, 0);
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM order_acceptances")).n,
    0,
  );
  assert.equal((await h.store.get("SELECT COUNT(*) AS n FROM outbox")).n, 0);
});

test("acceptance evidence preserves server text and time on retries and is admin-only", async (t) => {
  const h = await harness(t);
  const key = randomUUID();
  const body = {
    ...guest,
    accepted_at: "1900-01-01",
    content: "Forged client text",
  };
  const created = await h.order(body, key);
  assert.equal(created.status, 201);
  const records = await h.store.all(
    "SELECT a.*,d.version,d.content,d.acceptance_label FROM order_acceptances a JOIN legal_documents d ON d.hash=a.document_hash WHERE order_id=? ORDER BY kind",
    created.body.id,
  );
  assert.equal(records.length, 2);
  assert.equal(records[0].accepted_at, created.body.created_at);
  assert.equal(records[1].accepted_at, created.body.created_at);
  assert.match(records[0].buyer_session, /^[a-f0-9]{64}$/);
  for (const record of records) {
    assert.equal(
      record.content,
      fixtureLegalDocuments.find((doc) => doc.slug === record.kind).content,
    );
    assert.equal(record.document_hash, h.acceptances[record.kind].hash);
  }
  assert.equal((await h.order(body, key)).status, 200);
  assert.deepEqual(
    await h.store.all(
      "SELECT a.*,d.version,d.content,d.acceptance_label FROM order_acceptances a JOIN legal_documents d ON d.hash=a.document_hash WHERE order_id=? ORDER BY kind",
      created.body.id,
    ),
    records,
  );
  assert.equal(created.body.acceptances, undefined);
  const url = `/admin/orders/${created.body.id}/acceptances`;
  assert.equal((await h.request(url)).status, 401);
  await h.login("door");
  assert.equal((await h.request(url)).status, 403);
  await h.login();
  const audit = await h.request(url);
  assert.equal(audit.status, 200);
  assert.equal(audit.body.length, 2);
  assert.ok(
    audit.body.every(
      (record) => !record.buyer_session && record.version === "fixture.1",
    ),
  );
  const changed = {
    ...guest,
    acceptances: {
      ...h.acceptances,
      terms: { ...h.acceptances.terms, hash: "0".repeat(64) },
    },
  };
  assert.equal((await h.order(changed, key)).status, 409);
});

test("order and its acceptance evidence roll back together on an internal failure", async (t) => {
  const h = await harness(t);
  t.mock.method(h.store, "enqueue", async () => {
    throw new Error("fixture failure after acceptance");
  });
  assert.equal((await h.order()).status, 500);
  assert.equal((await h.store.get("SELECT COUNT(*) AS n FROM orders")).n, 0);
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM order_acceptances")).n,
    0,
  );
});

test("accepted documents survive restart and publishing a new version; old text cannot be rewritten", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "chaika-legal-"));
  // Registered first, so cleanup runs after the harness closes the database.
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "test.sqlite");
  const h = await harness(t, { dbPath });
  const order = await h.order();
  const changed = fixtureLegalDocuments.map((doc) => ({
    ...doc,
    content: doc.content + " Updated.",
  }));
  await assert.rejects(
    () =>
      createApp({
        dbPath,
        databaseUrl: h.databaseUrl,
        demo: true,
        testing: true,
        legalDocuments: changed,
      }),
    /without a new version/,
  );
  const second = await createApp({
    dbPath,
    databaseUrl: h.databaseUrl,
    demo: true,
    testing: true,
    legalDocuments: changed.map((doc) => ({ ...doc, version: "fixture.2" })),
  });
  try {
    const records = await second.store.all(
      "SELECT d.version,d.content FROM order_acceptances a JOIN legal_documents d ON d.hash=a.document_hash WHERE order_id=?",
      order.body.id,
    );
    assert.equal(records.length, 2);
    assert.ok(
      records.every(
        (record) =>
          record.version === "fixture.1" && !record.content.includes("Updated"),
      ),
    );
    const old = await h.request(
      `/legal/terms?hash=${h.acceptances.terms.hash}`,
    );
    assert.equal(
      old.body.content,
      fixtureLegalDocuments.find((doc) => doc.slug === "terms").content,
    );
    assert.equal(
      (await h.request("/legal/terms?hash=../../secrets")).status,
      404,
    );
  } finally {
    await second.close();
  }
});

test("draft documents are visible only in local demo and cannot be relabelled as published", async (t) => {
  const drafts = currentLegalDocuments.map((doc) => ({
    ...doc,
    version: "fixture-draft.1",
    status: "draft",
    content: `# ${doc.title}\n\nЧЕРНОВИК. [УТОЧНИТЬ: текст перед публикацией.]`,
  }));
  const preview = await harness(t, { legalDocuments: drafts });
  assert.equal(preview.catalog.checkout_ready, true);
  assert.equal(preview.catalog.preview, true);
  assert.equal((await preview.order()).status, 201);
  const live = await harness(t, {
    demo: false,
    legalDocuments: drafts,
  });
  assert.equal(live.catalog.checkout_ready, false);
  assert.equal(live.catalog.preview, false);
  assert.deepEqual(live.catalog.documents, []);
  assert.equal(
    (
      await live.request(
        `/legal/consent?hash=${preview.acceptances.consent.hash}`,
      )
    ).status,
    404,
  );
  await assert.rejects(
    () =>
      createApp({
        dbPath: ":memory:",
        demo: false,
        testing: true,
        legalDocuments: drafts.map((doc) => ({
          ...doc,
          status: "published",
        })),
      }),
    /incomplete legal/,
  );
});

test("the release catalog opens real checkout and exposes immutable published documents", async (t) => {
  const h = await harness(t, {
    demo: false,
    legalDocuments: currentLegalDocuments,
  });
  assert.equal(h.catalog.preview, false);
  assert.equal(h.catalog.checkout_ready, true);
  assert.equal(h.catalog.marketing_ready, true);
  assert.equal(h.catalog.documents.length, 5);
  for (const doc of h.catalog.documents) {
    assert.equal(doc.status, "published");
    const response = await h.request(`/legal/${doc.slug}?hash=${doc.hash}`);
    assert.equal(response.status, 200);
    assert.equal(
      response.body.content,
      currentLegalDocuments.find((d) => d.slug === doc.slug).content,
    );
    assert.doesNotMatch(
      response.body.content,
      /ЧЕРНОВИК|\[(?:УТОЧНИТЬ|УТВЕРДИТЬ|ДОПОЛНИТЬ|ОПРЕДЕЛИТЬ|ДО ПУБЛИКАЦИИ|ЮРИДИЧЕСКОЕ)/i,
    );
  }
});

test("annulling remaining tickets preserves payments, past entry, evidence, and capacity accounting", async (t) => {
  const h = await harness(t);
  const created = await h.order({ ...guest, quantity: 5 });
  await h.store.markPaid(created.body.id);
  const tickets = await h.store.all(
    "SELECT code FROM tickets WHERE order_id=? ORDER BY ordinal",
    created.body.id,
  );
  await h.store.checkinGroup(
    tickets[0].code,
    "red-moon",
    3,
    0,
    randomUUID(),
    "door",
    true,
  );
  const paid = await h.store.get(
    "SELECT total,paid_at FROM orders WHERE id=?",
    created.body.id,
  );
  const path = `/admin/orders/${created.body.id}/manage`;
  const command = {
    action: "void",
    reason: "Проверка группы 3 + 2",
    confirmed: true,
  };
  assert.equal(
    (await h.request(path, { method: "POST", body: command })).status,
    401,
  );
  await h.login("door");
  assert.equal(
    (await h.request(path, { method: "POST", body: command })).status,
    403,
  );
  await h.login();
  assert.equal(
    (
      await h.request(path, {
        method: "POST",
        body: { ...command, confirmed: false },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.request(path, {
        method: "POST",
        body: { ...command, reason: "" },
      })
    ).status,
    400,
  );
  const response = await h.request(path, { method: "POST", body: command });
  assert.equal(response.status, 200);
  assert.ok(response.body.voided_at);
  assert.equal(
    (await h.request(path, { method: "POST", body: command })).body.voided_at,
    response.body.voided_at,
  );
  await h.store.markPaid(created.body.id);
  const saved = await h.store.get(
    "SELECT * FROM orders WHERE id=?",
    created.body.id,
  );
  assert.equal(saved.status, "paid");
  assert.equal(saved.total, paid.total);
  assert.equal(saved.paid_at, paid.paid_at);
  assert.equal(saved.voided_at, response.body.voided_at);
  assert.equal((await h.store.get("SELECT COUNT(*) AS n FROM tickets")).n, 5);
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM order_acceptances")).n,
    2,
  );
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM checkin_batches")).n,
    1,
  );
  assert.equal((await h.store.event("red-moon")).available, 197);
  assert.deepEqual(await h.store.attendance("red-moon", true), {
    issued: 3,
    checked: 3,
    remaining: 0,
  });
  const overview = (await h.request("/admin/overview")).body;
  assert.equal(overview.stats.revenue, paid.total);
  assert.equal(overview.stats.sold, 3);
  assert.equal(overview.stats.checked, 3);
  assert.equal(overview.orders[0].void_reason, command.reason);
  assert.deepEqual(
    (await h.store.searchTickets("red-moon", "Проверочный", true)).orders,
    [],
  );
  assert.equal((await h.request(`/tickets/${tickets[3].code}`)).status, 410);
  const publicOrder = (await h.request(`/orders/${created.body.access_token}`))
    .body;
  assert.deepEqual(publicOrder.tickets, []);
  assert.equal(publicOrder.status, "paid");
  await assert.rejects(
    h.store.previewCheckin(tickets[3].code, "red-moon", true),
    /аннулирован/,
  );
  await assert.rejects(
    h.store.checkin(tickets[3].code, "red-moon", "door", true),
    /аннулирован/,
  );
  await assert.rejects(
    h.store.checkinGroup(
      tickets[3].code,
      "red-moon",
      2,
      3,
      randomUUID(),
      "door",
      true,
    ),
    /аннулирован/,
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM audit WHERE action LIKE '%tickets_voided%'",
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM outbox WHERE status IN ('pending','retry')",
      )
    ).n,
    0,
  );
});

test("test flag hides guests and blocks entry without freeing seats or hiding actual payment totals", async (t) => {
  const h = await harness(t);
  const order = await h.order();
  await h.store.markPaid(order.body.id);
  const code = (await h.store.get("SELECT code FROM tickets LIMIT 1")).code;
  await h.store.checkin(code, "red-moon", "door", true);
  await h.login();
  const path = `/admin/orders/${order.body.id}/manage`;
  assert.equal(
    (
      await h.request(path, {
        method: "POST",
        body: { action: "test", isTest: true, reason: "Тест покупки" },
      })
    ).status,
    200,
  );
  assert.deepEqual(await h.store.attendance("red-moon", true), {
    issued: 0,
    checked: 0,
    remaining: 0,
  });
  assert.equal((await h.store.event("red-moon")).available, 198);
  const summary = (await h.request("/admin/overview")).body;
  assert.equal(summary.stats.revenue, order.body.total);
  assert.equal(summary.orders[0].is_test, 1);
  await assert.rejects(
    h.store.checkin(code, "red-moon", "door", true),
    /Тестовый/,
  );
  assert.equal((await h.request(`/tickets/${code}`)).status, 409);
  assert.deepEqual(
    (await h.store.searchTickets("red-moon", "Проверочный", true)).orders,
    [],
  );
  assert.equal(
    (
      await h.request(path, {
        method: "POST",
        body: {
          action: "test",
          isTest: false,
          reason: "Проверка снятия пометки",
        },
      })
    ).status,
    200,
  );
  assert.deepEqual(await h.store.attendance("red-moon", true), {
    issued: 2,
    checked: 1,
    remaining: 1,
  });
  assert.equal((await h.request(`/tickets/${code}`)).status, 200);
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM audit WHERE action LIKE '%test_%'",
      )
    ).n,
    2,
  );
});

test("pending payments cannot be annulled; late payment on an annulled closed order cannot issue tickets", async (t) => {
  const h = await harness(t);
  const order = await h.order();
  await h.login();
  const path = `/admin/orders/${order.body.id}/manage`;
  const body = {
    action: "void",
    reason: "Тест неоплаченного заказа",
    confirmed: true,
  };
  assert.equal((await h.request(path, { method: "POST", body })).status, 409);
  await h.store.run(
    "UPDATE orders SET status='expired' WHERE id=?",
    order.body.id,
  );
  assert.equal((await h.request(path, { method: "POST", body })).status, 200);
  await h.store.markPaid(order.body.id);
  assert.equal((await h.store.get("SELECT status FROM orders")).status, "paid");
  assert.equal((await h.store.get("SELECT COUNT(*) AS n FROM tickets")).n, 0);
  assert.equal((await h.store.event("red-moon")).available, 200);
});

test("a concurrent admission and annulment serialize, and no later scan can enter", async (t) => {
  const h = await harness(t);
  const order = await h.order();
  await h.store.markPaid(order.body.id);
  const code = (await h.store.get("SELECT code FROM tickets LIMIT 1")).code;
  const results = await Promise.allSettled([
    h.store.manageOrder(
      order.body.id,
      { action: "void", reason: "Тест гонки" },
      "admin",
    ),
    h.store.checkinGroup(code, "red-moon", 1, 0, randomUUID(), "door", true),
  ]);
  assert.equal(results[0].status, "fulfilled");
  await assert.rejects(
    h.store.checkinGroup(code, "red-moon", 1, 0, randomUUID(), "door", true),
    /аннулирован/,
  );
  const used = (
    await h.store.get(
      "SELECT COUNT(*) AS n FROM tickets WHERE used_at IS NOT NULL",
    )
  ).n;
  assert.equal(used, results[1].status === "fulfilled" ? 1 : 0);
  assert.equal((await h.store.event("red-moon")).available, 200 - used);
});

test("parallel group confirmations serialize and enforce remaining count and revision", async (t) => {
  const h = await harness(t);
  const order = await h.order({ ...guest, quantity: 5 });
  await h.store.markPaid(order.body.id);
  const code = (
    await h.store.get(
      "SELECT code FROM tickets WHERE order_id=? AND ordinal=1",
      order.body.id,
    )
  ).code;
  await h.login("door");
  const body = {
    code,
    event_id: "red-moon",
    quantity: 3,
    expected_checked: 0,
    request_id: randomUUID(),
  };
  const same = await Promise.all([
    h.request("/checkin/group", { method: "POST", body }),
    h.request("/checkin/group", { method: "POST", body }),
  ]);
  assert.deepEqual(
    same.map((r) => r.status),
    [200, 200],
  );
  assert.equal(same.filter((r) => r.body.replayed).length, 1);
  const separate = await Promise.all(
    [1, 2].map(() =>
      h.request("/checkin/group", {
        method: "POST",
        body: {
          ...body,
          quantity: 1,
          expected_checked: 3,
          request_id: randomUUID(),
        },
      }),
    ),
  );
  assert.deepEqual(separate.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await h.store.attendance("red-moon", true)).checked, 4);
});

test("group entry validates ticket mode, payment and selected event before changing attendance", async (t) => {
  const h = await harness(t);
  const order = await h.order({ ...guest, quantity: 2 });
  await h.store.markPaid(order.body.id);
  const code = (
    await h.store.get(
      "SELECT code FROM tickets WHERE order_id=?",
      order.body.id,
    )
  ).code;
  await assert.rejects(h.store.previewCheckin(code, "red-moon"), /Тестовый/);
  await assert.rejects(
    h.store.checkinGroup(code, "red-moon", 1, 0, randomUUID(), "door"),
    /Тестовый/,
  );
  await h.store.run("UPDATE orders SET mode='live' WHERE id=?", order.body.id);
  await assert.rejects(
    h.store.checkinGroup(code, "wrong", 1, 0, randomUUID(), "door"),
    /другое мероприятие/,
  );
  await h.store.run(
    "UPDATE orders SET status='cancelled' WHERE id=?",
    order.body.id,
  );
  await assert.rejects(
    h.store.checkinGroup(code, "red-moon", 1, 0, randomUUID(), "door"),
    /недействителен/,
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM tickets WHERE used_at IS NOT NULL",
      )
    ).n,
    0,
  );
});

test("production CSP separates public posters, private pages and the Telegram panel", async (t) => {
  const saved = Object.fromEntries(
    ["NODE_ENV", "ADMIN_PASSWORD", "SCANNER_PASSWORD"].map((k) => [
      k,
      process.env[k],
    ]),
  );
  Object.assign(process.env, {
    NODE_ENV: "production",
    ADMIN_PASSWORD: "local-test-admin-password-only",
    SCANNER_PASSWORD: "local-test-scanner-password-only",
  });
  try {
    const h = await harness(t, {
      demo: false,
      origin: "https://event.chaika.team",
    });
    for (const path of [
      "/",
      "/moon/sunset-tg",
      "/team",
      "/ticket/test",
      "/order/test",
      "/admin",
      "/checkin",
      "/legal/privacy",
      "/api/config",
    ]) {
      const response = await fetch(h.base + path);
      const policy = response.headers.get("content-security-policy");
      assert.ok(policy, path);
      assert.equal(
        policy.includes("https://mc.yandex.ru"),
        path === "/" || path === "/moon/sunset-tg",
        path,
      );
      assert.equal(policy.includes("https://telegram.org"), false, path);
      assert.ok(!policy.includes("unsafe-eval"));
      if (path === "/team") {
        assert.ok(policy.includes("frame-ancestors https://web.telegram.org"));
        assert.equal(response.headers.get("x-frame-options"), null);
      } else assert.ok(policy.includes("frame-ancestors 'none'"));
      assert.ok(!policy.includes(" null"));
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

const eventPriceTiers = [
  { up_to: 50, price: 500000 },
  { up_to: 150, price: 800000 },
  { up_to: null, price: 1000000 },
];
async function tieredEvent(h, legacyQuantity = 0) {
  await h.store.run(
    "UPDATE events SET capacity=300,price_tiers=? WHERE id='red-moon'",
    JSON.stringify(eventPriceTiers),
  );
  if (!legacyQuantity) return;
  const id = randomUUID();
  await h.store.run(
    `INSERT INTO orders(id,access_token,event_id,first_name,last_name,phone,email,quantity,unit_price,total,status,method,mode,created_at,expires_at,buyer_session,idempotency,request_hash,webhook_token)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    id,
    "red-moon",
    "Legacy",
    "Guest",
    "+79990000000",
    "qa@example.com",
    legacyQuantity,
    500000,
    legacyQuantity * 500000,
    "paid",
    "sbp",
    "demo",
    new Date().toISOString(),
    new Date().toISOString(),
    id,
    id,
    id,
    id,
  );
  return id;
}

test("price tiers include historical sales and split orders at ticket 50 and 150", async (t) => {
  const h = await harness(t);
  const legacyId = await tieredEvent(h, 47);
  const q = (await h.request("/events/red-moon/quote?quantity=5")).body;
  assert.deepEqual(
    q.lines.map((l) => [l.quantity, l.unit_price]),
    [
      [3, 500000],
      [2, 800000],
    ],
  );
  assert.equal(q.total, 3100000);
  const order = await h.order({
    ...guest,
    quantity: 5,
    expected_total: q.total,
    total: 1,
    unit_price: 1,
  });
  assert.equal(order.status, 201);
  assert.equal(order.body.total, 3100000);
  assert.deepEqual(order.body.price_breakdown, q.lines);
  assert.equal((await h.request("/events")).body[0].price, 800000);
  const legacy = await h.store.get(
    "SELECT total,price_breakdown FROM orders WHERE id=?",
    legacyId,
  );
  assert.equal(legacy.total, 23500000);
  assert.equal(legacy.price_breakdown, null);
  // Historical tickets may have been sold before tiers were introduced.
  await h.store.run(
    "UPDATE orders SET quantity=148,total=74000000 WHERE id=?",
    legacyId,
  );
  await h.store.run(
    "UPDATE orders SET status='expired' WHERE id=?",
    order.body.id,
  );
  const boundary = (await h.request("/events/red-moon/quote?quantity=5")).body;
  assert.deepEqual(
    boundary.lines.map((l) => [l.quantity, l.unit_price]),
    [
      [2, 800000],
      [3, 1000000],
    ],
  );
  assert.equal(boundary.total, 4600000);
});

test("concurrent orders cannot both reserve the last cheap ticket; stale quotes do not create orders", async (t) => {
  const h = await harness(t);
  await tieredEvent(h, 49);
  const request = { ...guest, quantity: 1, expected_total: 500000 };
  const keys = [randomUUID(), randomUUID()];
  const results = await Promise.all(keys.map((key) => h.order(request, key)));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const winner = results.findIndex((r) => r.status === 201);
  assert.equal(results[1 - winner].body.code, "PRICE_CHANGED");
  const retry = await h.order(request, keys[winner]);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.id, results[winner].body.id);
  assert.equal(retry.body.total, 500000);
  assert.equal((await h.order({ ...guest, quantity: 1 })).status, 409);
  assert.equal((await h.store.get("SELECT COUNT(*) n FROM orders")).n, 2);
  const corrected = await h.order(
    { ...request, expected_total: 800000 },
    keys[1 - winner],
  );
  assert.equal(corrected.status, 201);
  assert.equal(corrected.body.total, 800000);
});

test("expiry releases its own tier and a late payment cannot take a sold cheap place", async (t) => {
  const h = await harness(t);
  await tieredEvent(h, 49);
  const cheap = await h.order({
    ...guest,
    quantity: 1,
    expected_total: 500000,
  });
  const expensive = await h.order({
    ...guest,
    quantity: 1,
    expected_total: 800000,
  });
  await h.store.markPaid(expensive.body.id);
  await h.store.run(
    "UPDATE orders SET status='expired' WHERE id=?",
    cheap.body.id,
  );
  assert.equal(
    (await h.request("/events/red-moon/quote?quantity=1")).body.total,
    500000,
  );
  const replacement = await h.order({
    ...guest,
    quantity: 1,
    expected_total: 500000,
  });
  await h.store.markPaid(replacement.body.id);
  await h.store.markPaid(cheap.body.id);
  assert.equal(
    (await h.store.get("SELECT status FROM orders WHERE id=?", cheap.body.id))
      .status,
    "paid_review",
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) n FROM tickets WHERE order_id=?",
        cheap.body.id,
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT total FROM orders WHERE id=?",
        expensive.body.id,
      )
    ).total,
    800000,
  );
  assert.equal(
    (await h.request("/events/red-moon/quote?quantity=1")).body.total,
    800000,
  );
});

test("legacy late payments honor the old amount only if the old tier is still available", async (t) => {
  const h = await harness(t);
  const pending = await h.order({ ...guest, quantity: 1 });
  await h.store.run(
    "UPDATE orders SET status='expired' WHERE id=?",
    pending.body.id,
  );
  await tieredEvent(h, 49);
  await h.store.markPaid(pending.body.id);
  const paid = await h.store.get(
    "SELECT * FROM orders WHERE id=?",
    pending.body.id,
  );
  assert.equal(paid.status, "paid");
  assert.equal(paid.total, 500000);
  assert.equal(JSON.parse(paid.price_breakdown)[0].tier, 0);
  assert.equal(
    (await h.request("/events/red-moon/quote?quantity=1")).body.total,
    800000,
  );
});

test("test, invite, voided and sandbox tickets do not consume promotional quotas, cash does", async (t) => {
  const h = await harness(t);
  const legacy = await tieredEvent(h, 49);
  for (const condition of [
    "is_test=1",
    "method='invite'",
    "voided_at='2026-01-01'",
    "mode='sandbox'",
  ]) {
    await h.store.run(
      "UPDATE orders SET is_test=0,method='sbp',voided_at=NULL,mode='demo' WHERE id=?",
      legacy,
    );
    await h.store.run(`UPDATE orders SET ${condition} WHERE id=?`, legacy);
    assert.equal(
      (await h.request("/events/red-moon/quote?quantity=2")).body.total,
      1000000,
    );
  }
  await h.store.run(
    "UPDATE orders SET is_test=0,method='sbp',voided_at=NULL,mode='demo' WHERE id=?",
    legacy,
  );
  await h.login();
  const cash = await h.request("/admin/issue", {
    method: "POST",
    key: randomUUID(),
    body: {
      ...guest,
      quantity: 2,
      method: "cash",
      cash_received: true,
      expected_total: 1300000,
    },
  });
  assert.equal(cash.status, 201);
  const issued = await h.store.get("SELECT * FROM orders WHERE method='cash'");
  assert.equal(issued.total, 1300000);
  assert.equal(issued.status, "paid");
  assert.equal(
    (await h.request("/events/red-moon/quote?quantity=1")).body.total,
    800000,
  );
});

test("price policy survives ordinary admin edits and cannot be redefined after reservations", async (t) => {
  const h = await harness(t);
  await h.login();
  const e = (await h.request("/events")).body[0];
  const body = {
    ...e,
    capacity: 300,
    published: true,
    sales_open: true,
    price_tiers: eventPriceTiers,
  };
  assert.equal(
    (await h.request("/admin/events/red-moon", { method: "PUT", body })).status,
    200,
  );
  await h.order({ ...guest, expected_total: 1000000 });
  const changed = await h.request("/admin/events/red-moon", {
    method: "PUT",
    body: { ...body, price_tiers: null },
  });
  assert.equal(changed.status, 409);
  const { price_tiers, ...ordinary } = body;
  assert.equal(
    (
      await h.request("/admin/events/red-moon", {
        method: "PUT",
        body: { ...ordinary, time: "21:00" },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await h.request("/events")).body[0].price_tiers,
    price_tiers,
  );
});

test(
  "PostgreSQL serializes the last tier place across two application instances",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const first = await harness(t);
    await tieredEvent(first, 49);
    const second = await createApp({
      databaseUrl: first.databaseUrl,
      demo: true,
      origin,
      testing: true,
      legalDocuments: fixtureLegalDocuments,
    });
    const server = second.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const config = await fetch(base + "/api/config");
      const cookie = config.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const input = { ...guest, quantity: 1, expected_total: 500000 };
      const responses = await Promise.all([
        first.order(input),
        fetch(base + "/api/orders", {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ ...input, acceptances: first.acceptances }),
        }).then(async (r) => ({ status: r.status, body: await r.json() })),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await second.store.quote("red-moon", 1)).total, 800000);
      const winner = responses.find((r) => r.status === 201).body;
      await second.store.markPaid(winner.id);
      assert.equal(
        (
          await first.store.get(
            "SELECT total FROM orders WHERE id=?",
            winner.id,
          )
        ).total,
        500000,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await second.close();
    }
  },
);

test("admin pricing edits quotas and prices while keeping existing amounts and reservations", async (t) => {
  const h = await harness(t);
  const legacy = await tieredEvent(h, 47);
  const key = randomUUID();
  const input = { ...guest, quantity: 3, expected_total: 1500000 };
  const held = await h.order(input, key);
  await h.login();
  const before = (await h.request("/admin/events/red-moon/pricing")).body;
  assert.deepEqual(
    before.tiers.map((r) => [r.quantity, r.paid, r.reserved]),
    [
      [50, 47, 3],
      [100, 0, 0],
      [150, 0, 0],
    ],
  );
  const tooSmall = await h.request("/admin/events/red-moon/pricing", {
    method: "PUT",
    body: {
      revision: before.revision,
      tiers: [
        { quantity: 49, price: 600000 },
        { quantity: 100, price: 800000 },
        { quantity: 150, price: 1000000 },
      ],
    },
  });
  assert.equal(tooSmall.status, 409);
  assert.equal(
    (await h.store.get("SELECT price_breakdown FROM orders WHERE id=?", legacy))
      .price_breakdown,
    null,
  );
  const edited = await h.request("/admin/events/red-moon/pricing", {
    method: "PUT",
    body: {
      revision: before.revision,
      tiers: [
        { quantity: 60, price: 600000 },
        { quantity: 90, price: 900000 },
        { quantity: 160, price: 1200000 },
      ],
    },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.capacity, 310);
  assert.notEqual(edited.body.revision, before.revision);
  assert.equal(
    (await h.request("/events/red-moon/quote?quantity=1")).body.total,
    600000,
  );
  const retry = await h.order(input, key);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.total, 1500000);
  await h.store.markPaid(held.body.id);
  assert.equal(
    (await h.store.get("SELECT total FROM orders WHERE id=?", held.body.id))
      .total,
    1500000,
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) n FROM tickets WHERE order_id=?",
        held.body.id,
      )
    ).n,
    3,
  );
  const frozen = await h.store.get("SELECT * FROM orders WHERE id=?", legacy);
  assert.equal(frozen.total, 23500000);
  assert.equal(frozen.unit_price, 500000);
  assert.deepEqual(JSON.parse(frozen.price_breakdown), [
    { tier: 0, quantity: 47, unit_price: 500000, total: 23500000 },
  ]);
  const stale = await h.request("/admin/events/red-moon/pricing", {
    method: "PUT",
    body: { revision: before.revision, tiers: before.tiers },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "PRICING_STALE");
  const staleOrder = await h.order({
    ...guest,
    quantity: 1,
    expected_total: 500000,
  });
  assert.equal(staleOrder.status, 409);
  assert.equal(staleOrder.body.code, "PRICE_CHANGED");
  assert.equal(
    (await h.order({ ...guest, quantity: 1, expected_total: 600000 })).body
      .total,
    600000,
  );
  assert.equal(
    (
      await h.store.all(
        "SELECT * FROM audit WHERE action LIKE '%pricing_update%'",
      )
    ).length,
    1,
  );
});

test("changing quota boundaries preserves legacy allocations including their actual old price", async (t) => {
  const h = await harness(t);
  const legacy = await tieredEvent(h, 70);
  await h.login();
  const before = (await h.request("/admin/events/red-moon/pricing")).body;
  const edited = await h.request("/admin/events/red-moon/pricing", {
    method: "PUT",
    body: {
      revision: before.revision,
      tiers: [
        { quantity: 100, price: 600000 },
        { quantity: 100, price: 800000 },
        { quantity: 100, price: 1000000 },
      ],
    },
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(
    edited.body.tiers.map((row) => row.paid),
    [50, 20, 0],
  );
  const historical = await h.store.get(
    "SELECT * FROM orders WHERE id=?",
    legacy,
  );
  assert.equal(historical.total, 35000000);
  assert.deepEqual(
    JSON.parse(historical.price_breakdown).map((line) => [
      line.tier,
      line.quantity,
      line.unit_price,
    ]),
    [
      [0, 50, 500000],
      [1, 20, 500000],
    ],
  );
  const decreaseUsedSecond = await h.request("/admin/events/red-moon/pricing", {
    method: "PUT",
    body: {
      revision: edited.body.revision,
      tiers: [
        { quantity: 200, price: 600000 },
        { quantity: 19, price: 800000 },
        { quantity: 100, price: 1000000 },
      ],
    },
  });
  assert.equal(decreaseUsedSecond.status, 409);
  assert.equal(
    (await h.request("/admin/events/red-moon/pricing")).body.capacity,
    300,
  );
});

test("pricing editor enforces access, quantity, money and capacity rules including invites", async (t) => {
  const h = await harness(t);
  await tieredEvent(h);
  assert.equal((await h.request("/admin/events/red-moon/pricing")).status, 401);
  await h.login("door");
  assert.equal((await h.request("/admin/events/red-moon/pricing")).status, 403);
  assert.equal(
    (
      await h.request("/admin/events/red-moon/pricing", {
        method: "PUT",
        body: {},
      })
    ).status,
    403,
  );
  await h.login();
  const before = (await h.request("/admin/events/red-moon/pricing")).body;
  for (const first of [
    { quantity: 0, price: 500000 },
    { quantity: 1.5, price: 500000 },
    { quantity: 50, price: 0 },
    { quantity: 50, price: 800000 },
    { quantity: 100000, price: 500000 },
  ]) {
    assert.equal(
      (
        await h.request("/admin/events/red-moon/pricing", {
          method: "PUT",
          body: {
            revision: before.revision,
            tiers: [first, ...before.tiers.slice(1)],
          },
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await h.request("/admin/events/red-moon/pricing", {
        method: "PUT",
        body: { revision: before.revision, tiers: before.tiers.slice(0, 2) },
      })
    ).status,
    400,
  );
  await h.request("/admin/issue", {
    method: "POST",
    key: randomUUID(),
    body: { ...guest, quantity: 10, method: "invite" },
  });
  const snapshot = (await h.request("/admin/events/red-moon/pricing")).body;
  assert.equal(snapshot.occupied, 10);
  assert.equal(snapshot.tiers[0].paid, 0);
  const reduced = await h.request("/admin/events/red-moon/pricing", {
    method: "PUT",
    body: {
      revision: snapshot.revision,
      tiers: snapshot.tiers.map((tier) => ({ ...tier, quantity: 1 })),
    },
  });
  assert.equal(reduced.status, 409);
  assert.equal(reduced.body.code, "PRICING_CAPACITY");
  assert.equal((await h.request("/admin/events/missing/pricing")).status, 404);
});

test("simultaneous quota decrease and reservation never oversell a price tier", async (t) => {
  const h = await harness(t);
  await tieredEvent(h, 49);
  await h.login();
  const before = (await h.request("/admin/events/red-moon/pricing")).body;
  const [edit, order] = await Promise.all([
    h.request("/admin/events/red-moon/pricing", {
      method: "PUT",
      body: {
        revision: before.revision,
        tiers: [{ quantity: 49, price: 500000 }, ...before.tiers.slice(1)],
      },
    }),
    h.order({ ...guest, quantity: 1, expected_total: 500000 }),
  ]);
  assert.ok(
    (edit.status === 200 && order.status === 409) ||
      (edit.status === 409 && order.status === 201),
  );
  const after = (await h.request("/admin/events/red-moon/pricing")).body;
  assert.ok(
    after.tiers.every((tier) => tier.paid + tier.reserved <= tier.quantity),
  );
});

test("late payment after a price edit keeps its amount but respects the final tier quota", async (t) => {
  const h = await harness(t);
  await tieredEvent(h, 150);
  const expired = await h.order({
    ...guest,
    quantity: 2,
    expected_total: 2000000,
  });
  await h.store.run(
    "UPDATE orders SET status='expired' WHERE id=?",
    expired.body.id,
  );
  await h.login();
  const before = (await h.request("/admin/events/red-moon/pricing")).body;
  const changed = await h.request("/admin/events/red-moon/pricing", {
    method: "PUT",
    body: {
      revision: before.revision,
      tiers: [
        { quantity: 100, price: 500000 },
        { quantity: 100, price: 800000 },
        { quantity: 1, price: 1100000 },
      ],
    },
  });
  assert.equal(changed.status, 200);
  await h.store.markPaid(expired.body.id);
  const reviewed = await h.store.get(
    "SELECT * FROM orders WHERE id=?",
    expired.body.id,
  );
  assert.equal(reviewed.status, "paid_review");
  assert.equal(reviewed.total, 2000000);
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) n FROM tickets WHERE order_id=?",
        expired.body.id,
      )
    ).n,
    0,
  );
});

async function setPriceRules(h, extra) {
  const before = (await h.request("/admin/events/red-moon/pricing")).body;
  return h.request("/admin/events/red-moon/pricing", {
    method: "PUT",
    body: { revision: before.revision, tiers: before.tiers, ...extra },
  });
}

test("order promo limit reserves one use per order, survives retries and edits, and releases confirmed failures", async (t) => {
  const h = await harness(t);
  await h.login();
  const promo = {
    code: "ONCE",
    kind: "fixed",
    value: 50000,
    active: true,
    limit_scope: "orders",
    max_uses: 1,
  };
  assert.equal((await setPriceRules(h, { promos: [promo] })).status, 200);
  for (let i = 0; i < 2; i++) {
    const quote = await h.request(
      "/events/red-moon/quote?quantity=5&promo_code=ONCE",
    );
    assert.equal(quote.body.discount_total, 250000);
  }
  const body = {
    ...guest,
    quantity: 5,
    promo_code: "ONCE",
    expected_total: 2250000,
  };
  const keys = [randomUUID(), randomUUID()];
  const attempts = await Promise.all(keys.map((key) => h.order(body, key)));
  assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 400]);
  const index = attempts.findIndex((r) => r.status === 201);
  const held = attempts[index].body;
  assert.equal((await h.order(body, keys[index])).body.id, held.id);
  let overview = (await h.request("/admin/events/red-moon/pricing")).body;
  assert.equal(overview.promo_usage.ONCE.held_orders, 1);
  assert.equal(overview.promo_usage.ONCE.held_tickets, 5);
  await h.store.run("UPDATE orders SET status='failed' WHERE id=?", held.id);
  const next = await h.order(body);
  assert.equal(next.status, 201);
  await h.store.markPaid(next.body.id);
  await setPriceRules(h, { promos: [] });
  await setPriceRules(h, { promos: [promo] });
  assert.equal((await h.order(body)).status, 400);
  overview = (await h.request("/admin/events/red-moon/pricing")).body;
  assert.equal(overview.promo_usage.ONCE.paid_orders, 1);
  // A late bank confirmation cannot issue another set of discounted tickets.
  await h.store.markPaid(held.id);
  assert.equal(
    (await h.store.get("SELECT status FROM orders WHERE id=?", held.id)).status,
    "paid_review",
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM tickets WHERE order_id=?",
        held.id,
      )
    ).n,
    0,
  );
});

test("ticket promo caps apply to part of the order and freeze discount snapshots", async (t) => {
  const h = await harness(t);
  await h.login();
  const promo = {
    code: "TWO",
    kind: "percent",
    value: 1500,
    active: true,
    limit_scope: "tickets",
    max_uses: 2,
  };
  await setPriceRules(h, { promos: [promo] });
  const quote = (
    await h.request("/events/red-moon/quote?quantity=5&promo_code=TWO")
  ).body;
  assert.equal(quote.promo.discounted_quantity, 2);
  assert.equal(quote.total, 2350000);
  assert.deepEqual(
    quote.lines.map((l) => [l.quantity, l.unit_price]),
    [
      [2, 425000],
      [3, 500000],
    ],
  );
  const order = await h.order({
    ...guest,
    quantity: 5,
    promo_code: "TWO",
    expected_total: quote.total,
  });
  assert.equal(order.status, 201);
  assert.equal(
    (await h.request("/events/red-moon/quote?quantity=1&promo_code=TWO"))
      .status,
    400,
  );
  await h.store.markPaid(order.body.id);
  // Changing counting units reuses historical usage in the selected units.
  await setPriceRules(h, { promos: [{ ...promo, limit_scope: "orders" }] });
  assert.equal(
    (await h.request("/events/red-moon/quote?quantity=5&promo_code=TWO")).body
      .promo.discounted_quantity,
    5,
  );
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) AS n FROM tickets WHERE order_id=?",
        order.body.id,
      )
    ).n,
    5,
  );
  assert.equal(
    JSON.parse(
      (
        await h.store.get(
          "SELECT discount_snapshot FROM orders WHERE id=?",
          order.body.id,
        )
      ).discount_snapshot,
    ).discounted_quantity,
    2,
  );
  const stats = (await h.request("/admin/events/red-moon/pricing")).body
    .promo_usage.TWO;
  assert.equal(stats.paid_tickets, 2);
  assert.equal(stats.paid_orders, 1);
});

test("promo time bounds are inclusive at start and exclusive at end; reserved orders keep their discount", async (t) => {
  const h = await harness(t);
  await h.login();
  const at = Date.now();
  const promo = {
    code: "TIME",
    kind: "percent",
    value: 500,
    active: true,
    starts_at: new Date(at).toISOString(),
    ends_at: new Date(at + 60000).toISOString(),
  };
  await setPriceRules(h, { promos: [promo] });
  const quote = () =>
    h.store.transaction(() => h.store.quote("red-moon", 2, "TIME"));
  const clock = t.mock.method(Date, "now", () => at - 1);
  await assert.rejects(quote, /не действует/);
  clock.mock.mockImplementation(() => at);
  assert.equal((await quote()).total, 950000);
  clock.mock.mockImplementation(() => at + 60000);
  await assert.rejects(quote, /не действует/);
  clock.mock.restore();
  const held = await h.order({
    ...guest,
    promo_code: "TIME",
    expected_total: 950000,
  });
  assert.equal(held.status, 201);
  await setPriceRules(h, { promos: [{ ...promo, active: false }] });
  await h.store.markPaid(held.body.id);
  assert.equal(
    (await h.store.get("SELECT total FROM orders WHERE id=?", held.body.id))
      .total,
    950000,
  );
});

test("wristband handouts are authenticated, partial, idempotent and independent of entry", async (t) => {
  const h = await harness(t);
  const order = (await h.order({ ...guest, quantity: 5 })).body;
  await h.store.markPaid(order.id);
  const tickets = await h.store.all(
    "SELECT * FROM tickets WHERE order_id=? ORDER BY ordinal",
    order.id,
  );
  const body = { event_id: "red-moon", code: tickets[0].code };
  const preview = () =>
    h.request("/wristbands/preview", { method: "POST", body });
  const issue = (
    quantity,
    expected_checked,
    request_id = randomUUID(),
    code = body.code,
  ) =>
    h.request("/wristbands/group", {
      method: "POST",
      body: { ...body, code, quantity, expected_checked, request_id },
    });
  assert.equal((await preview()).status, 401);
  assert.equal((await issue(1, 0)).status, 401);
  assert.equal(
    (await h.request("/wristbands/summary?event_id=red-moon")).status,
    401,
  );
  await h.login("door");
  assert.equal((await preview()).body.group.remaining, 5);
  const id = randomUUID();
  const first = await issue(3, 0, id);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.group, { issued: 5, checked: 3, remaining: 2 });
  assert.equal((await issue(3, 0, id)).body.replayed, true);
  assert.equal((await issue(2, 0, id)).status, 409);
  assert.equal((await issue(1, 0)).status, 409);
  assert.equal((await issue(3, 3)).status, 409);
  assert.equal((await issue(0, 3)).status, 400);
  assert.equal((await h.store.attendance("red-moon", true)).checked, 0);
  const search = await h.request("/wristbands/search", {
    method: "POST",
    body: { event_id: "red-moon", query: "Проверочный" },
  });
  assert.equal(search.body.orders[0].group.checked, 3);
  const entrants = await h.request("/checkin/group", {
    method: "POST",
    body: {
      ...body,
      quantity: 4,
      expected_checked: 0,
      request_id: randomUUID(),
    },
  });
  assert.equal(entrants.status, 200);
  assert.equal((await preview()).body.group.checked, 3);
  // Another QR from the same group shares the wristband balance, even after entry.
  const parallel = await Promise.all([
    issue(2, 3),
    issue(2, 3, randomUUID(), tickets[3].code),
  ]);
  assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await h.store.attendance("red-moon", true)).checked, 4);
  assert.equal((await preview()).body.group.remaining, 0);
  const summary = (await h.request("/wristbands/summary?event_id=red-moon"))
    .body;
  assert.equal(summary.checked, 5);
  assert.equal(summary.remaining, 0);
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM wristband_batches")).n,
    2,
  );
});

test("wristbands reject unpaid, voided, test and wrong-event tickets", async (t) => {
  const h = await harness(t);
  const order = (await h.order({ ...guest, quantity: 1 })).body;
  await h.store.markPaid(order.id);
  const ticket = await h.store.get(
    "SELECT * FROM tickets WHERE order_id=?",
    order.id,
  );
  await h.login("door");
  const issue = (event_id = "red-moon") =>
    h.request("/wristbands/group", {
      method: "POST",
      body: {
        event_id,
        code: ticket.code,
        quantity: 1,
        expected_checked: 0,
        request_id: randomUUID(),
      },
    });
  assert.equal((await issue("other")).status, 409);
  for (const [column, value, reset] of [
    ["status", "pending", "paid"],
    ["voided_at", new Date().toISOString(), null],
    ["is_test", 1, 0],
  ]) {
    await h.store.run(
      `UPDATE orders SET ${column}=? WHERE id=?`,
      value,
      order.id,
    );
    assert.equal((await issue()).status, 409);
    await h.store.run(
      `UPDATE orders SET ${column}=? WHERE id=?`,
      reset,
      order.id,
    );
  }
  assert.equal(
    (await h.store.get("SELECT COUNT(*) AS n FROM wristband_batches")).n,
    0,
  );
});

test("dated prices and promo codes apply per ticket while freezing orders and idempotent retries", async (t) => {
  const h = await harness(t);
  await tieredEvent(h, 49);
  await h.login();
  const promos = [
    { code: "fixed", kind: "fixed", value: 100000, active: true },
    { code: "percent", kind: "percent", value: 1250, active: true },
  ];
  let edited = await setPriceRules(h, { promos });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.promos[0].code, "FIXED");
  const quote = (
    await h.request("/events/red-moon/quote?quantity=3&promo_code=fixed")
  ).body;
  assert.equal(quote.subtotal, 2100000);
  assert.equal(quote.discount_total, 300000);
  assert.equal(quote.total, 1800000);
  const key = randomUUID();
  const body = {
    ...guest,
    quantity: 3,
    promo_code: "fixed",
    expected_total: 1800000,
  };
  const held = await h.order(body, key);
  assert.equal(held.status, 201);
  assert.equal(held.body.discount.code, "FIXED");
  assert.equal(held.body.discount.discount_total, 300000);
  assert.deepEqual(
    held.body.price_breakdown.map((l) => [l.tier, l.quantity, l.unit_price]),
    [
      [0, 1, 400000],
      [1, 2, 700000],
    ],
  );
  // An activated date overrides both the first and second quantity price.
  const schedule = [
    { starts_at: new Date(Date.now() - 1000).toISOString(), price: 900000 },
    {
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      price: 1100000,
    },
  ];
  edited = await setPriceRules(h, {
    schedule,
    promos: promos.map((p) => ({ ...p, active: p.code !== "fixed" })),
  });
  assert.equal(edited.status, 200);
  assert.equal((await h.request("/events")).body[0].price, 900000);
  assert.equal("promo_codes" in (await h.request("/events")).body[0], false);
  const dated = (
    await h.request("/events/red-moon/quote?quantity=3&promo_code=percent")
  ).body;
  assert.equal(dated.total, 2362500);
  assert.equal(dated.discount_total, 337500);
  assert.equal((await h.order(body, key)).body.id, held.body.id);
  await h.store.markPaid(held.body.id);
  const paid = await h.store.get(
    "SELECT * FROM orders WHERE id=?",
    held.body.id,
  );
  assert.equal(paid.total, 1800000);
  assert.equal(paid.status, "paid");
  assert.equal(
    (
      await h.store.get(
        "SELECT COUNT(*) n FROM tickets WHERE order_id=?",
        paid.id,
      )
    ).n,
    3,
  );
  assert.equal(
    (await h.request("/events/red-moon/quote?quantity=1&promo_code=FIXED")).body
      .code,
    "PROMO_INVALID",
  );
  const stale = await h.order({ ...guest, expected_total: 1600000 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "PRICE_CHANGED");
  const paidQuote = await h.order({
    ...guest,
    promo_code: "percent",
    expected_total: 1575000,
  });
  assert.equal(paidQuote.status, 201);
  // Old clients editing just quotas do not silently erase date or promo settings.
  edited = await setPriceRules(h, {});
  assert.equal(edited.body.schedule.length, 2);
  assert.equal(edited.body.promos.length, 2);
});

test("fixed-price events support dates, promo snapshots and admin cash without changing existing orders", async (t) => {
  const h = await harness(t);
  await h.login();
  const before = (await h.request("/admin/events/red-moon/pricing")).body;
  const set = await setPriceRules(h, {
    schedule: [
      { starts_at: new Date(Date.now() - 1000).toISOString(), price: 600000 },
    ],
    promos: [{ code: "SALE", kind: "fixed", value: 50000, active: true }],
  });
  assert.equal(set.status, 200);
  assert.equal(
    (await h.order({ ...guest, promo_code: "SALE" })).body.code,
    "PRICE_CHANGED",
  );
  assert.equal(
    (await h.order({ ...guest, expected_total: before.tiers[0].price * 2 }))
      .body.code,
    "PRICE_CHANGED",
  );
  const order = await h.order({
    ...guest,
    promo_code: "sale",
    expected_total: 1100000,
  });
  assert.equal(order.status, 201);
  assert.equal(order.body.total, 1100000);
  assert.equal(order.body.price_breakdown[0].unit_price, 550000);
  const overview = (await h.request("/admin/events/red-moon/pricing")).body;
  assert.equal(overview.tiers[0].reserved, 2);
  const cash = await h.request("/admin/issue", {
    method: "POST",
    key: randomUUID(),
    body: {
      ...guest,
      method: "cash",
      cash_received: true,
      expected_total: 1200000,
    },
  });
  assert.equal(cash.status, 201);
  assert.equal(
    (await h.store.get("SELECT total FROM orders WHERE method='cash'")).total,
    1200000,
  );
  assert.equal(
    (await h.request("/admin/events/red-moon/pricing")).body.tiers[0].paid,
    2,
  );
  // Schedule edits share the pricing revision and cannot overwrite newer promo changes.
  assert.equal(
    (
      await h.request("/admin/events/red-moon/pricing", {
        method: "PUT",
        body: { revision: before.revision, tiers: before.tiers, schedule: [] },
      })
    ).body.code,
    "PRICING_STALE",
  );
});

test("invalid codes and invalid price rules cannot create a payable order or expose private codes", async (t) => {
  const h = await harness(t);
  await h.login();
  const before = (await h.request("/admin/events/red-moon/pricing")).body;
  for (const extra of [
    { schedule: [{ starts_at: "2026-10-13", price: 800000 }] },
    { schedule: [{ starts_at: "2026-10-13T00:00:00+03:00", price: -1 }] },
    { promos: [{ code: "XX", kind: "percent", value: 10000, active: true }] },
    { promos: [{ code: "XX", kind: "fixed", value: 50, active: true }] },
    {
      promos: [
        { code: "XX", kind: "fixed", value: 100, active: true },
        { code: "xx", kind: "fixed", value: 200, active: true },
      ],
    },
  ])
    assert.equal((await setPriceRules(h, extra)).status, 400);
  assert.equal(
    (await h.request("/admin/events/red-moon/pricing")).body.revision,
    before.revision,
  );
  await setPriceRules(h, {
    promos: [
      { code: "TOOMUCH", kind: "fixed", value: 100000000, active: true },
    ],
  });
  for (const promo_code of ["UNKNOWN", "TOOMUCH"]) {
    assert.equal(
      (await h.order({ ...guest, promo_code, expected_total: 1 })).body.code,
      "PROMO_INVALID",
    );
  }
  assert.equal((await h.store.get("SELECT COUNT(*) n FROM orders")).n, 0);
  assert.equal(
    (await h.request("/events")).body.some((e) => "promo_codes" in e),
    false,
  );
  await h.login("door");
  assert.equal((await h.request("/admin/events/red-moon/pricing")).status, 403);
});
