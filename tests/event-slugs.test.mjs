import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore, seed } from "../server/store.mjs";
import {
  eventSlugBase,
  ensureEventSlug,
  ensureEventSlugs,
} from "../server/event-slugs.mjs";

test("event names become bounded readable paths without reserved route collisions", () => {
  assert.equal(
    eventSlugBase("Ливадия Новогодняя ночь"),
    "livadiya-novogodnyaya-noch",
  );
  assert.equal(eventSlugBase("Одиссея"), "odisseya");
  assert.equal(eventSlugBase("Ёлка / море & Café!"), "yolka-more-cafe");
  assert.equal(eventSlugBase("admin"), "event-admin");
  assert.equal(eventSlugBase("🎉🎉🎉"), "event");
  assert.ok(eventSlugBase("Очень длинное название ".repeat(10)).length <= 40);
});

test("backfill preserves existing public/source links and assigns stable unique names to legacy events", async (t) => {
  const store = await openStore(":memory:");
  t.after(() => store.db.close());
  await seed(store);
  const original = await store.get("SELECT * FROM events WHERE id='red-moon'");
  const add = async (id, title) => {
    const event = { ...original, id, title };
    await store.run(
      `INSERT INTO events (${Object.keys(event).join(",")}) VALUES (${Object.keys(
        event,
      )
        .map(() => "?")
        .join(",")})`,
      ...Object.values(event),
    );
  };
  await add("legacy-1", "Ливадия Новогодняя ночь");
  await add("legacy-2", "Ливадия Новогодняя ночь");
  await ensureEventSlugs(store);
  assert.equal((await store.event("red-moon")).public_slug, "moon");
  assert.equal(
    (await store.event("legacy-1")).public_slug,
    "livadiya-novogodnyaya-noch",
  );
  assert.equal(
    (await store.event("legacy-2")).public_slug,
    "livadiya-novogodnyaya-noch-2",
  );
  await store.run(
    "UPDATE events SET title=? WHERE id=?",
    "Другое название",
    "legacy-1",
  );
  await ensureEventSlugs(store);
  assert.equal(
    await ensureEventSlug(store, "legacy-1", "Другое название"),
    "livadiya-novogodnyaya-noch",
  );
  await add("parallel-a", "Один вечер");
  await add("parallel-b", "Один вечер");
  const names = await Promise.all([
    ensureEventSlug(store, "parallel-a", "Один вечер"),
    ensureEventSlug(store, "parallel-b", "Один вечер"),
    ensureEventSlug(store, "parallel-a", "Один вечер"),
  ]);
  assert.deepEqual(names, ["odin-vecher", "odin-vecher-2", "odin-vecher"]);
});
