import { ProxyAgent } from "undici";

export function isTelegramChatId(value) {
  // Telegram chat IDs have at most 52 significant bits. Keep their wire/storage form as text.
  return (
    typeof value === "string" &&
    /^-?[1-9]\d{0,15}$/.test(value) &&
    Math.abs(Number(value)) < 2 ** 52
  );
}
export const isTelegramUsername = (value) =>
  typeof value === "string" && /^@[a-zA-Z0-9_]{1,32}$/.test(value);
export const isTelegramChatReference = (value) =>
  isTelegramChatId(value) || isTelegramUsername(value);

let proxy;
export function telegramProxy() {
  const uri = process.env.TELEGRAM_PROXY_URL;
  if (!uri) return undefined;
  if (proxy) return proxy;
  const url = new URL(uri);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("telegram_proxy_invalid");
  const token = process.env.TELEGRAM_PROXY_AUTH;
  if (!token) throw new Error("telegram_proxy_invalid");
  proxy = new ProxyAgent({
    uri: url.origin,
    token,
    proxyTls: { ca: process.env.TELEGRAM_PROXY_CA_CERT || undefined },
    connections: 2,
  });
  return proxy;
}

export function createTelegramClient(
  request = fetch,
  dispatcher = telegramProxy,
) {
  async function call(method, data) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token))
      throw new Error("telegram_rejected");
    try {
      // Only Telegram receives this dispatcher; no global proxy and no direct fallback.
      const response = await request(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: data ? "POST" : "GET",
          redirect: "error",
          dispatcher: dispatcher(),
          signal: AbortSignal.timeout(20000),
          headers: { "Content-Type": "application/json" },
          body: data ? JSON.stringify(data) : undefined,
        },
      );
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 64000) throw new Error("telegram_unknown");
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (
        method === "editMessageText" &&
        body.error_code === 400 &&
        typeof body.description === "string" &&
        body.description.startsWith("Bad Request: message is not modified")
      )
        return { message_id: data.message_id, chat: { id: data.chat_id } };
      if (!response.ok || body.ok !== true)
        throw new Error(
          body.ok === false ? "telegram_rejected" : "telegram_unknown",
        );
      return body.result;
    } catch (error) {
      // URLs contain the bot token. Never expose transport messages or retry an uncertain POST.
      throw new Error(
        error.message === "telegram_rejected"
          ? "telegram_rejected"
          : "telegram_unknown",
      );
    }
  }
  return {
    async resolveChat(username) {
      if (!isTelegramUsername(username)) throw new Error("telegram_rejected");
      const chat = await call("getChat", { chat_id: username });
      const id = String(chat?.id);
      const usernames = [
        chat?.username,
        ...(Array.isArray(chat?.active_usernames) ? chat.active_usernames : []),
      ];
      if (
        !isTelegramChatId(id) ||
        !usernames.some(
          (name) =>
            typeof name === "string" &&
            "@" + name.toLowerCase() === username.toLowerCase(),
        )
      )
        throw new Error("telegram_unknown");
      return id;
    },
    async isGroupMember(chatId, userId) {
      if (
        !/^-\d+$/.test(String(chatId)) ||
        !Number.isSafeInteger(Number(chatId)) ||
        !/^\d+$/.test(String(userId)) ||
        !Number.isSafeInteger(Number(userId)) ||
        Number(userId) <= 0
      )
        throw new Error("telegram_rejected");
      const member = await call("getChatMember", {
        chat_id: String(chatId),
        user_id: Number(userId),
      });
      if (
        member?.user?.id !== Number(userId) ||
        member.user.is_bot ||
        ![
          "creator",
          "administrator",
          "member",
          "restricted",
          "left",
          "kicked",
        ].includes(member.status)
      )
        throw new Error("telegram_unknown");
      return (
        ["creator", "administrator", "member"].includes(member.status) ||
        (member.status === "restricted" && member.is_member === true)
      );
    },
    async check() {
      const bot = await call("getMe");
      if (bot?.is_bot !== true || typeof bot.username !== "string")
        throw new Error("telegram_unknown");
      return {
        ready: true,
        username: bot.username,
        proxy: Boolean(dispatcher()),
      };
    },
    async send(text, chatId) {
      if (!isTelegramChatId(chatId)) throw new Error("telegram_rejected");
      const result = await call("sendMessage", {
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
      });
      if (
        !Number.isSafeInteger(result?.message_id) ||
        result.message_id <= 0 ||
        String(result.chat?.id) !== chatId
      )
        throw new Error("telegram_unknown");
      return { status: "sent", providerId: String(result.message_id) };
    },
    async edit(messageId, text, chatId) {
      if (
        !isTelegramChatId(chatId) ||
        !/^[1-9]\d*$/.test(String(messageId)) ||
        !Number.isSafeInteger(Number(messageId))
      )
        throw new Error("telegram_rejected");
      const result = await call("editMessageText", {
        chat_id: chatId,
        message_id: Number(messageId),
        text,
        link_preview_options: { is_disabled: true },
      });
      if (
        result?.message_id !== Number(messageId) ||
        String(result?.chat?.id) !== chatId
      )
        throw new Error("telegram_unknown");
      return { status: "sent", providerId: String(messageId) };
    },
  };
}
export const telegram = createTelegramClient();
