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
    CREATE TABLE IF NOT EXISTS checkin_batches (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), code TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity>0), expected_checked INTEGER NOT NULL,
      entered_at TEXT NOT NULL, ordinals TEXT NOT NULL);
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
            "checkin_batches",
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
  const attendance = async (eventId, allowTest = false) => {
    const counts = await get(
      "SELECT COUNT(*) AS issued,COALESCE(SUM(CASE WHEN t.used_at IS NOT NULL THEN 1 ELSE 0 END),0) AS checked FROM tickets t JOIN orders o ON o.id=t.order_id WHERE o.event_id=? AND o.status='paid' AND (?=1 OR o.mode='live')",
      eventId,
      allowTest ? 1 : 0,
    );
    return { ...counts, remaining: counts.issued - counts.checked };
  };
  const orderAttendance = async (orderId) => {
    const counts = await get(
      "SELECT COUNT(*) AS issued,COALESCE(SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END),0) AS checked FROM tickets WHERE order_id=?",
      orderId,
    );
    return { ...counts, remaining: counts.issued - counts.checked };
  };
  const searchTickets = async (eventId, query, allowTest = false) => {
    const normalized = query.trim().toLowerCase().replaceAll("ё", "е");
    const byPhone = /^[+\d\s()-]+$/.test(normalized);
    const lower = db.kind === "postgres" ? "LOWER" : "unicode_lower";
    const nameColumn = `REPLACE(${lower}(o.first_name || ' ' || o.last_name),'ё','е')`;
    let parts;
    if (byPhone) {
      let digits = normalized.replace(/\D/g, "");
      if (digits.length < 4)
        throw new AppError(400, "Введите не менее 4 цифр телефона");
      if (digits.length === 11 && /^[78]/.test(digits))
        digits = digits.slice(1);
      parts = [digits];
    } else {
      if ((normalized.match(/\p{L}/gu) || []).length < 2)
        throw new AppError(400, "Введите не менее 2 букв имени или фамилии");
      parts = normalized.split(/\s+/);
    }
    const column = byPhone ? "o.phone" : nameColumn;
    const patterns = parts.map(
      (part) => "%" + part.replace(/[!%_]/g, (c) => "!" + c) + "%",
    );
    const orders = await all(
      `SELECT o.id,o.first_name,o.last_name,o.phone,o.method,o.mode FROM orders o WHERE o.event_id=? AND o.status='paid' AND (?=1 OR o.mode='live') AND EXISTS (SELECT 1 FROM tickets t WHERE t.order_id=o.id) AND ${parts.map(() => `${column} LIKE ? ESCAPE '!'`).join(" AND ")} ORDER BY o.created_at DESC,o.id LIMIT 21`,
      eventId,
      allowTest ? 1 : 0,
      ...patterns,
    );
    const more = orders.length > 20;
    orders.splice(20);
    if (!orders.length) return { orders: [], more: false };
    const tickets = await all(
      `SELECT order_id,code,ordinal,used_at FROM tickets WHERE order_id IN (${orders.map(() => "?").join(",")}) ORDER BY ordinal`,
      ...orders.map((o) => o.id),
    );
    return {
      more,
      orders: orders.map((o) => {
        const groupTickets = tickets.filter((t) => t.order_id === o.id);
        const checked = groupTickets.filter((t) => t.used_at).length;
        return {
          ...o,
          group: {
            issued: groupTickets.length,
            checked,
            remaining: groupTickets.length - checked,
          },
          tickets: groupTickets.map(({ code, ordinal, used_at }) => ({
            code,
            ordinal,
            used_at,
          })),
        };
      }),
    };
  };
  const ticketForCheckin = async (code, eventId, allowTest) => {
    const t = await get(
      `SELECT t.*,o.event_id,o.status,o.mode,o.first_name,o.last_name,o.phone,o.method,e.title FROM tickets t JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=o.event_id WHERE t.code=?`,
      code,
    );
    if (!t) throw new AppError(404, "Билет не найден");
    if (!allowTest && t.mode !== "live")
      throw new AppError(409, "Тестовый билет не даёт права прохода");
    if (t.event_id !== eventId)
      throw new AppError(409, "Билет на другое мероприятие");
    if (t.status !== "paid") throw new AppError(409, "Билет недействителен");
    return t;
  };
  const previewCheckin = async (code, eventId, allowTest = false) =>
    transaction(async () => {
      const t = await ticketForCheckin(code, eventId, allowTest);
      return { ...t, group: await orderAttendance(t.order_id) };
    });
  const checkinGroup = async (
    code,
    eventId,
    quantity,
    expectedChecked,
    requestId,
    actor,
    allowTest = false,
  ) =>
    transaction(async () => {
      const t = await ticketForCheckin(code, eventId, allowTest);
      const previous = await get(
        "SELECT * FROM checkin_batches WHERE id=?",
        requestId,
      );
      if (previous) {
        if (
          previous.order_id !== t.order_id ||
          previous.code !== code ||
          previous.quantity !== quantity ||
          previous.expected_checked !== expectedChecked
        )
          throw new AppError(
            409,
            "Этот запрос уже использован для другого прохода",
          );
        return {
          ...t,
          accepted: true,
          admitted: previous.quantity,
          ordinals: JSON.parse(previous.ordinals),
          used_at: previous.entered_at,
          replayed: true,
          group: await orderAttendance(t.order_id),
        };
      }
      const group = await orderAttendance(t.order_id);
      if (group.checked !== expectedChecked)
        throw new AppError(
          409,
          "Количество вошедших изменилось. Обновите данные заказа перед подтверждением.",
        );
      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > group.remaining
      )
        throw new AppError(
          409,
          `Можно пропустить не более ${group.remaining} гостей`,
        );
      const available = await all(
        "SELECT id,ordinal FROM tickets WHERE order_id=? AND used_at IS NULL ORDER BY CASE WHEN code=? THEN 0 ELSE 1 END,ordinal LIMIT ?",
        t.order_id,
        code,
        quantity,
      );
      const enteredAt = new Date().toISOString();
      for (const ticket of available) {
        await run(
          "UPDATE tickets SET used_at=?,used_by=? WHERE id=? AND used_at IS NULL",
          enteredAt,
          actor,
          ticket.id,
        );
        await audit("checkin", ticket.id, actor);
      }
      const ordinals = available.map((ticket) => ticket.ordinal);
      await run(
        "INSERT INTO checkin_batches(id,order_id,code,quantity,expected_checked,entered_at,ordinals) VALUES (?,?,?,?,?,?,?)",
        requestId,
        t.order_id,
        code,
        quantity,
        expectedChecked,
        enteredAt,
        JSON.stringify(ordinals),
      );
      return {
        ...t,
        accepted: true,
        admitted: quantity,
        ordinals,
        used_at: enteredAt,
        replayed: false,
        group: await orderAttendance(t.order_id),
      };
    });
  const checkin = async (code, eventId, actor, allowTest = false) =>
    await transaction(async () => {
      const t = await ticketForCheckin(code, eventId, allowTest);
      if (t.used_at)
        return {
          accepted: false,
          ...t,
          group: await orderAttendance(t.order_id),
        };
      const now = new Date().toISOString();
      await run(
        "UPDATE tickets SET used_at=?,used_by=? WHERE id=? AND used_at IS NULL",
        now,
        actor,
        t.id,
      );
      await audit("checkin", t.id, actor);
      return {
        ...t,
        accepted: true,
        used_at: now,
        group: await orderAttendance(t.order_id),
      };
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
    attendance,
    searchTickets,
    previewCheckin,
    checkinGroup,
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
    21,
    1,
    1,
    new Date().toISOString(),
  );
}
