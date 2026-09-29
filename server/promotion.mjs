import {
  createHmac,
  createHash,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import { AppError, token } from "./store.mjs";
import { telegram } from "./telegram.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
export const ATTRIBUTION_CONSENT_VERSION = "2026-09-29.1";
const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const label = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[^\r\n\x00-\x1f]+$/);
const reserved = new Set([
  "api",
  "team",
  "admin",
  "checkin",
  "ticket",
  "order",
  "legal",
  "unsubscribe",
  "assets",
  "media",
]);

export function isPromotionPath(path) {
  const parts = path.split("/");
  return (
    parts.length === 3 &&
    !reserved.has(parts[1]) &&
    slug.safeParse(parts[1]).success &&
    slug.safeParse(parts[2]).success
  );
}

export function verifyTelegramData(raw, botToken, now = Date.now()) {
  const invalid = () =>
    new AppError(401, "Откройте панель заново через Telegram");
  if (typeof raw !== "string" || raw.length > 8192 || !botToken)
    throw invalid();
  const values = new URLSearchParams(raw);
  if (new Set(values.keys()).size !== [...values.keys()].length)
    throw invalid();
  const hash = values.get("hash") || "";
  const at = Number(values.get("auth_date"));
  if (
    !/^[a-f0-9]{64}$/.test(hash) ||
    !Number.isSafeInteger(at) ||
    at > now / 1000 + 30 ||
    at < now / 1000 - 900
  )
    throw invalid();
  values.delete("hash");
  const check = [...values]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) throw invalid();
  let user;
  try {
    user = JSON.parse(values.get("user") || "null");
  } catch {
    throw invalid();
  }
  if (
    !Number.isSafeInteger(user?.id) ||
    user.id <= 0 ||
    user.is_bot ||
    typeof user.first_name !== "string"
  )
    throw invalid();
  return {
    id: String(user.id),
    name: [user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ")
      .slice(0, 120),
    username:
      typeof user.username === "string" ? user.username.slice(0, 64) : "",
  };
}

