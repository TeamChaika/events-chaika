import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Invoke inside the app container. A SQLite backup includes committed WAL data.
const folder = "/app/data/backups";
process.umask(0o077);
mkdirSync(folder, { recursive: true, mode: 0o700 });
const target = join(
  folder,
  `events-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
);
const db = new DatabaseSync(process.env.DB_PATH || "/app/data/events.sqlite", {
  readOnly: true,
});
try {
  await backup(db, target);
} finally {
  db.close();
}
console.log("SQLite backup created", target);
