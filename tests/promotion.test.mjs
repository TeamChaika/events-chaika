import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../server/index.mjs";
import { currentLegalDocuments } from "../server/legal.mjs";
import {
  verifyTelegramData,
  ATTRIBUTION_CONSENT_VERSION,
  createGroupAccess,
} from "../server/promotion.mjs";

const botToken = "12345:technical_test_secret";
function signed(
  user = { id: 10001, first_name: "Тест", username: "test_owner" },
  at = Math.floor(Date.now() / 1000),
  extra = {},
) {
  const params = new URLSearchParams({
    auth_date: String(at),
    user: JSON.stringify(user),
    ...extra,
  });
  const check = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
const attribution = (first, last = first) => ({
  first: first.id,
  last: last.id,
  consent_version: ATTRIBUTION_CONSENT_VERSION,
});
async function harness(t, options = {}) {
  process.env.TELEGRAM_BOT_TOKEN = botToken;
  process.env.TELEGRAM_MINIAPP_OWNER_ID = "10001";
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
  const h = await createApp({
    dbPath: ":memory:",
    databaseUrl,
    origin: "http://localhost:5173",
    demo: true,
    testing: true,
    legalDocuments: currentLegalDocuments.map((doc) => ({
      ...doc,
      version: "test.1",
      content: `Fixture ${doc.slug}`,
    })),
    ...options,
  });
  await h.store.run("UPDATE events SET date='2099-10-31'");
  const server = h.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await h.close();
    await cleanupDatabase?.();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "",
    bearer = "";
  const request = async (path, method = "GET", body, options = {}) => {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: options.origin || "http://localhost:5173",
        Cookie: options.cookie ?? cookie,
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        ...(options.key ? { "Idempotency-Key": options.key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";")[0];
      cookie = cookie
        .split("; ")
        .filter((v) => v && v.split("=")[0] !== pair.split("=")[0])
        .concat(pair)
        .join("; ");
    }
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  };
  await request("/config");
  const legal = (await request("/legal")).body;
  const acceptances = Object.fromEntries(
    legal.documents
      .filter((doc) => ["terms", "consent"].includes(doc.slug))
      .map((doc) => [doc.slug, { accepted: true, hash: doc.hash }]),
  );
  const order = async (
    source,
    key = randomUUID(),
    event_id = "red-moon",
    promo_code,
  ) =>
    request(
      "/orders",
      "POST",
      {
        first_name: "Тест",
        last_name: "Гость",
        email: "fixture@example.com",
        phone: "+79990000000",
        quantity: 2,
        event_id,
        ...(promo_code
          ? {
              promo_code,
              expected_total: (await h.store.quote(event_id, 2, promo_code))
                .total,
            }
          : {}),
        acceptances,
        ...(source ? { attribution: source } : {}),
      },
      { key },
    );
  const login = async (user) => {
    const result = await request("/team/auth", "POST", {
      initData: signed(user),
    });
    bearer = result.body.token || "";
    return result;
  };
  const link = (body = {}) =>
    request("/team/links", "POST", {
      event_id: "red-moon",
      event_slug: "moon",
      source_name: "Sunset Vibes",
      placement: "Telegram",
      slug: "sunset-tg",
      ...body,
    });
  return {
    ...h,
    base,
    request,
    login,
    link,
    order,
    setBearer: (value) => {
      bearer = value;
    },
  };
}

test("Telegram signature rejects forged, duplicated, stale and future data", () => {
  assert.equal(verifyTelegramData(signed(), botToken).id, "10001");
  assert.equal(
    verifyTelegramData(
      signed(undefined, undefined, {
        signature: "test-signature",
        start_param: "sales",
      }),
      botToken,
    ).username,
    "test_owner",
  );
  for (const raw of [
    signed().replace("10001", "10002"),
    signed() + "&auth_date=1",
    signed(undefined, Math.floor(Date.now() / 1000) - 901),
    signed(undefined, Math.floor(Date.now() / 1000) + 100),
    signed({ id: -1, first_name: "Bad" }),
  ])
    assert.throws(() => verifyTelegramData(raw, botToken), { status: 401 });
  assert.throws(() => verifyTelegramData(signed(), "wrong"), { status: 401 });
});

test("only approved Telegram users see aggregate data; roles and immediate revocation are enforced", async (t) => {
  const h = await harness(t);
  assert.equal((await h.request("/team/catalog")).status, 401);
  assert.equal(
    (await h.request("/team/auth", "POST", { initData: "forged" })).status,
    401,
  );
  const owner = await h.login();
  assert.equal(owner.body.member.role, "owner");
  const unknown = { id: 20002, first_name: "Сотрудник", username: "staff" };
  const pending = await h.login(unknown);
  assert.equal(pending.status, 403);
  assert.equal(pending.body.member.status, "pending");
  h.setBearer(owner.body.token);
  assert.equal(
    (
      await h.request("/team/members/20002", "PATCH", {
        role: "viewer",
        status: "active",
      })
    ).status,
    200,
  );
  const viewer = await h.login(unknown);
  assert.equal(viewer.status, 200);
  assert.equal((await h.request("/team/stats")).status, 200);
  assert.equal((await h.request("/team/members")).status, 403);
  assert.equal((await h.link()).status, 403);
  assert.equal((await h.request("/admin/overview")).status, 401);
  h.setBearer(owner.body.token);
  assert.equal(
    (
      await h.request("/team/members/20002", "PATCH", {
        role: "editor",
        status: "active",
      })
    ).status,
    200,
  );
  await h.login(unknown);
  const created = await h.link();
  assert.equal(created.status, 201);
  assert.equal(created.body.created_by, "20002");
  const editorToken = (await h.login(unknown)).body.token;
  h.setBearer(owner.body.token);
  assert.equal(
    (
      await h.request("/team/members/10001", "PATCH", {
        role: "viewer",
        status: "blocked",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.request("/team/members/20002", "PATCH", {
        role: "editor",
        status: "blocked",
      })
    ).status,
    200,
  );
  h.setBearer(editorToken);
  assert.equal((await h.request("/team/stats")).status, 401);
});

test("team promo creation respects roles, validates rules and never rewrites ticket prices", async (t) => {
  const h = await harness(t);
  const path = "/team/events/red-moon/promos";
  const promo = {
    code: "save500",
    kind: "fixed",
    value: 50000,
    active: true,
    limit_scope: "tickets",
    max_uses: 3,
    starts_at: "2026-10-01T00:00:00+03:00",
    ends_at: "2099-10-30T00:00:00+03:00",
  };
  assert.equal((await h.request(path)).status, 401);
  assert.equal((await h.request(path, "POST", promo)).status, 401);
  const owner = (await h.login()).body;
  const user = { id: 20003, first_name: "Редактор" };
  await h.login(user);
  h.setBearer(owner.token);
  await h.request("/team/members/20003", "PATCH", {
    role: "viewer",
    status: "active",
  });
  await h.login(user);
  assert.equal((await h.request(path)).status, 200);
  assert.equal((await h.request(path, "POST", promo)).status, 403);
  h.setBearer(owner.token);
  await h.request("/team/members/20003", "PATCH", {
    role: "editor",
    status: "active",
  });
  await h.login(user);
  const before = await h.store.pricingOverview("red-moon");
  for (const patch of [
    { value: -1 },
    { kind: "percent", value: 10000 },
    { max_uses: 0 },
    { ends_at: promo.starts_at },
  ])
    assert.equal(
      (await h.request(path, "POST", { ...promo, ...patch })).status,
      400,
    );
  assert.equal(
    (await h.request("/team/events/missing/promos", "POST", promo)).status,
    404,
  );
  const results = await Promise.all([
    h.request(path, "POST", promo),
    h.request(path, "POST", promo),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const after = await h.store.pricingOverview("red-moon");
  assert.deepEqual(after.tiers, before.tiers);
  assert.deepEqual(after.schedule, before.schedule);
  assert.equal(after.capacity, before.capacity);
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.promos[0].code, "SAVE500");
  assert.equal(after.promos[0].starts_at, "2026-09-30T21:00:00.000Z");
  const quote = await h.store.quote("red-moon", 5, "SAVE500");
  assert.equal(quote.promo.discounted_quantity, 3);
  assert.equal(quote.discount_total, 150000);
  const percent = {
    code: "PERCENT",
    kind: "percent",
    value: 1500,
    active: true,
    limit_scope: "orders",
    max_uses: 1,
  };
  assert.equal((await h.request(path, "POST", percent)).status, 201);
  const list = (await h.request(path)).body;
  assert.equal(list.promos.length, 2);
  assert.equal(list.promos[0].created_by, "20003");
  assert.equal(list.promos[0].creator_name, "Редактор");
  assert.equal(list.promos[0].can_deactivate, true);
  assert.ok(Date.parse(list.promos[0].created_at));
  assert.deepEqual(list.usage, {});
  const audit = await h.store.get(
    "SELECT actor FROM audit WHERE action LIKE '%promo_created%' ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(audit.actor, "20003");
});

test("promo authors survive admin edits and only creators or owners can deactivate", async (t) => {
  const h = await harness(t);
  const path = "/team/events/red-moon/promos";
  const rule = { code: "OWNER", kind: "fixed", value: 50000, active: true };
  const owner = (await h.login()).body;
  const created = await h.request(path, "POST", {
    ...rule,
    created_by: "20004",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.created_by, "10001");
  const user = { id: 20004, first_name: "Анна", last_name: "СММ" };
  await h.login(user);
  h.setBearer(owner.token);
  await h.request("/team/members/20004", "PATCH", {
    role: "editor",
    status: "active",
  });
  await h.login(user);
  assert.equal(
    (await h.request(path, "POST", { ...rule, code: "EDITOR" })).status,
    201,
  );
  let list = (await h.request(path)).body.promos;
  assert.equal(list.find((p) => p.code === "OWNER").can_deactivate, false);
  assert.equal(list.find((p) => p.code === "EDITOR").creator_name, "Анна СММ");
  assert.equal(
    (await h.request(path + "/OWNER", "PATCH", { active: false })).status,
    403,
  );
  assert.equal(
    (await h.request(path + "/EDITOR", "PATCH", { active: true })).status,
    400,
  );
  assert.equal(
    (await h.request(path + "/EDITOR", "PATCH", { active: false, value: 1 }))
      .status,
    400,
  );
  assert.equal(
    (await h.request(path + "/MISSING", "PATCH", { active: false })).status,
    404,
  );
  assert.equal(
    (
      await h.request("/team/events/missing/promos/EDITOR", "PATCH", {
        active: false,
      })
    ).status,
    404,
  );

  const before = await h.store.pricingOverview("red-moon");
  const pricingInput = {
    revision: before.revision,
    tiers: before.tiers.map(({ quantity, price }) => ({ quantity, price })),
    promos: [
      ...before.promos.map((p) => ({ ...p, value: 40000 })),
      { ...before.promos[0], code: "ADMIN" },
    ],
  };
  await h.store.updatePricing("red-moon", pricingInput, "admin");
  list = (await h.request(path)).body.promos;
  assert.equal(list.find((p) => p.code === "EDITOR").created_by, "20004");
  assert.equal(
    list.find((p) => p.code === "ADMIN").creator_name,
    "Администратор сайта",
  );
  assert.equal(list.find((p) => p.code === "ADMIN").can_deactivate, false);
  const pending = await h.order(undefined, randomUUID(), "red-moon", "EDITOR");
  assert.equal(pending.status, 201);
  const frozen = await h.store.get(
    "SELECT total,discount_snapshot FROM orders WHERE id=?",
    pending.body.id,
  );
  const usage = await h.store.promoUsage("red-moon");
  assert.equal(usage.EDITOR.held_orders, 1);
  const unchanged = await h.store.pricingOverview("red-moon");
  const results = await Promise.all([
    h.request(path + "/editor", "PATCH", { active: false }),
    h.request(path + "/EDITOR", "PATCH", { active: false }),
    h.request(path, "POST", { ...rule, code: "PARALLEL" }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200, 201],
  );
  assert.equal(results[0].body.active, false);
  assert.equal(results[0].body.can_deactivate, false);
  assert.equal(results[0].body.created_by, "20004");
  await assert.rejects(h.store.quote("red-moon", 1, "EDITOR"), { status: 400 });
  const after = await h.store.pricingOverview("red-moon");
  assert.deepEqual(after.tiers, unchanged.tiers);
  assert.deepEqual(after.schedule, unchanged.schedule);
  assert.equal(after.capacity, unchanged.capacity);
  assert.equal(after.promos.length, 4);
  assert.deepEqual(await h.store.promoUsage("red-moon"), usage);
  await h.store.markPaid(pending.body.id);
  assert.deepEqual(
    await h.store.get(
      "SELECT total,discount_snapshot FROM orders WHERE id=?",
      pending.body.id,
    ),
    frozen,
  );
  assert.equal((await h.store.promoUsage("red-moon")).EDITOR.paid_orders, 1);
  await assert.rejects(
    h.store.updatePricing(
      "red-moon",
      { ...pricingInput, revision: unchanged.revision },
      "admin",
    ),
    { status: 409 },
  );
  const audit = await h.store.all(
    "SELECT action,actor FROM audit WHERE entity=?",
    "red-moon",
  );
  const paused = audit
    .map((r) => {
      try {
        return { ...JSON.parse(r.action), actor: r.actor };
      } catch {
        return {};
      }
    })
    .filter((r) => r.action === "promo_deactivated");
  assert.equal(paused.length, 1);
  assert.equal(paused[0].actor, "20004");

  h.setBearer(owner.token);
  assert.equal(
    (await h.request(path + "/PARALLEL", "PATCH", { active: false })).status,
    200,
  );
  await h.request("/team/members/20004", "PATCH", {
    role: "viewer",
    status: "active",
  });
  await h.login(user);
  list = (await h.request(path)).body.promos;
  assert.ok(list.every((p) => !p.can_deactivate));
  assert.equal(
    (await h.request(path + "/EDITOR", "PATCH", { active: false })).status,
    403,
  );
  h.setBearer("");
  assert.equal(
    (await h.request(path + "/OWNER", "PATCH", { active: false })).status,
    401,
  );
});

test("legacy promo authors stay unknown after deletion and recreation; history is event-scoped", async (t) => {
  const h = await harness(t);
  await h.login();
  const path = "/team/events/red-moon/promos";
  const promo = { code: "LEGACY", kind: "percent", value: 500, active: true };
  await h.store.run(
    "UPDATE events SET promo_codes=? WHERE id=?",
    JSON.stringify([promo]),
    "red-moon",
  );
  await h.store.audit("not-json", "red-moon", "admin");
  await h.store.audit(
    JSON.stringify({ action: "promo_created", promo }),
    "other-event",
    "10001",
  );
  let legacy = (await h.request(path)).body.promos[0];
  assert.equal(legacy.created_by, null);
  assert.equal(legacy.creator_name, null);
  assert.equal(legacy.can_deactivate, true);
  const before = await h.store.pricingOverview("red-moon");
  await h.store.updatePricing(
    "red-moon",
    {
      revision: before.revision,
      tiers: before.tiers.map(({ quantity, price }) => ({ quantity, price })),
      promos: [],
    },
    "admin",
  );
  assert.equal((await h.request(path, "POST", promo)).status, 201);
  legacy = (await h.request(path)).body.promos[0];
  assert.equal(legacy.created_by, null);
  assert.equal(
    (await h.request(path + "/LEGACY", "PATCH", { active: false })).status,
    200,
  );
});

test("team wristband totals are event-wide, independent of entry and contain no guest data", async (t) => {
  const h = await harness(t);
  await h.login();
  const order = (await h.order()).body;
  await h.store.markPaid(order.id);
  await h.store.run("UPDATE orders SET mode='live' WHERE id=?", order.id);
  const ticket = await h.store.get(
    "SELECT code FROM tickets WHERE order_id=? LIMIT 1",
    order.id,
  );
  await h.store.issueWristbands(
    ticket.code,
    "red-moon",
    1,
    0,
    randomUUID(),
    "test",
  );
  const report = (
    await h.request("/team/stats?event_id=red-moon&from=2099-01-01")
  ).body;
  assert.equal(report.totals.tickets, 0);
  assert.deepEqual(report.wristbands, { issued: 2, checked: 1, remaining: 1 });
  assert.equal((await h.store.attendance("red-moon")).checked, 0);
  assert.equal(JSON.stringify(report).includes("79990000000"), false);
  await h.store.run(
    "UPDATE orders SET voided_at=? WHERE id=?",
    new Date().toISOString(),
    order.id,
  );
  assert.deepEqual(
    (await h.request("/team/stats?event_id=red-moon")).body.wristbands,
    { issued: 0, checked: 0, remaining: 0 },
  );
});

test("source links belong to an event, are reusable, and invalid/colliding paths are rejected", async (t) => {
  const h = await harness(t);
  await h.login();
  const first = (await h.link()).body;
  assert.equal(first.url, "http://localhost:5173/moon/sunset-tg");
  assert.equal((await h.link()).status, 409);
  assert.equal((await h.link({ slug: "bad/slash" })).status, 400);
  assert.equal((await h.link({ event_slug: "admin" })).status, 400);
  assert.equal(
    (await h.link({ slug: "other", source_name: "Sunset\nVibes" })).status,
    400,
  );
  const second = (
    await h.link({
      slug: "sunset-vk",
      placement: "VK",
      source_name: "sunset vibes",
    })
  ).body;
  assert.equal(second.source_id, first.source_id);
  const event = await h.store.get("SELECT * FROM events WHERE id='red-moon'");
  event.id = "winter";
  await h.store.run(
    `INSERT INTO events(${Object.keys(event).join(",")}) VALUES (${Object.keys(
      event,
    )
      .map(() => "?")
      .join(",")})`,
    ...Object.values(event),
  );
  assert.equal(
    (await h.link({ event_id: "winter", event_slug: "moon" })).status,
    409,
  );
  const third = (await h.link({ event_id: "winter", event_slug: "winter" }))
    .body;
  assert.equal(third.source_id, first.source_id);
  assert.deepEqual(
    (await h.request("/promotion/resolve?event=winter&source=sunset-tg")).body,
    { event_id: "winter", link_id: third.id },
  );
  assert.equal((await h.order(attribution(third))).status, 400);
  assert.equal(
    (await h.request("/promotion/resolve?event=missing&source=missing")).status,
    404,
  );
  await h.request("/team/links/" + first.id, "PATCH", { active: false });
  assert.equal(
    (await h.request("/promotion/resolve?event=moon&source=sunset-tg")).status,
    410,
  );
  await h.store.run("UPDATE events SET published=0 WHERE id='winter'");
  assert.equal(
    (await h.request("/promotion/resolve?event=winter&source=sunset-tg"))
      .status,
    404,
  );
});

test("checkout snapshots first and last sources once, before payment, only with current analytics consent", async (t) => {
  const h = await harness(t);
  await h.login();
  const first = (await h.link()).body;
  const last = (await h.link({ slug: "tg", source_name: "Наш Telegram" })).body;
  const key = randomUUID();
  assert.equal((await h.order({ first: first.id, last: last.id })).status, 400);
  assert.equal(
    (await h.order({ ...attribution(first), consent_version: "old" })).status,
    400,
  );
  const created = await h.order(attribution(first, last), key);
  assert.equal(created.status, 201);
  const saved = await h.store.get(
    "SELECT * FROM orders WHERE id=?",
    created.body.id,
  );
  assert.equal(saved.first_source_link_id, first.id);
  assert.equal(saved.source_link_id, last.id);
  assert.equal(saved.source_label, "Наш Telegram · Telegram");
  assert.equal(saved.source_consent_version, ATTRIBUTION_CONSENT_VERSION);
  assert.ok(saved.source_consent_at);
  assert.equal((await h.order(attribution(first, last), key)).status, 200);
  assert.equal((await h.order(attribution(first), key)).status, 409);
  await h.store.markPaid(saved.id);
  assert.equal(
    (
      await h.store.get(
        "SELECT source_link_id FROM orders WHERE id=?",
        saved.id,
      )
    ).source_link_id,
    last.id,
  );
  assert.equal((await h.order(attribution({ id: randomUUID() }))).status, 400);
  const untagged = await h.order();
  assert.equal(untagged.status, 201);
  assert.equal(
    (
      await h.store.get(
        "SELECT source_link_id FROM orders WHERE id=?",
        untagged.body.id,
      )
    ).source_link_id,
    null,
  );
  assert.equal(
    created.body.source_label,
    undefined,
    "customer API does not expose staff attribution",
  );
});

test("reports count paid live orders and ticket quantity, exclude tests/invites/voids, and expose no customer PII", async (t) => {
  const h = await harness(t);
  await h.login();
  const link = (await h.link()).body;
  const make = async (patch = {}, tagged = true) => {
    const o = await h.order(tagged ? attribution(link) : undefined);
    await h.store.markPaid(o.body.id);
    const values = {
      mode: "live",
      paid_at: "2026-10-05T12:00:00.000Z",
      ...patch,
    };
    await h.store.run(
      `UPDATE orders SET ${Object.keys(values)
        .map((k) => k + "=?")
        .join(",")} WHERE id=?`,
      ...Object.values(values),
      o.body.id,
    );
    return o.body;
  };
  const ordinary = await make();
  await make({}, false);
  await make({ mode: "demo" });
  await make({ is_test: 1 });
  await make({ voided_at: "2026-10-06" });
  await make({ method: "invite", total: 0 });
  await make({ status: "paid_review" });
  const stats = (
    await h.request(
      "/team/stats?event_id=red-moon&from=2026-10-05&to=2026-10-05",
    )
  ).body;
  assert.deepEqual(stats.totals, {
    orders: 2,
    tickets: 4,
    revenue: ordinary.total * 2,
  });
  assert.equal(
    stats.rows.find((row) => row.source_link_id === link.id).tickets,
    2,
  );
  assert.equal(stats.rows.find((row) => row.source_link_id === null).orders, 1);
  assert.doesNotMatch(
    JSON.stringify(stats),
    /fixture@example|79990000000|access_token|first_name|last_name|buyer_session/,
  );
  assert.equal(
    (await h.request("/team/stats?event_id=red-moon&from=2026-10-06")).body
      .totals.tickets,
    0,
  );
  assert.equal(
    (await h.request("/team/stats?from=2026-11-01&to=2026-10-01")).status,
    400,
  );
});

test("browser admin can manage the team while scanner and cross-origin requests cannot", async (t) => {
  const h = await harness(t);
  await h.request("/auth/login", "POST", { role: "door", demo: true });
  assert.equal((await h.request("/team/catalog")).status, 401);
  await h.request("/auth/login", "POST", { role: "admin", demo: true });
  assert.equal((await h.request("/team/catalog")).status, 200);
  assert.equal((await h.link()).status, 201);
  assert.equal(
    (
      await h.request(
        "/team/links",
        "POST",
        {},
        { origin: "https://evil.test" },
      )
    ).status,
    403,
  );
});

test("group members receive editor access, manual restrictions and owner rights are preserved", async (t) => {
  const groupMembers = new Set(["21001", "21002"]);
  let unavailable = false;
  const group = createGroupAccess("-9988", {
    async isGroupMember(_chat, id) {
      if (unavailable) throw Error("offline");
      return groupMembers.has(id);
    },
  });
  const h = await harness(t, { teamGroupAccess: group });
  const staff = { id: 21001, first_name: "Участник" };
  const editor = await h.login(staff);
  assert.equal(editor.status, 200);
  assert.equal(editor.body.member.role, "editor");
  assert.equal(editor.body.member.access_group_id, "-9988");
  assert.equal(editor.body.member.group_access_enabled, true);
  assert.equal((await h.request("/team/stats")).status, 200);
  assert.equal((await h.link()).status, 201);
  assert.equal((await h.request("/team/members")).status, 403);
  assert.equal((await h.request("/admin/overview")).status, 401);
  const outsider = await h.login({ id: 21003, first_name: "Посторонний" });
  assert.equal(outsider.status, 403);
  assert.equal(outsider.body.token, undefined);
  groupMembers.add("21003");
  assert.equal(
    (await h.login({ id: 21003, first_name: "Теперь участник" })).status,
    200,
  );
  const owner = await h.login();
  assert.equal(owner.body.member.role, "owner");
  await h.request("/team/members/21001", "PATCH", {
    role: "viewer",
    status: "active",
  });
  assert.equal((await h.login(staff)).body.member.role, "viewer");
  assert.equal((await h.link({ slug: "forbidden" })).status, 403);
  h.setBearer(owner.body.token);
  await h.request("/team/members/21001", "PATCH", {
    role: "viewer",
    status: "blocked",
  });
  assert.equal((await h.login(staff)).status, 403);
  h.setBearer(editor.body.token);
  assert.equal((await h.request("/team/stats")).status, 401);
  unavailable = true;
  assert.equal((await h.login()).body.member.role, "owner");
});

test("leaving the group and Telegram errors close group sessions after a bounded cache", async (t) => {
  let at = 0,
    present = true,
    offline = false,
    calls = 0;
  const group = createGroupAccess(
    "-9988",
    {
      async isGroupMember() {
        calls++;
        if (offline) throw Error("offline");
        return present;
      },
    },
    () => at,
  );
  const h = await harness(t, { teamGroupAccess: group });
  const staff = { id: 22001, first_name: "Участник" };
  const session = await h.login(staff);
  assert.equal(session.status, 200);
  assert.equal((await h.request("/team/stats")).status, 200);
  assert.equal(calls, 1);
  present = false;
  at = 60001;
  assert.equal((await h.request("/team/stats")).status, 403);
  assert.equal((await h.login(staff)).status, 403);
  h.setBearer(session.body.token);
  assert.equal((await h.request("/team/stats")).status, 401);
  present = true;
  assert.equal((await h.login(staff)).status, 200);
  offline = true;
  at += 60001;
  assert.equal((await h.request("/team/stats")).status, 503);
  assert.equal((await h.login(staff)).status, 503);
  offline = false;
  assert.equal((await h.login(staff)).status, 200);
  // A changed/disabled group must not keep an existing group grant alive.
  group.chatId = "-7766";
  assert.equal((await h.request("/team/stats")).status, 403);
});

test("manual approvals stay independent of group verification; successful colleagues do not exhaust login quota", async (t) => {
  let present = false;
  const group = createGroupAccess("-9988", {
    async isGroupMember() {
      return present;
    },
  });
  const h = await harness(t, { teamGroupAccess: group });
  const staff = { id: 23001, first_name: "Ручной доступ" };
  assert.equal((await h.login(staff)).status, 403);
  await h.login();
  await h.request("/team/members/23001", "PATCH", {
    role: "viewer",
    status: "active",
  });
  const manual = await h.login(staff);
  assert.equal(manual.status, 200);
  assert.equal(manual.body.member.access_group_id, null);
  present = true;
  for (let id = 24001; id <= 24019; id++)
    assert.equal((await h.login({ id, first_name: "Коллега" })).status, 200);
});
