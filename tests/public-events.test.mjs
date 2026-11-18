import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../src/public-events.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
);
const { publicEventRoute, ticketStatus, utmSearch } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("public event links forward only UTM parameters, including repeated and encoded values", () => {
  const incoming =
    "?token=private&utm_source=poster&event=old-id&utm_content=first%26second&utm_content=two+words&cookies=settings&utm_source_platform=kiosk&email=private";
  assert.equal(
    utmSearch(incoming),
    "?utm_source=poster&utm_content=first%26second&utm_content=two+words&utm_source_platform=kiosk",
  );
  for (const search of [
    "",
    "?event=old-id&token=private&preview=1",
    "?utm=poster&utm_=empty&UTM_SOURCE=poster",
  ])
    assert.equal(utmSearch(search), "");
});

test("the public homepage is the catalog unless a specific event was requested", () => {
  for (const search of [
    "",
    "?utm_source=poster",
    "?cookies=settings",
    "?event=",
  ])
    assert.deepEqual(publicEventRoute("/", search), { kind: "catalog" });
  assert.deepEqual(
    publicEventRoute("/", "?event=legacy-id&utm_source=poster"),
    { kind: "id", value: "legacy-id" },
  );
});

test("published event links, referral attribution and the original preview keep their own routes", () => {
  assert.deepEqual(publicEventRoute("/e/odisseya/", "?event=other"), {
    kind: "slug",
    value: "odisseya",
  });
  assert.deepEqual(publicEventRoute("/moon/partner", ""), {
    kind: "referral",
    event: "moon",
    source: "partner",
  });
  assert.deepEqual(publicEventRoute("/test-lending/", ""), {
    kind: "id",
    value: "red-moon",
  });
  for (const path of ["/missing", "/wrong/link/path", "/e/%FF"])
    assert.deepEqual(publicEventRoute(path, ""), { kind: "missing" });
});

test("catalog availability uses the event's local start time and public sales and capacity flags", () => {
  const event = {
    date: "2026-12-31",
    time: "21:00",
    sales_open: 1,
    available: 1,
  };
  const start = Date.parse("2026-12-31T18:00:00Z");
  assert.equal(ticketStatus(event, start - 1), "open");
  assert.equal(
    ticketStatus({ ...event, available: 0 }, start - 1),
    "unavailable",
  );
  assert.equal(ticketStatus({ ...event, sales_open: 0 }, start - 1), "closed");
  assert.equal(ticketStatus(event, start), "started");
  assert.equal(ticketStatus({ ...event, sales_open: 0 }, start + 1), "started");
});
