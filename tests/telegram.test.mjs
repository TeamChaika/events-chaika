import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelegramClient } from "../server/telegram.mjs";

function setup(t) {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "123:fixture_token";
  t.after(() => {
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previous;
  });
}
test("Telegram sends once through configured proxy and retains message ID", async (t) => {
  setup(t);
  let sends = 0;
  const proxy = {};
  const client = createTelegramClient(
    async (url, options) => {
      assert.equal(options.dispatcher, proxy);
      assert.equal(options.redirect, "error");
      if (url.endsWith("getMe"))
        return Response.json({
          ok: true,
          result: { is_bot: true, username: "fixture_bot" },
        });
      sends++;
      assert.equal(JSON.parse(options.body).text, "Проверка");
      return Response.json({ ok: true, result: { message_id: 42 } });
    },
    () => proxy,
  );
  assert.deepEqual(await client.check(), {
    ready: true,
    username: "fixture_bot",
    proxy: true,
  });
  assert.deepEqual(await client.send("Проверка"), {
    status: "sent",
    providerId: "42",
  });
  assert.equal(sends, 1);
});
test("Telegram never falls back or retries an uncertain proxy send", async (t) => {
  setup(t);
  let sends = 0;
  const client = createTelegramClient(
    async () => {
      sends++;
      throw new Error("secret-token");
    },
    () => ({}),
  );
  await assert.rejects(client.send("Проверка"), {
    message: "telegram_unknown",
  });
  assert.equal(sends, 1);
});
test("Telegram distinguishes provider rejection from invalid acknowledgement", async (t) => {
  setup(t);
  const rejected = createTelegramClient(
    async () => Response.json({ ok: false }, { status: 403 }),
    () => undefined,
  );
  await assert.rejects(rejected.send("Проверка"), {
    message: "telegram_rejected",
  });
  const malformed = createTelegramClient(
    async () => Response.json({ ok: true, result: {} }),
    () => undefined,
  );
  await assert.rejects(malformed.send("Проверка"), {
    message: "telegram_unknown",
  });
});

test("Telegram edits the known message and accepts an already applied edit", async (t) => {
  setup(t);
  let count = 0;
  const client = createTelegramClient(
    async (url, options) => {
      assert.ok(url.endsWith("/editMessageText"));
      assert.equal(JSON.parse(options.body).message_id, 42);
      count++;
      return count === 1
        ? Response.json({ ok: true, result: { message_id: 42 } })
        : Response.json(
            {
              ok: false,
              error_code: 400,
              description:
                "Bad Request: message is not modified: specified new message content is exactly the same",
            },
            { status: 400 },
          );
    },
    () => undefined,
  );
  assert.deepEqual(await client.edit("42", "Оплачено"), {
    status: "sent",
    providerId: "42",
  });
  assert.deepEqual(await client.edit("42", "Оплачено"), {
    status: "sent",
    providerId: "42",
  });
});
