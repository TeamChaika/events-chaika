import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createApp } from "../server/index.mjs";
import { currentLegalDocuments } from "../server/legal.mjs";
import {
  verifyTelegramData,
  ATTRIBUTION_CONSENT_VERSION,
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
async function harness(t) {
  process.env.TELEGRAM_BOT_TOKEN = botToken;
  process.env.TELEGRAM_MINIAPP_OWNER_ID = "10001";
  const h = await createApp({
    dbPath: ":memory:",
    databaseUrl: undefined,
    origin: "http://localhost:5173",
    demo: true,
    testing: true,
    legalDocuments: currentLegalDocuments.map((doc) => ({
      ...doc,
      version: "test.1",
      content: `Fixture ${doc.slug}`,
    })),
  });
  await h.store.run("UPDATE events SET date='2099-10-31'");
  const server = h.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await h.close();
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
  const order = (source, key = randomUUID(), event_id = "red-moon") =>
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
