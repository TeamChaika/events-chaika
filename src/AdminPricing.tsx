import { useEffect, useState, type FormEvent } from "react";
import { Check, RefreshCw } from "lucide-react";
import { api, ApiError, money } from "./types";
import { ErrorNotice, Modal, Spinner } from "./ui";
import "./pricing.css";

type PricingSettings = {
  revision: string;
  capacity: number;
  occupied: number;
  tiers: { quantity: number; price: number; paid: number; reserved: number }[];
};
type DraftTier = { quantity: string; price: string };

export function AdminPricing({
  eventId,
  title,
  close,
  saved,
}: {
  eventId: string;
  title: string;
  close: () => void;
  saved: () => void;
}) {
  const [settings, setSettings] = useState<PricingSettings>();
  const [draft, setDraft] = useState<DraftTier[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<PricingSettings>(
      `/admin/events/${encodeURIComponent(eventId)}/pricing`,
      { signal: controller.signal },
    )
      .then((result) => {
        setSettings(result);
        setDraft(
          result.tiers.map((tier) => ({
            quantity: String(tier.quantity),
            price: String(tier.price / 100),
          })),
        );
        setMustReload(false);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [eventId, reload]);
  const quantity = draft.reduce(
    (n, tier) => n + (Number(tier.quantity) || 0),
    0,
  );
  const changed =
    settings &&
    draft.some(
      (tier, index) =>
        Number(tier.quantity) !== settings.tiers[index].quantity ||
        Math.round(Number(tier.price) * 100) !== settings.tiers[index].price,
    );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!settings || busy || loading || mustReload) return;
    setError("");
    const tiers = draft.map((tier) => ({
      quantity: Number(tier.quantity),
      price: Math.round(Number(tier.price) * 100),
    }));
    if (quantity > 100000 || quantity < settings.occupied) {
      setError(
        `Общий лимит должен быть от ${Math.max(1, settings.occupied)} до 100 000 мест.`,
      );
      return;
    }
    if (
      tiers.some(
        (tier, index) => index > 0 && tier.price <= tiers[index - 1].price,
      )
    ) {
      setError("Цена каждой следующей ступени должна быть выше предыдущей.");
      return;
    }
    setBusy(true);
    try {
      await api(`/admin/events/${encodeURIComponent(eventId)}/pricing`, {
        method: "PUT",
        body: JSON.stringify({ revision: settings.revision, tiers }),
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
      if (
        e instanceof ApiError &&
        ["PRICING_STALE", "PRICING_CAPACITY"].includes(e.code || "")
      )
        setMustReload(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Билеты и цены"
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <p className="muted">{title}</p>
      {loading ? (
        <Spinner />
      ) : (
        settings && (
          <form onSubmit={submit} className="admin-pricing-form">
            <p className="small-text muted">
              Укажите полное количество билетов в каждой ступени, включая уже
              проданные и резерв. Цены применяются к новым заказам; оформленные
              заказы сохраняют свою стоимость.
            </p>
            <fieldset
              disabled={busy || mustReload}
              className="admin-pricing-fields"
            >
              {draft.map((tier, index) => {
                const stats = settings.tiers[index];
                const occupied = stats.paid + stats.reserved;
                return (
                  <div className="admin-pricing-tier" key={index}>
                    <h3>
                      {draft.length > 1 ? `Ступень ${index + 1}` : "Билеты"}
                    </h3>
                    <div className="form-row">
                      <label>
                        Количество билетов
                        <input
                          aria-label={`Количество билетов, ступень ${index + 1}`}
                          type="number"
                          min={Math.max(1, occupied)}
                          max="100000"
                          step="1"
                          required
                          value={tier.quantity}
                          onChange={(e) =>
                            setDraft(
                              draft.map((row, i) =>
                                i === index
                                  ? { ...row, quantity: e.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Цена за билет, ₽
                        <input
                          aria-label={`Цена за билет, ступень ${index + 1}`}
                          type="number"
                          min="1"
                          max="1000000"
                          step="0.01"
                          required
                          value={tier.price}
                          onChange={(e) =>
                            setDraft(
                              draft.map((row, i) =>
                                i === index
                                  ? { ...row, price: e.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <p className="admin-pricing-counts">
                      Оплачено: <b>{stats.paid}</b> · В резерве:{" "}
                      <b>{stats.reserved}</b> · Свободно в квоте:{" "}
                      <b>{Math.max(0, Number(tier.quantity) - occupied)}</b>
                    </p>
                    {stats.paid + stats.reserved > 0 && (
                      <p className="small-text muted">
                        Стоимость ранее оформленных заказов может отличаться от{" "}
                        {money(stats.price)}.
                      </p>
                    )}
                  </div>
                );
              })}
            </fieldset>
            <div className="admin-pricing-summary">
              <span>Общий лимит гостей</span>
              <strong>{quantity.toLocaleString("ru-RU")}</strong>
            </div>
            <p className="small-text muted">
              Занято мест: {settings.occupied}. Пригласительные занимают места в
              зале, но не расходуют ценовые квоты. Тестовые заказы в квоты не
              входят.
            </p>
            <ErrorNotice text={error} />
            {mustReload && (
              <button
                className="button secondary full"
                type="button"
                onClick={() => setReload((n) => n + 1)}
              >
                <RefreshCw size={16} />
                Загрузить актуальные настройки
              </button>
            )}
            <button
              className="button primary full"
              disabled={busy || mustReload || !changed}
            >
              {busy ? <Spinner /> : <Check size={18} />}Сохранить количество и
              цены
            </button>
          </form>
        )
      )}
      {!settings && !loading && (
        <>
          <ErrorNotice text={error} />
          <button
            className="button secondary"
            onClick={() => setReload((n) => n + 1)}
          >
            Повторить загрузку
          </button>
        </>
      )}
    </Modal>
  );
}
