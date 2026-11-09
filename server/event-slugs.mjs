export const reservedEventSlugs = new Set([
  "api",
  "team",
  "admin",
  "checkin",
  "wristbands",
  "ticket",
  "order",
  "legal",
  "unsubscribe",
  "assets",
  "media",
  "e",
]);

const transliteration = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function eventSlugBase(title) {
  const slug =
    [...title.toLowerCase()]
      .map((character) => transliteration[character] ?? character)
      .join("")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "event";
  return reservedEventSlugs.has(slug) ? `event-${slug}` : slug;
}

export async function ensureEventSlug(store, id, title) {
  return store.transaction(async () => {
    const saved = await store.get(
      "SELECT slug FROM promotion_events WHERE event_id=?",
      id,
    );
    if (saved) return saved.slug;
    const base = eventSlugBase(title);
    let slug = base;
    let suffix = 1;
    while (
      await store.get(
        "SELECT event_id FROM promotion_events WHERE slug=?",
        slug,
      )
    ) {
      const tail = `-${++suffix}`;
      slug = base.slice(0, 40 - tail.length).replace(/-+$/g, "") + tail;
    }
    await store.run(
      "INSERT INTO promotion_events(event_id,slug) VALUES (?,?)",
      id,
      slug,
    );
    return slug;
  });
}

export async function ensureEventSlugs(store) {
  return store.transaction(async () => {
    const events = await store.all(
      "SELECT e.id,e.title FROM events e LEFT JOIN promotion_events a ON a.event_id=e.id WHERE a.event_id IS NULL ORDER BY e.created_at,e.id",
    );
    for (const event of events)
      await ensureEventSlug(store, event.id, event.title);
  });
}
