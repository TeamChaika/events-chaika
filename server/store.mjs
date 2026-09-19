import { openDatabase } from "./database.mjs";
import { randomBytes, randomUUID } from "node:crypto";

export const token = () => randomBytes(24).toString("hex");
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export async function openStore(path = "./data/events.sqlite", databaseUrl) {
  const db = await openDatabase(path, databaseUrl);
  const schema = `
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
      venue TEXT NOT NULL, address TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>=0), capacity INTEGER NOT NULL,
      description TEXT NOT NULL, dresscode TEXT NOT NULL, age INTEGER NOT NULL DEFAULT 16,
      published INTEGER NOT NULL DEFAULT 1, sales_open INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, access_token TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL REFERENCES events(id),
      first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL,
      quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL, total INTEGER NOT NULL,
      status TEXT NOT NULL, method TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL,
      paid_at TEXT, expires_at TEXT NOT NULL, buyer_session TEXT NOT NULL, idempotency TEXT NOT NULL, request_hash TEXT NOT NULL,
      operation_id TEXT UNIQUE, payment_url TEXT, qr_url TEXT, webhook_token TEXT NOT NULL,
      merchant_id TEXT, checked_at TEXT, check_attempts INTEGER NOT NULL DEFAULT 0, diagnostic TEXT,
      UNIQUE(buyer_session,idempotency));
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL REFERENCES orders(id),
      ordinal INTEGER NOT NULL, used_at TEXT, used_by TEXT, UNIQUE(order_id,ordinal));
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, role TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), channel TEXT NOT NULL,
      kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL DEFAULT 0, sent_at TEXT, error TEXT, UNIQUE(order_id,channel,kind));
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, entity TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS orders_event ON orders(event_id,status);
    CREATE INDEX IF NOT EXISTS tickets_order ON tickets(order_id);`;
  try {
    await db.transaction(async () => {
      await db.exec(
        db.kind === "postgres"
          ? schema
              .replace("expires_at INTEGER", "expires_at BIGINT")
              .replace("next_at INTEGER", "next_at BIGINT")
              .replace(
                "CREATE TABLE IF NOT EXISTS outbox (",
                "CREATE TABLE IF NOT EXISTS outbox (sequence BIGSERIAL UNIQUE,",
              )
          : schema,
      );
      if (db.kind === "postgres") {
        await db.exec(
          "ALTER TABLE events ADD COLUMN IF NOT EXISTS hero_image TEXT NOT NULL DEFAULT '/assets/red-moon.png'",
        );
        await db.exec(
          "CREATE TABLE IF NOT EXISTS media (filename TEXT PRIMARY KEY, mime TEXT NOT NULL, content BYTEA NOT NULL, created_at TEXT NOT NULL)",
        );
        // The backend owns a private Supabase schema. Public API roles have no grants.
        const namespace = await db.get(
          "SELECT current_schema() AS name, current_user AS role",
        );
        if (namespace.name === "chaika_events") {
          const role = '"' + namespace.role.replaceAll('"', '""') + '"';
          for (const table of [
            "events",
            "orders",
            "tickets",
            "sessions",
            "outbox",
            "audit",
            "media",
          ]) {
            await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
              DROP POLICY IF EXISTS events_backend ON ${table};
              CREATE POLICY events_backend ON ${table} FOR ALL TO ${role} USING (true) WITH CHECK (true);`);
          }
        }
      } else if (
        !(await db.all("PRAGMA table_info(events)")).some(
          (column) => column.name === "hero_image",
        )
      ) {
        await db.exec(
          "ALTER TABLE events ADD COLUMN hero_image TEXT NOT NULL DEFAULT '/assets/red-moon.png'",
        );
      }
      const deliveryColumns = [
        ["provider_id", "TEXT"],
        ["provider_status", "INTEGER"],
        ["status_attempts", "INTEGER NOT NULL DEFAULT 0"],
      ];
      const existing =
        db.kind === "sqlite" ? await db.all("PRAGMA table_info(outbox)") : [];
      for (const [name, type] of deliveryColumns) {
        if (
          db.kind === "postgres" ||
          !existing.some((column) => column.name === name)
        )
          await db.exec(
            `ALTER TABLE outbox ADD COLUMN ${db.kind === "postgres" ? "IF NOT EXISTS " : ""}${name} ${type}`,
          );
      }
    });
  } catch (error) {
    await db.close();
    throw error;
  }
  const { get, all, run, transaction } = db;
  const audit = async (action, entity, actor = "system") =>
    await run(
      "INSERT INTO audit VALUES (?,?,?,?,?)",
      randomUUID(),
      action,
      entity,
      actor,
      new Date().toISOString(),
    );
  const reserved = async (id) =>
    (
      await get(
        "SELECT COALESCE(SUM(quantity),0) AS count FROM orders WHERE event_id=? AND status IN ('creating','pending','unknown','paid')",
        id,
      )
    ).count;
  const event = async (id) => {
    const e = await get("SELECT * FROM events WHERE id=?", id);
    return e
      ? { ...e, available: Math.max(0, e.capacity - (await reserved(id))) }
      : null;
  };
  const enqueue = async (id, kind) => {
    for (const ch of ["created", "review"].includes(kind)
      ? ["telegram"]
      : ["email", "sms", "telegram"])
      await run(
        "INSERT OR IGNORE INTO outbox(id,order_id,channel,kind) VALUES (?,?,?,?)",
        randomUUID(),
        id,
        ch,
        kind,
      );
  };
  const issue = async (id) => {
    const o = await get("SELECT * FROM orders WHERE id=?", id);
    if (!o || o.status !== "paid")
      throw new AppError(409, "Заказ ещё не оплачен");
    for (let i = 1; i <= o.quantity; i++)
      await run(
        "INSERT OR IGNORE INTO tickets(id,code,order_id,ordinal) VALUES (?,?,?,?)",
        randomUUID(),
        token(),
        id,
        i,
      );
    await enqueue(id, "tickets");
  };
  const markPaid = async (id) =>
    await transaction(async () => {
      const o = await get("SELECT * FROM orders WHERE id=?", id);
      if (!o) throw new AppError(404, "Заказ не найден");
      // A late confirmed payment needs operator reconciliation when its seats were released.
      if (
        ["expired", "cancelled", "failed"].includes(o.status) &&
        (await event(o.event_id)).available < o.quantity
      ) {
        await run(
          "UPDATE orders SET status='paid_review',paid_at=?,diagnostic='Оплата после освобождения мест: требуется проверка вместимости' WHERE id=?",
          new Date().toISOString(),
          id,
        );
        await enqueue(id, "review");
        return;
      }
      if (o.status === "paid_review") return;
      await run(
        "UPDATE orders SET status='paid',paid_at=COALESCE(paid_at,?),diagnostic=NULL WHERE id=?",
        new Date().toISOString(),
        id,
      );
      await issue(id);
    });
  const checkin = async (code, eventId, actor, allowTest = false) =>
    await transaction(async () => {
      const t = await get(
        `SELECT t.*,o.event_id,o.status,o.mode,o.first_name,o.last_name,o.method,e.title FROM tickets t JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=o.event_id WHERE t.code=?`,
        code,
      );
      if (!t) throw new AppError(404, "Билет не найден");
      if (!allowTest && t.mode !== "live")
        throw new AppError(409, "Тестовый билет не даёт права прохода");
      if (t.event_id !== eventId)
        throw new AppError(409, "Билет на другое мероприятие");
      if (t.status !== "paid") throw new AppError(409, "Билет недействителен");
      if (t.used_at) return { accepted: false, ...t };
      const now = new Date().toISOString();
      await run(
        "UPDATE tickets SET used_at=?,used_by=? WHERE id=? AND used_at IS NULL",
        now,
        actor,
        t.id,
      );
      await audit("checkin", t.id, actor);
      return { ...t, accepted: true, used_at: now };
    });
  return {
    db,
    get,
    all,
    run,
    transaction,
    audit,
    event,
    reserved,
    enqueue,
    markPaid,
    checkin,
  };
}

export async function seed(store) {
  if (await store.get("SELECT id FROM events LIMIT 1")) return;
  await store.run(
    "INSERT INTO events(id,title,subtitle,date,time,venue,address,price,capacity,description,dresscode,age,published,sales_open,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    "red-moon",
    "Ночь красной луны",
    "Костюмированный бал-вечеринка",
    "2026-10-31",
    "20:00",
    "Гастродвор",
    "наб. имени В.И. Ленина, 15, Ялта",
    500000,
    200,
    "Одна ночь, в которой можно стать кем угодно. Наденьте свой самый загадочный образ и станьте частью истории под красной луной.",
    "Black, red & a little mystery",
    16,
    1,
    1,
    new Date().toISOString(),
  );
}
