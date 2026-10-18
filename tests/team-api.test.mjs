import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.transpileModule(
  readFileSync(new URL("../src/team-api.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const { teamRequest, TEAM_REQUEST_TIMEOUT } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("slow membership checks have time to complete and GET retries a transport abort", async (t) => {
  const durations = [];
  t.mock.method(AbortSignal, "timeout", (ms) => {
    durations.push(ms);
    return new AbortController().signal;
  });
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer fixture");
    if (++attempts === 1)
      throw new DOMException("Fetch is aborted", "AbortError");
    return Response.json({ totals: { tickets: 5 } });
  });
  const result = await teamRequest("/team/stats", "GET", undefined, "fixture");
  assert.equal(result.data.totals.tickets, 5);
  assert.deepEqual(durations, [35000, 35000]);
  assert.ok(TEAM_REQUEST_TIMEOUT > 20000);
});

test("uncertain promo POST is not replayed; network failures are explained in Russian", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new DOMException("Fetch is aborted", "AbortError");
  });
  await assert.rejects(
    teamRequest("/team/events/red-moon/promos", "POST", { code: "SAVE" }),
    /Соединение прервалось/,
  );
  assert.equal(fetch.mock.callCount(), 1);
});

test("denied access is not retried and malformed gateway responses get a readable error", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Доступ отключён" }, { status: 403 }),
  );
  assert.equal((await teamRequest("/team/catalog")).response.status, 403);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(
    async () => new Response("<html>Gateway error</html>", { status: 502 }),
  );
  await assert.rejects(
    teamRequest("/team/catalog"),
    /Не удалось прочитать ответ/,
  );
});