export function promotionService(store, origin) {
  const linkRow = (id) =>
    store.get(
      `SELECT l.*,s.name AS source_name,a.slug AS event_slug FROM promotion_links l
     JOIN promotion_sources s ON s.id=l.source_id JOIN promotion_events a ON a.event_id=l.event_id WHERE l.id=?`,
      id,
    );
  const withUrl = (row) => ({
    ...row,
    url: `${origin}/${row.event_slug}/${row.slug}`,
  });
  return {
    async attribution(input, eventId) {
      if (input === undefined || input === null) return {};
      const refs = z
        .object({
          first: z.uuid(),
          last: z.uuid(),
          consent_version: z.literal(ATTRIBUTION_CONSENT_VERSION),
        })
        .strict()
        .parse(input);
      const [first, last] = await Promise.all([
        linkRow(refs.first),
        linkRow(refs.last),
      ]);
      if (
        !first ||
        !last ||
        first.event_id !== eventId ||
        last.event_id !== eventId
      )
        throw new AppError(
          400,
          "Источник не относится к этому мероприятию. Обновите страницу.",
        );
      return {
        first_source_link_id: first.id,
        source_link_id: last.id,
        source_label: [last.source_name, last.placement]
          .filter(Boolean)
          .join(" · "),
        source_path: `/${last.event_slug}/${last.slug}`,
        source_consent_version: refs.consent_version,
        source_consent_at: new Date().toISOString(),
      };
    },
    async resolve(eventSlug, linkSlug) {
      const row = await store.get(
        `SELECT l.id,l.event_id,l.active,e.published FROM promotion_links l
         JOIN promotion_events a ON a.event_id=l.event_id JOIN events e ON e.id=l.event_id
         WHERE a.slug=? AND l.slug=?`,
        slug.parse(eventSlug),
        slug.parse(linkSlug),
      );
      if (!row || !row.published)
        throw new AppError(404, "Мероприятие или ссылка не найдены");
      if (!row.active)
        throw new AppError(
          410,
          "Эта ссылка больше не используется. Обратитесь к организатору.",
        );
      return { event_id: row.event_id, link_id: row.id };
    },
    async createLink(raw, actor) {
      const input = z
        .object({
          event_id: z.string().min(1).max(80),
          event_slug: slug,
          source_id: z.uuid().optional(),
          source_name: label.optional(),
          placement: z
            .string()
            .trim()
            .max(80)
            .regex(/^[^\r\n\x00-\x1f]*$/)
            .default(""),
          slug,
        })
        .strict()
        .parse(raw);
      if (reserved.has(input.event_slug))
        throw new AppError(400, "Этот адрес занят служебной страницей");
      return store.transaction(async () => {
        const event = await store.event(input.event_id);
        if (!event) throw new AppError(404, "Мероприятие не найдено");
        let alias = await store.get(
          "SELECT slug FROM promotion_events WHERE event_id=?",
          event.id,
        );
        if (!alias) {
          if (
            await store.get(
              "SELECT event_id FROM promotion_events WHERE slug=?",
              input.event_slug,
            )
          )
            throw new AppError(409, "Короткое имя мероприятия уже занято");
          await store.run(
            "INSERT INTO promotion_events(event_id,slug) VALUES (?,?)",
            event.id,
            input.event_slug,
          );
          alias = { slug: input.event_slug };
        }
        if (alias.slug !== input.event_slug)
          throw new AppError(
            409,
            "Адрес мероприятия уже задан. Обновите список.",
          );
        if (
          await store.get(
            "SELECT id FROM promotion_links WHERE event_id=? AND slug=?",
            event.id,
            input.slug,
          )
        )
          throw new AppError(
            409,
            "Такая ссылка уже существует для этого мероприятия",
          );
        let source = input.source_id
          ? await store.get(
              "SELECT id FROM promotion_sources WHERE id=?",
              input.source_id,
            )
          : null;
        if (input.source_id && !source)
          throw new AppError(404, "Источник не найден");
        if (!input.source_id) {
          const name = label.parse(input.source_name);
          const normalized = name.toLocaleLowerCase("ru");
          source = await store.get(
            "SELECT id FROM promotion_sources WHERE normalized_name=?",
            normalized,
          );
          if (!source) {
            source = { id: randomUUID() };
            await store.run(
              "INSERT INTO promotion_sources(id,name,normalized_name,created_by,created_at) VALUES (?,?,?,?,?)",
              source.id,
              name,
              normalized,
              actor,
              new Date().toISOString(),
            );
          }
        }
        const id = randomUUID();
        await store.run(
          "INSERT INTO promotion_links(id,event_id,source_id,slug,placement,created_by,created_at) VALUES (?,?,?,?,?,?,?)",
          id,
          event.id,
          source.id,
          input.slug,
          input.placement,
          actor,
          new Date().toISOString(),
        );
        await store.audit("promotion_link_created", id, actor);
        return withUrl(await linkRow(id));
      });
    },
    async overview(query) {
      const input = z
        .object({
          event_id: z.string().min(1).max(80).optional(),
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
        })
        .parse(query);
      if (input.from && input.to && input.from > input.to)
        throw new AppError(400, "Начало периода позже окончания");
      const conditions = [
        "o.mode='live'",
        "o.is_test=0",
        "o.voided_at IS NULL",
        "o.status='paid'",
        "o.method<>'invite'",
        "o.total>0",
      ];
      const params = [];
      if (input.event_id) {
        conditions.push("o.event_id=?");
        params.push(input.event_id);
      }
      // A day is interpreted in the venue's UTC+03 timezone; end is exclusive.
      if (input.from) {
        conditions.push("o.paid_at>=?");
        params.push(new Date(`${input.from}T00:00:00+03:00`).toISOString());
      }
      if (input.to) {
        conditions.push("o.paid_at<?");
        params.push(
          new Date(
            new Date(`${input.to}T00:00:00+03:00`).getTime() + 86400000,
          ).toISOString(),
        );
      }
      return store.transaction(async () => {
        const rows = await store.all(
          `SELECT o.source_link_id,l.source_id,s.name AS source_name,l.placement,l.slug,a.slug AS event_slug,e.title AS event_title,
           COUNT(*) AS orders,COALESCE(SUM(o.quantity),0) AS tickets,COALESCE(SUM(o.total),0) AS revenue
           FROM orders o LEFT JOIN promotion_links l ON l.id=o.source_link_id
           LEFT JOIN promotion_sources s ON s.id=l.source_id LEFT JOIN promotion_events a ON a.event_id=l.event_id
           JOIN events e ON e.id=o.event_id WHERE ${conditions.join(" AND ")}
           GROUP BY o.source_link_id,l.source_id,s.name,l.placement,l.slug,a.slug,e.title ORDER BY revenue DESC`,
          ...params,
        );
        return {
          rows,
          totals: rows.reduce(
            (sum, row) => ({
              orders: sum.orders + row.orders,
              tickets: sum.tickets + row.tickets,
              revenue: sum.revenue + row.revenue,
            }),
            { orders: 0, tickets: 0, revenue: 0 },
          ),
          updated_at: new Date().toISOString(),
        };
      });
    },
    async catalog() {
      return {
        events: await store.all(
          "SELECT e.id,e.title,e.date,e.capacity,e.published,a.slug FROM events e LEFT JOIN promotion_events a ON a.event_id=e.id ORDER BY e.date DESC",
        ),
        sources: await store.all(
          "SELECT id,name FROM promotion_sources ORDER BY name",
        ),
        links: (
          await store.all(`SELECT l.*,s.name AS source_name,a.slug AS event_slug,m.display_name AS creator_name
          FROM promotion_links l JOIN promotion_sources s ON s.id=l.source_id
          JOIN promotion_events a ON a.event_id=l.event_id LEFT JOIN team_members m ON m.telegram_id=l.created_by ORDER BY l.created_at DESC`)
        ).map(withUrl),
      };
    },
  };
}

