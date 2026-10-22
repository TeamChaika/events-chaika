import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { AppError, token } from "./store.mjs";

const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest();
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(
    /^[a-z0-9][a-z0-9.@_-]*$/,
    "Логин: латинские буквы, цифры, точка, @, дефис или подчёркивание",
  );
const password = z.string().min(12, "Пароль — минимум 12 символов").max(128);
const createInput = z
  .object({
    username,
    display_name: z.string().trim().min(2, "Укажите имя сотрудника").max(80),
    password,
    role: z.enum(["door", "admin"]).default("door"),
  })
  .strict();
const publicColumns =
  "id,username,display_name,role,active,created_at,last_login_at";

async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(value, salt, 64, options);
  return `scrypt-v1:${salt}:${key.toString("hex")}`;
}
async function verifyPassword(value, saved) {
  const [, salt, key] = saved.split(":");
  const actual = await derive(value, salt, 64, options);
  return timingSafeEqual(actual, Buffer.from(key, "hex"));
}
const dummyHash = hashPassword(randomBytes(32).toString("hex"));

export function staffService(store, { demo = false } = {}) {
  const hasDoorAccounts = async () =>
    Boolean(
      await store.get(
        "SELECT id FROM staff_accounts WHERE role='door' LIMIT 1",
      ),
    );
  async function session(id) {
    const row = await store.get(
      `SELECT s.id,s.role,ss.staff_id,a.display_name,a.username,a.active,a.role AS account_role
       FROM sessions s LEFT JOIN staff_sessions ss ON ss.session_id=s.id
       LEFT JOIN staff_accounts a ON a.id=ss.staff_id WHERE s.id=? AND s.expires_at>?`,
      id,
      Date.now(),
    );
    if (!row) return null;
    if (row.staff_id) {
      if (!row.active) return null;
      row.role = row.account_role;
      row.actor = `staff:${row.staff_id}`;
    } else {
      if (row.role === "door" && (await hasDoorAccounts())) return null;
      row.actor = row.role;
    }
    return row;
  }
  const publicSession = (row) => ({
    role: row?.role || null,
    staff_id: row?.staff_id || null,
    display_name:
      row?.display_name || (row?.role === "admin" ? "Владелец" : null),
  });
  async function requireAdmin(actor) {
    const current = await session(actor.id);
    if (current?.role !== "admin")
      throw new AppError(403, "Нужен доступ администратора");
  }
  async function login(raw) {
    const parsed = z
      .object({
        username: z.string().trim().max(48).optional(),
        password: z.string().max(128).optional(),
        role: z.enum(["admin", "door"]).optional(),
        demo: z.boolean().optional(),
      })
      .safeParse(raw);
    if (!parsed.success) throw new AppError(401, "Неверный логин или пароль");
    const input = parsed.data;
    const name = input.username?.toLowerCase();
    const account = name
      ? await store.get("SELECT * FROM staff_accounts WHERE username=?", name)
      : null;
    if (name) {
      const valid = await verifyPassword(
        input.password || "",
        account?.password_hash || (await dummyHash),
      );
      if (!valid || !account?.active)
        throw new AppError(401, "Неверный логин или пароль");
    }
    return store.transaction(async () => {
      let role = input.role === "door" ? "door" : "admin";
      if (name) {
        const fresh = await store.get(
          "SELECT * FROM staff_accounts WHERE id=?",
          account.id,
        );
        // A reset/disable racing a slow password check must not create a new session.
        if (!fresh?.active || fresh.password_hash !== account.password_hash)
          throw new AppError(401, "Неверный логин или пароль");
        role = fresh.role;
      } else {
        const expected =
          role === "admin"
            ? process.env.ADMIN_PASSWORD
            : process.env.SCANNER_PASSWORD;
        if (
          (role === "door" && (await hasDoorAccounts())) ||
          (!(demo && input.demo === true) &&
            (!expected ||
              !timingSafeEqual(digest(input.password || ""), digest(expected))))
        )
          throw new AppError(401, "Неверный логин или пароль");
      }
      const value = token();
      const id = digest(value).toString("hex");
      await store.run(
        "INSERT INTO sessions(id,role,expires_at) VALUES (?,?,?)",
        id,
        role,
        Date.now() + 12 * 3600000,
      );
      if (account) {
        await store.run(
          "INSERT INTO staff_sessions(session_id,staff_id) VALUES (?,?)",
          id,
          account.id,
        );
        await store.run(
          "UPDATE staff_accounts SET last_login_at=? WHERE id=?",
          new Date().toISOString(),
          account.id,
        );
      }
      return { value, user: publicSession(await session(id)) };
    });
  }
  const list = () =>
    store.all(
      `SELECT ${publicColumns} FROM staff_accounts ORDER BY created_at,id`,
    );
  const revoke = (id) =>
    store.run(
      "DELETE FROM sessions WHERE id IN (SELECT session_id FROM staff_sessions WHERE staff_id=?)",
      id,
    );
  async function create(raw, actor) {
    const input = createInput.parse(raw);
    const saved = await hashPassword(input.password);
    return store.transaction(async () => {
      await requireAdmin(actor);
      if (
        await store.get(
          "SELECT id FROM staff_accounts WHERE username=?",
          input.username,
        )
      )
        throw new AppError(409, "Этот логин уже занят");
      const id = randomUUID();
      await store.run(
        "INSERT INTO staff_accounts(id,username,display_name,password_hash,role,active,created_at) VALUES (?,?,?,?,?,1,?)",
        id,
        input.username,
        input.display_name,
        saved,
        input.role,
        new Date().toISOString(),
      );
      if (input.role === "door")
        await store.run(
          "DELETE FROM sessions WHERE role='door' AND id NOT IN (SELECT session_id FROM staff_sessions)",
        );
      await store.audit("staff_created", id, actor.actor);
      return store.get(
        `SELECT ${publicColumns} FROM staff_accounts WHERE id=?`,
        id,
      );
    });
  }
  async function update(id, raw, actor) {
    const input = z
      .object({ active: z.boolean().optional(), password: password.optional() })
      .strict()
      .refine(
        (value) => value.active !== undefined || value.password !== undefined,
      )
      .parse(raw);
    const saved =
      input.password === undefined ? null : await hashPassword(input.password);
    return store.transaction(async () => {
      await requireAdmin(actor);
      const account = await store.get(
        "SELECT * FROM staff_accounts WHERE id=?",
        id,
      );
      if (!account) throw new AppError(404, "Сотрудник не найден");
      if (actor.staff_id === id)
        throw new AppError(
          409,
          "Свою учётную запись изменяет другой администратор или владелец",
        );
      await store.run(
        "UPDATE staff_accounts SET active=?,password_hash=? WHERE id=?",
        input.active === undefined ? account.active : Number(input.active),
        saved || account.password_hash,
        id,
      );
      await revoke(id);
      await store.audit(
        saved
          ? "staff_password_changed"
          : input.active
            ? "staff_enabled"
            : "staff_disabled",
        id,
        actor.actor,
      );
      return store.get(
        `SELECT ${publicColumns} FROM staff_accounts WHERE id=?`,
        id,
      );
    });
  }
  return {
    session,
    publicSession,
    hasDoorAccounts,
    login,
    list,
    create,
    update,
  };
}
