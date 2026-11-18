import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelegramClient, isTelegramChatId } from "../server/telegram.mjs";

const chatId = "-1001234567890";

test("the read-only Telegram lookup accepts only a matching current alias and numeric ID", async (t) => {
  setup(t);
  let result = {
    id: -1001234567890,
    username: "primary_name",
    active_usernames: ["legacy_group"],
  };
  const client = createTelegramClient(
    async (url, options) => {
      assert.ok(url.endsWith("/getChat"));
      assert.deepEqual(JSON.parse(options.body), { chat_id: "@Legacy_Group" });
      return Response.json({ ok: true, result });
    },
    () => undefined,
  );
  assert.equal(await client.resolveChat("@Legacy_Group"), chatId);
  result = { id: -44, username: "someone_else" };
  await assert.rejects(client.resolveChat("@Legacy_Group"), {
    message: "telegram_unknown",
  });
  await assert.rejects(client.resolveChat("https://invalid.example"), {
    message: "telegram_rejected",
  });
});

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
      assert.equal(JSON.parse(options.body).chat_id, chatId);
      return Response.json({
        ok: true,
        result: { message_id: 42, chat: { id: Number(chatId) } },
      });
    },
    () => proxy,
  );
  assert.deepEqual(await client.check(), {
    ready: true,
    username: "fixture_bot",
    proxy: true,
  });
  assert.deepEqual(await client.send("Проверка", chatId), {
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
  await assert.rejects(client.send("Проверка", chatId), {
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
  await assert.rejects(rejected.send("Проверка", chatId), {
    message: "telegram_rejected",
  });
  const malformed = createTelegramClient(
    async () => Response.json({ ok: true, result: {} }),
    () => undefined,
  );
  await assert.rejects(malformed.send("Проверка", chatId), {
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
      assert.equal(JSON.parse(options.body).chat_id, chatId);
      count++;
      return count === 1
        ? Response.json({
            ok: true,
            result: { message_id: 42, chat: { id: Number(chatId) } },
          })
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
  assert.deepEqual(await client.edit("42", "Оплачено", chatId), {
    status: "sent",
    providerId: "42",
  });
  assert.deepEqual(await client.edit("42", "Оплачено", chatId), {
    status: "sent",
    providerId: "42",
  });
});

test("chat IDs preserve signed 52-bit integers and reject IDs in another form", () => {
  for (const id of [
    chatId,
    "1",
    "-123",
    "-4503599627370495",
    "4503599627370495",
  ])
    assert.equal(isTelegramChatId(id), true, id);
  for (const id of [
    null,
    123,
    "",
    "0",
    "-0",
    " 1",
    "+1",
    "0123",
    "1.0",
    "1e5",
    "1\n",
    "@chat",
    "-4503599627370496",
    "9007199254740993",
  ])
    assert.equal(isTelegramChatId(id), false, String(id));
});

test("the client never guesses a recipient and does not trust an acknowledgment for another chat", async (t) => {
  setup(t);
  let requests = 0;
  const client = createTelegramClient(
    async () => {
      requests++;
      return Response.json({
        ok: true,
        result: { message_id: 42, chat: { id: 123 } },
      });
    },
    () => undefined,
  );
  await assert.rejects(client.send("Проверка"), {
    message: "telegram_rejected",
  });
  await assert.rejects(client.edit("42", "Оплачено", ""), {
    message: "telegram_rejected",
  });
  assert.equal(requests, 0);
  await assert.rejects(client.send("Проверка", chatId), {
    message: "telegram_unknown",
  });
  await assert.rejects(client.edit("42", "Оплачено", chatId), {
    message: "telegram_unknown",
  });
  assert.equal(requests, 2);
});

test("group membership verifies the exact Telegram identity and status through the existing transport", async (t) => {
  setup(t);
  let member = { user: { id: 42, is_bot: false }, status: "member" };
  const client = createTelegramClient(
    async (url, options) => {
      assert.ok(url.endsWith("/getChatMember"));
      assert.deepEqual(JSON.parse(options.body), {
        chat_id: "-9988",
        user_id: 42,
      });
      assert.equal(options.dispatcher, "test-proxy");
      return Response.json({ ok: true, result: member });
    },
    () => "test-proxy",
  );
  for (const status of ["creator", "administrator", "member"]) {
    member = { user: { id: 42, is_bot: false }, status };
    assert.equal(await client.isGroupMember("-9988", "42"), true);
  }
  for (const status of ["left", "kicked", "restricted"]) {
    member = { user: { id: 42, is_bot: false }, status };
    assert.equal(await client.isGroupMember("-9988", "42"), false);
  }
  member = {
    user: { id: 42, is_bot: false },
    status: "restricted",
    is_member: true,
  };
  assert.equal(await client.isGroupMember("-9988", "42"), true);
  for (const bad of [
    { user: { id: 43 }, status: "member" },
    { user: { id: 42, is_bot: true }, status: "member" },
    { user: { id: 42 }, status: "unknown" },
  ]) {
    member = bad;
    await assert.rejects(client.isGroupMember("-9988", "42"), {
      message: "telegram_unknown",
    });
  }
});
