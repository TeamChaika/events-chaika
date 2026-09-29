import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ts from "typescript";
const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
const url = (text) =>
  `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const analyticsUrl = url(compile("../src/analytics.ts"));
const analytics = await import(analyticsUrl);
const source = compile("../src/attribution.ts").replace(
  'from "./analytics"',
  `from "${analyticsUrl}"`,
);
async function harness(t, choice = null) {
  const old = {
    localStorage: globalThis.localStorage,
    window: globalThis.window,
  };
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = new EventTarget();
  const choose = (choice) => {
    if (choice) analytics.saveAnalyticsChoice(choice);
    else values.delete(analytics.ANALYTICS_CHOICE_KEY);
  };
  choose(choice);
  const module = await import(url(source) + "#" + randomUUID());
  const stop = module.watchAttributionChoice();
  t.after(() => {
    stop();
    globalThis.localStorage = old.localStorage;
    globalThis.window = old.window;
  });
  return { ...module, values, choose };
}
test("no analytics consent means no stored attribution and no source in checkout", async (t) => {
  const h = await harness(t);
  const id = randomUUID();
  h.rememberSource("moon", id);
  assert.equal(h.orderAttribution("moon"), undefined);
  assert.equal(h.values.has(h.ATTRIBUTION_KEY), false);
  h.choose("allowed");
  assert.equal(h.orderAttribution("moon").last, id);
  assert.equal(JSON.parse(h.values.get(h.ATTRIBUTION_KEY)).moon.first, id);
  h.choose("denied");
  assert.equal(h.orderAttribution("moon"), undefined);
  assert.equal(h.values.has(h.ATTRIBUTION_KEY), false);
});
test("first and last sources are independent per event; direct revisits keep the last source", async (t) => {
  const h = await harness(t, "allowed");
  const first = randomUUID(),
    last = randomUUID(),
    other = randomUUID();
  h.rememberSource("moon", first);
  h.rememberSource("moon", last);
  h.rememberSource("winter", other);
  assert.deepEqual(h.orderAttribution("moon"), {
    first,
    last,
    consent_version: analytics.ANALYTICS_POLICY_VERSION,
  });
  const fresh = await import(url(source) + "#" + randomUUID());
  assert.equal(fresh.orderAttribution("moon").last, last);
  assert.equal(fresh.orderAttribution("winter").first, other);
  assert.equal(fresh.orderAttribution("unknown"), undefined);
});
test("expired and corrupted saved sources are ignored without affecting checkout", async (t) => {
  const h = await harness(t, "allowed");
  h.values.set(
    h.ATTRIBUTION_KEY,
    JSON.stringify({
      expired: {
        first: randomUUID(),
        last: randomUUID(),
        at: Date.now() - h.ATTRIBUTION_TTL - 1,
      },
      bad: { first: "bad", last: randomUUID(), at: Date.now() },
    }),
  );
  assert.equal(h.orderAttribution("expired"), undefined);
  assert.equal(h.orderAttribution("bad"), undefined);
  h.values.set(h.ATTRIBUTION_KEY, "broken");
  assert.equal(h.orderAttribution("moon"), undefined);
  globalThis.localStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.doesNotThrow(() => h.rememberSource("moon", randomUUID()));
  assert.equal(h.orderAttribution("moon"), undefined);
});
