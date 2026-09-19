import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";

// All business transactions share this lock, including during rolling deploys.
const TRANSACTION_LOCK = 739104827;
export async function openDatabase(path, databaseUrl) {
  const context = new AsyncLocalStorage();
  if (databaseUrl) {
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 6,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      statement_timeout: 15000,
      ...(process.env.PG_CA_FILE || process.env.PG_CA_CERT
        ? {
            ssl: {
              ca:
                process.env.PG_CA_CERT ||
                readFileSync(process.env.PG_CA_FILE, "utf8"),
              rejectUnauthorized: true,
            },
          }
        : {}),
    });
    pool.on("error", () => console.error("PostgreSQL connection lost"));
    const sqlForPg = (sql) => {
      let index = 0;
      const ignore = /INSERT OR IGNORE/i.test(sql);
      const normalized = sql
        .replace(/INSERT OR IGNORE/gi, "INSERT")
        .replace(/\browid\b/g, "sequence");
      // Queries are application-owned. Preserve quoted literals while numbering parameters.
      return (
        normalized.replace(/'(?:''|[^'])*'|\?/g, (part) =>
          part === "?" ? `$${++index}` : part,
        ) + (ignore ? " ON CONFLICT DO NOTHING" : "")
      );
    };
    const query = async (sql, args = []) => {
      const result = await (context.getStore() || pool).query(
        sqlForPg(sql),
        args,
      );
      for (const row of result.rows || []) {
        for (const field of result.fields || []) {
          if (field.dataTypeID === 20 && row[field.name] !== null) {
            const value = Number(row[field.name]);
            if (!Number.isSafeInteger(value))
              throw new Error("Database integer exceeds safe range");
            row[field.name] = value;
          }
        }
      }
      return result;
    };
    const transaction = async (fn) => {
      if (context.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [
          TRANSACTION_LOCK,
        ]);
        const result = await context.run(client, fn);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    };
    return {
      kind: "postgres",
      get: async (sql, ...args) => (await query(sql, args)).rows[0],
      all: async (sql, ...args) => (await query(sql, args)).rows,
      run: async (sql, ...args) => ({
        changes: (await query(sql, args)).rowCount,
      }),
      exec: (sql) => query(sql),
      transaction,
      close: () => pool.end(),
    };
  }

  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  // Async route handlers must not interleave statements inside a SQLite transaction.
  let queue = Promise.resolve();
  const serialize = (fn) => {
    if (context.getStore()) return Promise.resolve().then(fn);
    const pending = queue.then(() => context.run(true, fn));
    queue = pending.catch(() => {});
    return pending;
  };
  return {
    kind: "sqlite",
    get: (sql, ...args) => serialize(() => db.prepare(sql).get(...args)),
    all: (sql, ...args) => serialize(() => db.prepare(sql).all(...args)),
    run: (sql, ...args) => serialize(() => db.prepare(sql).run(...args)),
    exec: (sql) => serialize(() => db.exec(sql)),
    transaction: (fn) => {
      if (context.getStore()) return fn();
      return serialize(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
    },
    close: () => serialize(() => db.close()),
  };
}
