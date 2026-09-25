import { useState } from "react";
import { api, money, statusLabel } from "./types";
import { ErrorNotice, Modal, Spinner } from "./ui";

export function OrderManagement({
  order,
  close,
  saved,
}: {
  order: {
    id: string;
    first_name: string;
    last_name: string;
    quantity: number;
    checked_count: number;
    total: number;
    status: string;
    is_test: number;
    voided_at: string | null;
    void_reason: string | null;
  };
  close: () => void;
  saved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const paymentPending = ["creating", "pending", "unknown"].includes(
    order.status,
  );
  async function manage(action: "test" | "void") {
    if (busy || reason.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/orders/${order.id}/manage`, {
        method: "POST",
        body: JSON.stringify({
          action,
          reason,
          confirmed,
          isTest: !order.is_test,
        }),
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Управление заказом" close={close}>
      <div className="order-management">
        <h3>
          {order.first_name} {order.last_name}
        </h3>
        <p>
          {order.quantity} бил. · {money(order.total)} ·{" "}
          {statusLabel[order.status]}
        </p>
        <p>
          Вошли: {order.checked_count} из {order.quantity}.
        </p>
        <label>
          Причина изменения
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            disabled={busy}
            placeholder="Например, проверка покупки перед запуском"
          />
        </label>
        <section>
          <h3>
            {order.is_test ? "Тестовый заказ" : "Пометка тестового заказа"}
          </h3>
          <p>
            Тестовые заказы скрыты из рабочего списка, поиска на входе и
            счётчиков гостей. Проход и автоматическая рассылка отключены. Запись
            об оплате сохраняется. Уже переданные сервису сообщения отозвать
            нельзя.
          </p>
          <p>
            Чтобы освободить неиспользованные места, аннулируйте оставшиеся
            проходы ниже.
          </p>
          <button
            className="button secondary full"
            disabled={busy || reason.trim().length < 3}
            onClick={() => manage("test")}
          >
            {order.is_test
              ? "Снять пометку «Тестовый»"
              : "Пометить как тестовый"}
          </button>
        </section>
        <section>
          <h3>Аннулирование проходов</h3>
          {order.voided_at ? (
            <p>
              Аннулированы {new Date(order.voided_at).toLocaleString("ru-RU")}.
              Причина: {order.void_reason}
            </p>
          ) : (
            <>
              <p>
                Оставшиеся проходы будут закрыты. История входа и оплаты
                останется в заказе. Это действие не возвращает деньги покупателю
                и не удаляет персональные данные.
              </p>
              {paymentPending ? (
                <p className="legal-draft">
                  Платёж ещё обрабатывается. Сначала дождитесь результата или
                  перепроверьте оплату.
                </p>
              ) : (
                <>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={busy}
                    />
                    <span>
                      Подтверждаю аннулирование оставшихся проходов по этому
                      заказу. Восстановить их этой кнопкой нельзя.
                    </span>
                  </label>
                  <button
                    className="button secondary full"
                    disabled={busy || !confirmed || reason.trim().length < 3}
                    onClick={() => manage("void")}
                  >
                    Аннулировать оставшиеся проходы
                  </button>
                </>
              )}
            </>
          )}
        </section>
        {busy && <Spinner />}
        <ErrorNotice text={error} />
      </div>
    </Modal>
  );
}
