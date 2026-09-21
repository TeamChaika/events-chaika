import { ProxyAgent } from "undici";

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
        return { message_id: data.message_id };
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
    async send(text) {
      const result = await call("sendMessage", {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text,
      });
      if (!Number.isSafeInteger(result?.message_id))
        throw new Error("telegram_unknown");
      return { status: "sent", providerId: String(result.message_id) };
    },
    async edit(messageId, text) {
      if (
        !/^\d+$/.test(String(messageId)) ||
        !Number.isSafeInteger(Number(messageId))
      )
        throw new Error("telegram_rejected");
      const result = await call("editMessageText", {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        message_id: Number(messageId),
        text,
      });
      if (result?.message_id !== Number(messageId))
        throw new Error("telegram_unknown");
      return { status: "sent", providerId: String(messageId) };
    },
  };
}
export const telegram = createTelegramClient();
