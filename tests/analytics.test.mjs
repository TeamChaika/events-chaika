import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../src/analytics.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
);
const analytics = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const {
  analyticsPageUrl,
  analyticsReferrer,
  readAnalyticsChoice,
  startAnalytics,
  stopAnalytics,
  ANALYTICS_POLICY_VERSION,
  METRIKA_ID,
} = analytics;

test("only the public homepage is eligible; access tokens and query strings never become page URLs", () => {
  assert.equal(
    analyticsPageUrl(
      "https://event.chaika.team/?event=red-moon&phone=private#secret",
    ),
    "https://event.chaika.team/",
  );
  for (const path of [
    "/ticket/secret",
    "/order/secret",
    "/admin",
    "/checkin",
    "/unsubscribe/secret",
    "/legal/privacy",
    "/other",
  ]) {
    assert.equal(analyticsPageUrl("https://event.chaika.team" + path), null);
  }
  for (const url of [
    "http://localhost:5173/",
    "https://teamchaika-events-chaika-3a5f.twc1.net/",
    "http://event.chaika.team/",
    "https://event.chaika.team.evil.test/",
    "invalid",
  ]) {
    assert.equal(analyticsPageUrl(url), null);
  }
  assert.equal(
    analyticsReferrer("https://event.chaika.team/ticket/secret?email=private"),
    "https://event.chaika.team/",
  );
  assert.equal(
    analyticsReferrer("https://ya.ru/search/?text=private"),
    "https://ya.ru/",
  );
  assert.equal(analyticsReferrer("javascript:private"), "");
});

test("absent, expired, forged, older, future-dated or unavailable consent fails closed", () => {
  const now = 20000000000;
  const read = (value) =>
    readAnalyticsChoice({ getItem: () => JSON.stringify(value) }, now);
  const valid = {
    version: ANALYTICS_POLICY_VERSION,
    choice: "allowed",
    at: now - 1000,
  };
  assert.equal(read(valid), "allowed");
  assert.equal(read({ ...valid, choice: "denied" }), "denied");
  for (const value of [
    null,
    {},
    { ...valid, at: now - 181 * 86400000 },
    { ...valid, at: now + 1000 },
    { ...valid, version: "old" },
    { ...valid, choice: true },
    { ...valid, at: "yesterday" },
  ]) {
    assert.equal(read(value), null);
  }
  assert.equal(readAnalyticsChoice({ getItem: () => "broken" }), null);
  assert.equal(
    readAnalyticsChoice({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    null,
  );
});

function browser(t, href = "https://event.chaika.team/?phone=private") {
  const scripts = [],
    calls = [];
  const original = new Map(
    ["window", "document", "location"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { ym: (...args) => calls.push(args) },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      referrer: "https://event.chaika.team/ticket/secret",
      createElement: () => ({
        dataset: {},
        remove() {
          this.removed = true;
        },
      }),
      head: { appendChild: (script) => scripts.push(script) },
    },
  });
  t.after(() => {
    stopAnalytics();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { scripts, calls };
}

test("no request before consent or after refusal; repeated startup produces one sanitized view", (t) => {
  const { scripts, calls } = browser(t);
  startAnalytics(null);
  startAnalytics("denied");
  assert.equal(scripts.length, 0);
  startAnalytics("allowed");
  startAnalytics("allowed");
  assert.equal(scripts.length, 1);
  assert.equal(
    scripts[0].src,
    `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`,
  );
  assert.equal(scripts[0].referrerPolicy, "no-referrer");
  assert.equal(calls.length, 0);
  scripts[0].onload();
  assert.equal(calls.length, 2);
  const [id, operation, settings] = calls[0];
  assert.equal(id, METRIKA_ID);
  assert.equal(operation, "init");
  for (const key of [
    "webvisor",
    "clickmap",
    "trackLinks",
    "trackHash",
    "ecommerce",
    "sendTitle",
  ])
    assert.equal(settings[key], false);
  assert.equal(settings.defer, true);
  assert.equal(settings.disableYtm, true);
  assert.equal(calls[1][1], "hit");
  assert.equal(calls[1][2], "https://event.chaika.team/");
  assert.equal(calls[1][3].referer, "https://event.chaika.team/");
  assert.ok(!JSON.stringify(calls).includes("secret"));
  assert.ok(!JSON.stringify(calls).includes("private"));
  stopAnalytics();
  assert.equal(calls[2][1], "destruct");
  assert.equal(scripts[0].removed, true);
});

test("withdrawal during slow script loading cannot initialize a counter afterwards", (t) => {
  const { scripts, calls } = browser(t);
  startAnalytics("allowed");
  const lateLoad = scripts[0].onload;
  assert.equal(stopAnalytics(), true);
  lateLoad();
  assert.equal(calls.length, 0);
  assert.equal(scripts[0].onload, null);
});

test("even a stored permission never loads the library on personal ticket pages", (t) => {
  const { scripts } = browser(t, "https://event.chaika.team/ticket/secret");
  startAnalytics("allowed");
  assert.equal(scripts.length, 0);
});

test("a blocked analytics script does not throw or enter a retry loop", (t) => {
  const { scripts, calls } = browser(t);
  startAnalytics("allowed");
  scripts[0].onerror();
  startAnalytics("allowed");
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].dataset.analytics, "unavailable");
  assert.equal(calls.length, 0);
});
