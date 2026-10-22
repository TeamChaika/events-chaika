import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError } from "./store.mjs";
import { checkMerchant, providerConfig, ProviderError } from "./qrm.mjs";

const inputSchema = z
  .object({
    host: z.string().trim().url().max(200),
    key: z
      .string()
      .trim()
      .min(16)
      .max(2048)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict();
function encryptionKey() {
  const value = process.env.QRM_SETTINGS_ENCRYPTION_KEY || "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value)
    throw new AppError(
      503,
      "Защищённое хранение ключей ещё не настроено на сервере",
    );
  return key;
}
function encrypt(config) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from("qrm:livadia:v1"));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(config), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
function decrypt(value) {
  try {
    const body = Buffer.from(value, "base64");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      body.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from("qrm:livadia:v1"));
    cipher.setAuthTag(body.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(body.subarray(28)),
        cipher.final(),
      ]).toString(),
    );
  } catch {
    throw new AppError(
      503,
      "Не удалось прочитать настройки терминала. Обратитесь к администратору",
    );
  }
}
export function paymentSettings(store) {
  const row = () =>
    store.get("SELECT * FROM payment_accounts WHERE id='livadia'");
  return {
    async resolve(account = "default") {
      if (account !== "livadia") return account;
      const saved = await row();
      return saved ? decrypt(saved.encrypted_config) : account;
    },
    async status() {
      const saved = await row();
      let storageReady = false;
      try {
        encryptionKey();
        storageReady = true;
      } catch {
        /* Only readiness is public to admins. */
      }
      return {
        configured: Boolean(saved),
        storageReady,
        firm_name: saved?.firm_name || null,
        merchant_id: saved?.merchant_id || null,
        requires_receipt: saved ? Boolean(saved.requires_receipt) : null,
        updated_at: saved?.updated_at || null,
      };
    },
    async save(input, actor) {
      const data = inputSchema.parse(input);
      encryptionKey();
      const config = {
        ...providerConfig("live", { ...data, mode: "live" }),
        mode: "live",
      };
      let merchant;
      try {
        merchant = await checkMerchant("live", config, { allowUnpinned: true });
      } catch (error) {
        if (error instanceof ProviderError)
          throw new AppError(422, `Ключ не сохранён. ${error.message}`);
        throw new AppError(
          422,
          "Ключ не сохранён: QRM вернул неподтверждённые данные терминала",
        );
      }
      config.merchantId = merchant.merchant_id;
      const encrypted = encrypt(config);
      await store.transaction(async () => {
        const saved = await row();
        const previousMerchant =
          saved?.merchant_id || process.env.QRM_LIVADIA_EXPECTED_MERCHANT_ID;
        if (previousMerchant && previousMerchant !== merchant.merchant_id)
          throw new AppError(
            409,
            "Это другой терминал. Сохранение отменено: прежние платежи должны остаться доступны",
          );
        const previousOrder = await store.get(
          "SELECT merchant_id FROM orders WHERE payment_account='livadia' AND mode='live' AND merchant_id IS NOT NULL AND merchant_id<>? LIMIT 1",
          merchant.merchant_id,
        );
        if (previousOrder)
          throw new AppError(
            409,
            "Нельзя заменить терминал уже созданных платежей",
          );
        await store.run(
          `INSERT INTO payment_accounts (id,encrypted_config,firm_name,merchant_id,requires_receipt,updated_at,updated_by)
          VALUES ('livadia',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_config=excluded.encrypted_config,
          firm_name=excluded.firm_name,merchant_id=excluded.merchant_id,requires_receipt=excluded.requires_receipt,
          updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
          encrypted,
          merchant.firm_name,
          merchant.merchant_id,
          Number(merchant.requires_receipt),
          new Date().toISOString(),
          actor,
        );
        await store.audit("payment_account_updated", "livadia", actor);
      });
      return this.status();
    },
  };
}
