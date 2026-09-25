import { AppError } from "./store.mjs";

// Each explicit opt-in keeps its own evidence. Any previously issued link
// revokes all current consents for the same phone, including later orders.
export function marketingService(store) {
  const findConsent = async (value) => {
    if (!/^[a-f0-9]{48}$/.test(value))
      throw new AppError(404, "Ссылка на подписку не найдена");
    const record = await store.get(
      "SELECT phone FROM sms_consents WHERE unsubscribe_token=?",
      value,
    );
    if (!record) throw new AppError(404, "Ссылка на подписку не найдена");
    return record;
  };
  return {
    linkForOrder: async (orderId) => {
      const record = await store.get(
        "SELECT unsubscribe_token FROM sms_consents WHERE order_id=?",
        orderId,
      );
      return record ? `/unsubscribe/${record.unsubscribe_token}` : null;
    },
    status: async (value) => {
      const record = await findConsent(value);
      const active = await store.get(
        "SELECT order_id FROM sms_consents WHERE phone=? AND withdrawn_at IS NULL LIMIT 1",
        record.phone,
      );
      return { subscribed: Boolean(active) };
    },
    withdraw: (value) =>
      store.transaction(async () => {
        const record = await findConsent(value);
        await store.run(
          "UPDATE sms_consents SET withdrawn_at=? WHERE phone=? AND withdrawn_at IS NULL",
          new Date().toISOString(),
          record.phone,
        );
        return { subscribed: false };
      }),
  };
}