export function createGroupAccess(
  chatId = "",
  client = telegram,
  clock = Date.now,
) {
  if (
    chatId &&
    (!/^-\d+$/.test(chatId) || !Number.isSafeInteger(Number(chatId)))
  )
    throw new Error(
      "TELEGRAM_MINIAPP_GROUP_ID must be a negative Telegram chat ID",
    );
  const cache = new Map();
  return {
    chatId,
    async check(userId, fresh = false) {
      if (!chatId) return false;
      const known = cache.get(userId);
      if (!fresh && known?.expires > clock()) return known.member;
      // No stale-allow fallback: after expiration a Telegram failure denies access.
      cache.delete(userId);
      try {
        const member = await client.isGroupMember(chatId, userId);
        if (typeof member !== "boolean") throw new Error("invalid_membership");
        if (cache.size >= 512) cache.delete(cache.keys().next().value);
        cache.set(userId, { member, expires: clock() + 60000 });
        return member;
      } catch {
        throw new AppError(
          503,
          "Не удалось проверить участие в группе Telegram. Повторите чуть позже.",
        );
      }
    },
  };
}

export function registerTeamRoutes(
  app,
  { store, promotion, authLimit, groupAccess = createGroupAccess() },
) {
  app.post("/api/team/auth", authLimit, async (req, res) => {
    const user = verifyTelegramData(
      req.body?.initData,
      process.env.TELEGRAM_BOT_TOKEN,
    );
    const owner = user.id === process.env.TELEGRAM_MINIAPP_OWNER_ID;
    const previous = await store.get(
      "SELECT role,status,access_group_id FROM team_members WHERE telegram_id=?",
      user.id,
    );
    const checkGroup =
      !owner &&
      previous?.role !== "owner" &&
      previous?.status !== "blocked" &&
      (previous?.status !== "active" || previous?.access_group_id);
    const inGroup = checkGroup && (await groupAccess.check(user.id, true));
    const member = await store.transaction(async () => {
      await store.run(
        "INSERT OR IGNORE INTO team_members(telegram_id,display_name,username,role,status,created_at) VALUES (?,?,?,?,?,?)",
        user.id,
        user.name,
        user.username,
        owner ? "owner" : "editor",
        owner ? "active" : "pending",
        new Date().toISOString(),
      );
      await store.run(
        "UPDATE team_members SET display_name=?,username=? WHERE telegram_id=?",
        user.name,
        user.username,
        user.id,
      );
      if (owner)
        await store.run(
          "UPDATE team_members SET role='owner',status='active' WHERE telegram_id=?",
          user.id,
        );
      else if (inGroup) {
        // Re-read permissions in the transaction so a concurrent manual block wins.
        const changed = await store.run(
          "UPDATE team_members SET status='active',access_group_id=? WHERE telegram_id=? AND role<>'owner' AND status<>'blocked' AND (status='pending' OR access_group_id IS NOT NULL)",
          groupAccess.chatId,
          user.id,
        );
        if (
          changed.changes &&
          (previous?.status !== "active" || !previous?.access_group_id)
        )
          await store.audit(
            "team_group_access_granted",
            user.id,
            "telegram_group:" + groupAccess.chatId,
          );
      } else if (checkGroup) {
        const changed = await store.run(
          "UPDATE team_members SET status='pending' WHERE telegram_id=? AND access_group_id IS NOT NULL AND status='active'",
          user.id,
        );
        if (changed.changes)
          await store.run(
            "DELETE FROM team_sessions WHERE telegram_id=?",
            user.id,
          );
      }
      return store.get(
        "SELECT telegram_id,display_name,username,role,status,access_group_id FROM team_members WHERE telegram_id=?",
        user.id,
      );
    });
    if (member.status !== "active")
      return res.status(403).json({
        error:
          member.status === "pending"
            ? "Запрос на доступ отправлен владельцу панели"
            : "Доступ к панели отключён",
        member,
      });
    const value = token();
    await store.run("DELETE FROM team_sessions WHERE expires_at<?", Date.now());
    await store.run(
      "INSERT INTO team_sessions(id,telegram_id,expires_at) VALUES (?,?,?)",
      digest(value),
      user.id,
      Date.now() + 12 * 3600000,
    );
    res.json({
      token: value,
      member: { ...member, group_access_enabled: Boolean(groupAccess.chatId) },
    });
  });
  app.use("/api/team", async (req, _res, next) => {
    if (req.staff?.role === "admin")
      req.team = {
        telegram_id: "admin",
        display_name: "Администратор сайта",
        role: "owner",
        status: "active",
      };
    else {
      const value = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (/^[a-f0-9]{48}$/.test(value))
        req.team = await store.get(
          "SELECT m.telegram_id,m.display_name,m.username,m.role,m.status,m.access_group_id FROM team_sessions s JOIN team_members m ON m.telegram_id=s.telegram_id WHERE s.id=? AND s.expires_at>? AND m.status='active'",
          digest(value),
          Date.now(),
        );
    }
    if (!req.team)
      throw new AppError(
        401,
        "Откройте панель через Telegram или войдите как администратор сайта",
      );
    if (
      req.team.role !== "owner" &&
      req.team.access_group_id &&
      (req.team.access_group_id !== groupAccess.chatId ||
        !(await groupAccess.check(req.team.telegram_id)))
    )
      throw new AppError(
        403,
        "Доступ к панели открыт участникам рабочей группы Telegram",
      );
    next();
  });
  const editor = (req) => {
    if (!["owner", "editor"].includes(req.team.role))
      throw new AppError(403, "Доступен только просмотр");
  };
  const owner = (req) => {
    if (req.team.role !== "owner")
      throw new AppError(403, "Доступно только владельцу");
  };
  app.get("/api/team/me", (req, res) =>
    res.json({
      ...req.team,
      group_access_enabled: Boolean(groupAccess.chatId),
    }),
  );
  app.get("/api/team/catalog", async (_req, res) =>
    res.json(await promotion.catalog()),
  );
  app.get("/api/team/stats", async (req, res) =>
    res.json(await promotion.overview(req.query)),
  );
  app.post("/api/team/links", async (req, res) => {
    editor(req);
    res
      .status(201)
      .json(await promotion.createLink(req.body, req.team.telegram_id));
  });
  app.patch("/api/team/links/:id", async (req, res) => {
    editor(req);
    const { active } = z
      .object({ active: z.boolean() })
      .strict()
      .parse(req.body);
    await store.transaction(async () => {
      const link = await store.get(
        "SELECT created_by FROM promotion_links WHERE id=?",
        z.uuid().parse(req.params.id),
      );
      if (!link) throw new AppError(404, "Ссылка не найдена");
      if (req.team.role !== "owner" && link.created_by !== req.team.telegram_id)
        throw new AppError(403, "Можно изменять только свои ссылки");
      await store.run(
        "UPDATE promotion_links SET active=? WHERE id=?",
        active ? 1 : 0,
        req.params.id,
      );
      await store.audit(
        active ? "promotion_link_enabled" : "promotion_link_disabled",
        req.params.id,
        req.team.telegram_id,
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/team/members", async (req, res) => {
    owner(req);
    res.json(
      await store.all(
        "SELECT telegram_id,display_name,username,role,status,access_group_id FROM team_members ORDER BY created_at DESC",
      ),
    );
  });
  app.patch("/api/team/members/:id", async (req, res) => {
    owner(req);
    const id = z
      .string()
      .regex(/^\d{1,16}$/)
      .parse(req.params.id);
    const input = z
      .object({
        role: z.enum(["editor", "viewer"]),
        status: z.enum(["active", "blocked"]),
      })
      .strict()
      .parse(req.body);
    await store.transaction(async () => {
      const member = await store.get(
        "SELECT role FROM team_members WHERE telegram_id=?",
        id,
      );
      if (!member)
        throw new AppError(404, "Сотрудник ещё не открывал Mini App");
      if (
        member.role === "owner" ||
        id === req.team.telegram_id ||
        id === process.env.TELEGRAM_MINIAPP_OWNER_ID
      )
        throw new AppError(409, "Права владельца здесь не изменяются");
      await store.run(
        "UPDATE team_members SET role=?,status=? WHERE telegram_id=?",
        input.role,
        input.status,
        id,
      );
      await store.run("DELETE FROM team_sessions WHERE telegram_id=?", id);
      await store.audit(
        `team_member_${input.status}_${input.role}`,
        id,
        req.team.telegram_id,
      );
    });
    res.json({ ok: true });
  });
}
