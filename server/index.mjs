import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { resolve, dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import QRCode from "qrcode";
import { openStore, seed, token, AppError } from "./store.mjs";
import {
  providerConfig,
  createPayment,
  readStatus,
  checkMerchant,
} from "./qrm.mjs";
import { channelReady, processOutbox } from "./delivery.mjs";
import { checkSmsAero } from "./smsaero.mjs";
import { telegram } from "./telegram.mjs";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const same = (a, b) =>
  timingSafeEqual(Buffer.from(hash(String(a))), Buffer.from(hash(String(b))));
const now = () => new Date().toISOString();
const customerSchema = z.object({
  first_name: z.string().trim().min(2).max(60),
  last_name: z.string().trim().min(2).max(60),
  phone: z
    .string()
    .transform((s) => s.replace(/[^\d+]/g, ""))
    .refine((s) => /^\+?[1-9]\d{9,14}$/.test(s), "Проверьте номер телефона"),
  email: z.email().max(160),
  quantity: z.number().int().min(1).max(10),
  event_id: z.string().min(1).max(80),
});
const eventSchema = z.object({
  title: z.string().trim().min(3).max(100),
  subtitle: z.string().trim().min(3).max(120),
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  venue: z.string().trim().min(2).max(100),
  address: z.string().trim().min(2).max(200),
  price: z.number().int().min(100).max(100000000),
  capacity: z.number().int().min(1).max(100000),
  description: z.string().trim().max(3000),
  dresscode: z.string().max(200),
  age: z.number().int().min(0).max(21),
  published: z.boolean(),
  sales_open: z.boolean(),
  hero_image: z
    .string()
    .regex(
      /^\/(?:assets\/red-moon\.png|media\/[a-f0-9]{48}\.(?:png|jpg|webp))$/,
    )
    .default("/assets/red-moon.png"),
});

export async function createApp({
  dbPath = process.env.DB_PATH || "./data/events.sqlite",
  databaseUrl = process.env.DATABASE_URL,
  demo = process.env.DEMO_MODE === "true",
  origin = process.env.APP_ORIGIN || "http://localhost:5173",
  testing = false,
  mediaDir = resolve(dirname(dbPath), "media"),
} = {}) {
  const production = process.env.NODE_ENV === "production";
  if (
    production &&
    (demo ||
      !process.env.ADMIN_PASSWORD ||
      process.env.ADMIN_PASSWORD.length < 16 ||
      !process.env.SCANNER_PASSWORD ||
      process.env.SCANNER_PASSWORD.length < 16 ||
      process.env.ADMIN_PASSWORD === process.env.SCANNER_PASSWORD ||
      !origin.startsWith("https://"))
  )
    throw new Error(
      "Production requires HTTPS, distinct strong staff passwords and DEMO_MODE=false",
    );
  if (process.env.REQUIRE_POSTGRES === "true" && !databaseUrl)
    throw new Error("DATABASE_URL is required on ephemeral hosting");
  const store = await openStore(dbPath, databaseUrl);
  await store.transaction(() => seed(store));
  // A rolling deploy may overlap a healthy instance. Recover only expired leases.
  const recover = async () => {
    await store.run(
      "UPDATE orders SET status='unknown',diagnostic='Создание прервано. Проверьте QRM' WHERE status='creating' AND created_at<?",
      new Date(Date.now() - 120000).toISOString(),
    );
    await store.run(
      "UPDATE outbox SET status='retry',error='Обновление сообщения прервано; повторяем редактирование' WHERE status='sending' AND channel='telegram' AND provider_id IS NOT NULL AND attempts<9 AND next_at<?",
      Date.now(),
    );
    await store.run(
      "UPDATE outbox SET status='unknown',error='Отправка прервана. Проверьте сервис' WHERE status='sending' AND next_at<?",
      Date.now(),
    );
  };
  await recover();
  const app = express();
  app.disable("x-powered-by");
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 3)
    throw new Error("TRUST_PROXY_HOPS must be 0..3");
  if (proxyHops) app.set("trust proxy", proxyHops);
  app.use(
    helmet({
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:"],
              connectSrc: ["'self'"],
              fontSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
            },
          }
        : false,
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  const normalJson = express.json({ limit: "24kb" });
  app.use((req, res, next) =>
    req.path === "/api/admin/media" ? next() : normalJson(req, res, next),
  );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 160,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Слишком много запросов. Подождите минуту." },
    }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 15,
    message: { error: "Слишком много попыток входа. Подождите 15 минут." },
  });
  const orderLimit = rateLimit({
    windowMs: 60000,
    limit: 8,
    message: { error: "Подождите минуту перед новым заказом." },
  });
  const cookies = (req) =>
    Object.fromEntries(
      (req.headers.cookie || "")
        .split(";")
        .map((v) => v.trim().split("="))
        .filter((v) => v.length === 2),
    );
  const setCookie = (res, name, value, maxAge) =>
    res.cookie(name, value, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      maxAge,
      path: "/",
    });
  app.use("/api", async (req, res, next) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      !req.path.startsWith("/webhooks/")
    ) {
      const allowed = [
        origin,
        ...(!production
          ? ["http://127.0.0.1:5173", "http://localhost:5173"]
          : []),
      ];
      if (!allowed.includes(req.headers.origin))
        return next(new AppError(403, "Недопустимый источник запроса"));
    }
    const session = cookies(req).staff;
    req.staff = session
      ? await store.get(
          "SELECT role,id FROM sessions WHERE id=? AND expires_at>?",
          hash(session),
          Date.now(),
        )
      : null;
    next();
  });
  const staff = (req, _res, next) =>
    req.staff ? next() : next(new AppError(401, "Войдите в систему"));
  const admin = (req, _res, next) =>
    req.staff?.role === "admin"
      ? next()
      : next(new AppError(403, "Нужен доступ администратора"));
  const mode = () => (demo ? "demo" : process.env.QRM_MODE || "disabled");
  app.get("/api/health", async (_req, res) => {
    await store.get("SELECT 1 AS ready");
    res.json({ ok: true });
  });
  const availability = () => {
    if (demo) return true;
    try {
      providerConfig(mode());
      return origin.startsWith("https://");
    } catch {
      return false;
    }
  };
  app.get("/api/config", (req, res) => {
    if (!/^[a-f0-9]{48}$/.test(cookies(req).buyer || ""))
      setCookie(res, "buyer", token(), 30 * 86400000);
    res.json({ demo, paymentMode: mode(), paymentReady: availability() });
  });
  app.get("/api/events", async (_req, res) =>
    res.json(
      await Promise.all(
        (
          await store.all(
            "SELECT id FROM events WHERE published=1 ORDER BY date,time",
          )
        ).map((e) => store.event(e.id)),
      ),
    ),
  );
  app.get("/api/auth", (_req, res) =>
    res.json({ role: _req.staff?.role || null, demo }),
  );
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const role = req.body.role === "door" ? "door" : "admin";
    const expected =
      role === "admin"
        ? process.env.ADMIN_PASSWORD
        : process.env.SCANNER_PASSWORD;
    if (
      !(demo && req.body.demo === true) &&
      (!expected || !same(req.body.password || "", expected))
    )
      throw new AppError(401, "Неверный пароль");
    const value = token();
    await store.run(
      "INSERT INTO sessions VALUES (?,?,?)",
      hash(value),
      role,
      Date.now() + 12 * 3600000,
    );
    setCookie(res, "staff", value, 12 * 3600000);
    res.json({ role });
  });
  app.post("/api/auth/logout", async (req, res) => {
    if (req.staff)
      await store.run("DELETE FROM sessions WHERE id=?", req.staff.id);
    res.clearCookie("staff", { path: "/" });
    res.json({ ok: true });
  });

  const publicOrder = async (o) => {
    const e = await store.event(o.event_id);
    const tickets = await store.all(
      "SELECT code,ordinal,used_at FROM tickets WHERE order_id=? ORDER BY ordinal",
      o.id,
    );
    return {
      id: o.id,
      access_token: o.access_token,
      event: e,
      first_name: o.first_name,
      last_name: o.last_name,
      quantity: o.quantity,
      unit_price: o.unit_price,
      total: o.total,
      status: o.status,
      method: o.method,
      mode: o.mode,
      created_at: o.created_at,
      expires_at: o.expires_at,
      payment_url: o.payment_url,
      qr_image: o.qr_url
        ? await QRCode.toDataURL(o.qr_url, { width: 320, margin: 3 })
        : null,
      tickets: await Promise.all(
        tickets.map(async (t) => ({
          ...t,
          qr_image: await QRCode.toDataURL(`${origin}/ticket/${t.code}`, {
            width: 320,
            margin: 3,
          }),
        })),
      ),
      delivery: await store.all(
        "SELECT channel,status FROM outbox WHERE order_id=? AND kind='tickets'",
        o.id,
      ),
    };
  };
  app.post("/api/orders", orderLimit, async (req, res) => {
    const input = customerSchema.parse(req.body);
    if (req.body.consent !== true)
      throw new AppError(400, "Необходимо согласие на обработку данных");
    if (!availability())
      throw new AppError(
        503,
        "Оплата пока не подключена. Пожалуйста, вернитесь позже.",
      );
    const buyer = cookies(req).buyer;
    if (!buyer || !/^[a-f0-9]{48}$/.test(buyer))
      throw new AppError(400, "Обновите страницу перед покупкой");
    const key = z.uuid().parse(req.headers["idempotency-key"]);
    const requestHash = hash(JSON.stringify(input));
    let fresh = false;
    const o = await store.transaction(async () => {
      const existing = await store.get(
        "SELECT * FROM orders WHERE buyer_session=? AND idempotency=?",
        hash(buyer),
        key,
      );
      if (existing) {
        if (existing.request_hash !== requestHash)
          throw new AppError(
            409,
            "Этот запрос уже использован для другого заказа",
          );
        return existing;
      }
      const e = await store.event(input.event_id);
      if (
        !e ||
        !e.published ||
        !e.sales_open ||
        new Date(`${e.date}T${e.time}:00+03:00`) <= new Date()
      )
        throw new AppError(409, "Продажа билетов закрыта");
      if (e.available < input.quantity)
        throw new AppError(409, "Недостаточно свободных билетов");
      const id = randomUUID();
      const values = {
        id,
        access_token: token(),
        ...input,
        unit_price: e.price,
        total: e.price * input.quantity,
        status: demo ? "pending" : "creating",
        method: "sbp",
        mode: mode(),
        created_at: now(),
        expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
        buyer_session: hash(buyer),
        idempotency: key,
        request_hash: requestHash,
        webhook_token: token(),
      };
      const keys = Object.keys(values);
      await store.run(
        `INSERT INTO orders (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        ...Object.values(values),
      );
      await store.enqueue(id, "created");
      fresh = true;
      return await store.get("SELECT * FROM orders WHERE id=?", id);
    });
    if (fresh && !demo) {
      try {
        const payment = await createPayment(
          o,
          await store.event(o.event_id),
          origin,
        );
        await store.run(
          "UPDATE orders SET status='pending',operation_id=?,payment_url=?,qr_url=?,merchant_id=? WHERE id=? AND status='creating'",
          payment.operationId,
          payment.paymentUrl,
          payment.qrUrl,
          payment.merchantId,
          o.id,
        );
      } catch (e) {
        await store.run(
          "UPDATE orders SET status=?,diagnostic=? WHERE id=? AND status='creating'",
          e.outcome === "failed" ? "failed" : "unknown",
          e.outcome ? e.message : "Ответ QRM не прошёл проверку",
          o.id,
        );
      }
    }
    res
      .status(fresh ? 201 : 200)
      .json(
        await publicOrder(
          await store.get("SELECT * FROM orders WHERE id=?", o.id),
        ),
      );
  });
  app.get("/api/orders/:token", async (req, res) => {
    const o = await store.get(
      "SELECT * FROM orders WHERE access_token=?",
      req.params.token,
    );
    if (!o) throw new AppError(404, "Заказ не найден");
    res.json(await publicOrder(o));
  });
  app.post("/api/orders/:token/demo-pay", async (req, res) => {
    if (!demo) throw new AppError(404, "Не найдено");
    const o = await store.get(
      "SELECT * FROM orders WHERE access_token=? AND mode='demo'",
      req.params.token,
    );
    if (!o) throw new AppError(404, "Заказ не найден");
    if (!["pending", "paid"].includes(o.status))
      throw new AppError(409, "Заказ закрыт");
    await store.markPaid(o.id);
    res.json({ ok: true });
  });
  app.get("/api/tickets/:code", async (req, res) => {
    const t = await store.get(
      `SELECT t.code,t.ordinal,t.used_at,o.first_name,o.last_name,o.status,o.mode,o.method,o.event_id FROM tickets t JOIN orders o ON o.id=t.order_id WHERE code=?`,
      req.params.code,
    );
    if (!t) throw new AppError(404, "Билет не найден");
    res.json({
      ...t,
      event: await store.event(t.event_id),
      qr_image: await QRCode.toDataURL(`${origin}/ticket/${t.code}`, {
        width: 320,
        margin: 3,
      }),
    });
  });
  const checking = new Set();
  const reconcile = async (id) => {
    if (checking.has(id)) return;
    const o = await store.get("SELECT * FROM orders WHERE id=?", id);
    if (
      !o ||
      !o.operation_id ||
      !["sandbox", "live"].includes(o.mode) ||
      ["paid", "paid_review"].includes(o.status)
    )
      return;
    checking.add(id);
    try {
      const status = await readStatus(o.operation_id, o.mode);
      if (status.operation_sum !== o.total) throw new Error("amount_mismatch");
      if (status.operation_status_code === 5) await store.markPaid(id);
      else if ([6, 8].includes(status.operation_status_code))
        await store.run(
          "UPDATE orders SET status=? WHERE id=? AND status NOT IN ('paid','paid_review')",
          status.operation_status_code === 6 ? "cancelled" : "expired",
          id,
        );
      else if (![0, 3, 4].includes(status.operation_status_code))
        throw new Error("unknown_status");
      await store.run(
        "UPDATE orders SET checked_at=?,check_attempts=check_attempts+1,diagnostic=CASE WHEN status='paid_review' THEN diagnostic ELSE NULL END WHERE id=?",
        now(),
        id,
      );
    } catch (e) {
      await store.run(
        "UPDATE orders SET checked_at=?,check_attempts=check_attempts+1,diagnostic=? WHERE id=?",
        now(),
        e.message === "amount_mismatch"
          ? "Сумма QRM не совпала с заказом"
          : "Не удалось подтвердить статус QRM",
        id,
      );
    } finally {
      checking.delete(id);
    }
  };
  app.post("/api/webhooks/qrm/:id/:secret", async (req, res) => {
    const o = await store.get("SELECT * FROM orders WHERE id=?", req.params.id);
    if (!o || !same(o.webhook_token, req.params.secret))
      throw new AppError(403, "Недопустимый callback");
    // Callback body is untrusted. The secret correlates a saved order; only GET verifies payment.
    await reconcile(o.id);
    res.json({ ok: true });
  });
  app.get("/api/admin/overview", staff, async (req, res) => {
    const events = await Promise.all(
      (await store.all("SELECT id FROM events ORDER BY date")).map((e) =>
        store.event(e.id),
      ),
    );
    if (req.staff.role === "door") return res.json({ events });
    const orders = await store.all(
      "SELECT o.id,o.event_id,o.first_name,o.last_name,o.phone,o.email,o.quantity,o.total,o.status,o.method,o.mode,o.created_at,o.paid_at,o.checked_at,o.diagnostic,o.access_token,e.title,(SELECT COUNT(*) FROM tickets t WHERE t.order_id=o.id AND t.used_at IS NOT NULL) AS checked_count FROM orders o JOIN events e ON e.id=o.event_id ORDER BY o.created_at DESC LIMIT 500",
    );
    const attendance = await store.get(
      "SELECT COUNT(*) AS sold,COALESCE(SUM(CASE WHEN t.used_at IS NOT NULL THEN 1 ELSE 0 END),0) AS checked FROM tickets t JOIN orders o ON o.id=t.order_id WHERE o.status='paid' AND (?=1 OR o.mode='live')",
      demo ? 1 : 0,
    );
    res.json({
      events,
      orders,
      stats: {
        sold: attendance.sold,
        checked: attendance.checked,
        revenue: (
          await store.get(
            "SELECT COALESCE(SUM(total),0) n FROM orders WHERE status='paid' AND method!='invite' AND (?=1 OR mode='live')",
            demo ? 1 : 0,
          )
        ).n,
      },
      integrations: {
        qrm: availability() && !demo,
        mode: mode(),
        telegram: channelReady("telegram"),
        email: channelReady("email"),
        sms: channelReady("sms"),
      },
      deliveries: await store.all(
        "SELECT id,order_id,channel,kind,status,attempts,sent_at,error,provider_id,provider_status FROM outbox ORDER BY rowid DESC LIMIT 100",
      ),
    });
  });
  app.post(
    "/api/admin/media",
    staff,
    admin,
    express.json({ limit: "6mb" }),
    async (req, res) => {
      const value = z.string().max(5600000).parse(req.body.data);
      const match =
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
      if (!match) throw new AppError(400, "Поддерживаются PNG, JPEG и WebP");
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > 4 * 1024 * 1024)
        throw new AppError(413, "Изображение должно быть меньше 4 МБ");
      const valid =
        match[1] === "png"
          ? buffer
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : match[1] === "jpeg"
            ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
            : buffer.subarray(0, 4).toString() === "RIFF" &&
              buffer.subarray(8, 12).toString() === "WEBP";
      if (!valid)
        throw new AppError(400, "Файл не соответствует формату изображения");
      const filename = token() + "." + (match[1] === "jpeg" ? "jpg" : match[1]);
      if (store.db.kind === "postgres") {
        await store.run(
          "INSERT INTO media(filename,mime,content,created_at) VALUES (?,?,?,?)",
          filename,
          `image/${match[1]}`,
          buffer,
          now(),
        );
      } else {
        await mkdir(mediaDir, { recursive: true });
        await writeFile(resolve(mediaDir, filename), buffer, {
          flag: "wx",
          mode: 0o644,
        });
      }
      await store.audit("image_upload", filename, req.staff.role);
      res.status(201).json({ url: "/media/" + filename });
    },
  );
  app.post("/api/admin/events", staff, admin, async (req, res) => {
    const data = eventSchema.parse(req.body);
    const id = randomUUID();
    const values = {
      id,
      ...data,
      published: Number(data.published),
      sales_open: Number(data.sales_open),
      created_at: now(),
    };
    const keys = Object.keys(values);
    await store.run(
      `INSERT INTO events (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ...Object.values(values),
    );
    await store.audit("event_create", id, req.staff.role);
    res.status(201).json(await store.event(id));
  });
  app.put("/api/admin/events/:id", staff, admin, async (req, res) => {
    const data = eventSchema.parse(req.body);
    const updated = await store.transaction(async () => {
      const e = await store.event(req.params.id);
      if (!e) throw new AppError(404, "Мероприятие не найдено");
      if (data.capacity < (await store.reserved(e.id)))
        throw new AppError(
          409,
          "Лимит меньше количества проданных и зарезервированных билетов",
        );
      const values = {
        ...data,
        published: Number(data.published),
        sales_open: Number(data.sales_open),
      };
      await store.run(
        `UPDATE events SET ${Object.keys(values)
          .map((k) => `${k}=?`)
          .join(",")} WHERE id=?`,
        ...Object.values(values),
        e.id,
      );
      await store.audit("event_update", e.id, req.staff.role);
      return store.event(e.id);
    });
    res.json(updated);
  });
  app.post("/api/admin/issue", staff, admin, async (req, res) => {
    const input = customerSchema.parse(req.body);
    const method = z.enum(["invite", "cash"]).parse(req.body.method);
    if (method === "cash" && req.body.cash_received !== true)
      throw new AppError(400, "Подтвердите получение наличных");
    const idempotency = z.uuid().parse(req.headers["idempotency-key"]);
    const id = await store.transaction(async () => {
      const previous = await store.get(
        "SELECT id,request_hash FROM orders WHERE buyer_session=? AND idempotency=?",
        "staff:" + req.staff.id,
        idempotency,
      );
      const requestHash = hash(JSON.stringify({ ...input, method }));
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new AppError(409, "Запрос уже использован");
        return previous.id;
      }
      const e = await store.event(input.event_id);
      if (!e) throw new AppError(404, "Мероприятие не найдено");
      if (e.available < input.quantity)
        throw new AppError(409, "Недостаточно мест");
      const id = randomUUID();
      const values = {
        id,
        access_token: token(),
        ...input,
        unit_price: method === "invite" ? 0 : e.price,
        total: method === "invite" ? 0 : e.price * input.quantity,
        status: "pending",
        method,
        mode: demo ? "demo" : "live",
        created_at: now(),
        expires_at: now(),
        buyer_session: "staff:" + req.staff.id,
        idempotency,
        request_hash: requestHash,
        webhook_token: token(),
      };
      await store.run(
        `INSERT INTO orders (${Object.keys(values).join(",")}) VALUES (${Object.keys(
          values,
        )
          .map(() => "?")
          .join(",")})`,
        ...Object.values(values),
      );
      return id;
    });
    await store.markPaid(id);
    await store.audit("issue_" + method, id, req.staff.role);
    res.status(201).json({
      url: `/order/${(await store.get("SELECT access_token FROM orders WHERE id=?", id)).access_token}`,
    });
  });
  app.post("/api/admin/orders/:id/recheck", staff, admin, async (req, res) => {
    await reconcile(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/admin/qrm/check", staff, admin, async (_req, res) => {
    const m = await checkMerchant(mode());
    res.json({
      firm_name: m.firm_name,
      ready: true,
      requires_receipt: m.requires_receipt,
    });
  });
  app.post("/api/admin/smsaero/check", staff, admin, async (_req, res) => {
    res.json(await checkSmsAero());
  });
  app.post("/api/admin/telegram/check", staff, admin, async (_req, res) => {
    res.json(await telegram.check());
  });
  app.post(
    "/api/admin/deliveries/:id/retry",
    staff,
    admin,
    async (req, res) => {
      const j = await store.get(
        "SELECT * FROM outbox WHERE id=?",
        req.params.id,
      );
      if (!j) throw new AppError(404, "Отправка не найдена");
      if (["sent", "sending", "submitted", "delivered"].includes(j.status))
        throw new AppError(409, "Сообщение уже отправлено или отправляется");
      if (j.channel === "sms" && j.provider_id && j.status === "unknown") {
        // An accepted SMS is only rechecked, never resent because status lookup failed.
        await store.run(
          "UPDATE outbox SET status='submitted',status_attempts=0,next_at=0 WHERE id=? AND status='unknown'",
          j.id,
        );
        await store.audit("delivery_recheck", j.id, req.staff.role);
        return res.json({ ok: true });
      }
      if (j.status === "unknown" && req.body.confirm !== true)
        throw new AppError(
          409,
          "Сначала проверьте отправку в сервисе и подтвердите повтор",
        );
      await store.run(
        "UPDATE outbox SET status='pending',next_at=0,provider_id=NULL,provider_status=NULL,status_attempts=0 WHERE id=? AND status=?",
        j.id,
        j.status,
      );
      await store.audit("delivery_retry", j.id, req.staff.role);
      res.json({ ok: true });
    },
  );
  app.get("/api/checkin/summary", staff, async (req, res) => {
    const eventId = z.string().max(100).parse(req.query.event_id);
    if (!(await store.event(eventId)))
      throw new AppError(404, "Мероприятие не найдено");
    res.json({ ...(await store.attendance(eventId, demo)), updated_at: now() });
  });
  app.post("/api/checkin", staff, async (req, res) => {
    const eventId = z.string().parse(req.body.event_id);
    let code = z.string().max(500).parse(req.body.code).trim();
    if (code.includes("/ticket/"))
      code = code.split("/ticket/").pop().split(/[?#]/)[0];
    if (!/^[a-f0-9]{48}$/.test(code))
      throw new AppError(400, "Неверный QR билета");
    const t = await store.checkin(code, eventId, req.staff.role, demo);
    res.json({
      accepted: t.accepted,
      name: `${t.first_name} ${t.last_name}`,
      ordinal: t.ordinal,
      used_at: t.used_at,
      method: t.method,
      mode: t.mode,
      group: t.group,
    });
  });
  app.use("/api", (_req, _res, next) => next(new AppError(404, "Не найдено")));
  if (store.db.kind === "postgres")
    app.get("/media/:filename", async (req, res) => {
      if (!/^[a-f0-9]{48}\.(png|jpg|webp)$/.test(req.params.filename))
        throw new AppError(404, "Не найдено");
      const media = await store.get(
        "SELECT mime,content FROM media WHERE filename=?",
        req.params.filename,
      );
      if (!media) throw new AppError(404, "Не найдено");
      res
        .set("Cache-Control", "public, max-age=31536000, immutable")
        .type(media.mime)
        .send(media.content);
    });
  app.use(
    "/media",
    express.static(mediaDir, {
      immutable: true,
      maxAge: "1y",
      dotfiles: "deny",
    }),
  );
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
  app.use((err, _req, res, _next) => {
    const status = err instanceof z.ZodError ? 400 : err.status || 500;
    if (status >= 500) console.error("Request failed", err.code || err.name);
    res.status(status).json({
      error:
        err instanceof z.ZodError
          ? "Проверьте заполнение полей"
          : status < 500
            ? err.message
            : "Не удалось выполнить запрос. Попробуйте позже.",
    });
  });
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await recover();
      await store.run(
        "UPDATE orders SET status='expired' WHERE mode='demo' AND status='pending' AND expires_at<?",
        now(),
      );
      const candidates = await store.all(
        "SELECT id FROM orders WHERE operation_id IS NOT NULL AND status IN ('pending','unknown','expired','cancelled') AND check_attempts<150 AND (checked_at IS NULL OR checked_at<?) ORDER BY checked_at LIMIT 4",
        new Date(Date.now() - 30000).toISOString(),
      );
      await Promise.allSettled(candidates.map((o) => reconcile(o.id)));
      await processOutbox(store, origin, demo);
      await store.run("DELETE FROM sessions WHERE expires_at<?", Date.now());
    } finally {
      busy = false;
    }
  };
  let activeTick = Promise.resolve();
  const timer = testing
    ? null
    : setInterval(() => {
        if (!busy)
          activeTick = tick().catch(() =>
            console.error("Background processing failed"),
          );
      }, 15000);
  return {
    app,
    store,
    tick,
    close: async () => {
      if (timer) clearInterval(timer);
      await activeTick;
      await store.db.close();
    },
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const { app, close } = await createApp();
  const port = Number(process.env.PORT || 8787);
  const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
  const server = app.listen(port, host, () =>
    console.log(`Chaika Events API http://${host}:${port}`),
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 25000).unref();
    server.close(async () => {
      try {
        await close();
        clearTimeout(deadline);
      } catch {
        console.error("Shutdown failed");
        process.exitCode = 1;
      }
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
