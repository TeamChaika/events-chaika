import { randomUUID } from "node:crypto";
import pg from "pg";

export async function testDatabase() {
  if (!process.env.TEST_DATABASE_URL) return { databaseUrl: "" };
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("Tests require a local PostgreSQL instance");
  const pool = new pg.Pool({ connectionString: url.toString() });
  const schema = "test_" + randomUUID().replaceAll("-", "");
  await pool.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-csearch_path=${schema}`);
  return {
    databaseUrl: url.toString(),
    cleanupDatabase: async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    },
  };
}
