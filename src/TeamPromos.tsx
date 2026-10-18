import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { money } from "./types";
import {
  PromoCodeFields,
  promoRule,
  type PromoDraft,
  type PromoRule,
  type PromoUsage,
} from "./AdminPriceRules";

type PromoList = { promos: PromoRule[]; usage: PromoUsage };
type Call = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
const emptyPromo: PromoDraft = {
  code: "",
  kind: "fixed",
  value: "",
  active: true,
  limit_scope: "orders",
  max_uses: "",
  starts_at: "",
  ends_at: "",
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  });

export function TeamPromos({
  eventId,
  canEdit,
  call,
}: {
  eventId: string;
  canEdit: boolean;
  call: Call;
}) {
  const [data, setData] = useState<PromoList>();
  const [draft, setDraft] = useState<PromoDraft>(emptyPromo);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const path = `/events/${encodeURIComponent(eventId)}/promos`;
  const load = useCallback(() => call<PromoList>(path), [call, path]);
  useEffect(() => {
    let active = true;
    void load()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [load]);
  async function refresh() {
    setError("");
    try {
      setData(await load());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const saved = await call<PromoRule>(path, "POST", promoRule(draft));
      setData((value) => ({
        promos: [...(value?.promos || []), saved],
        usage: value?.usage || {},
      }));
      setSuccess(`Промокод ${saved.code} создан`);
      setCreating(false);
      setDraft(emptyPromo);
    } catch (e) {
      setError(
        `${(e as Error).message} Перед повторным созданием обновите список: код мог сохраниться.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Промокоды мероприятия">
      <div className="team-section-title">
        <h2>Промокоды</h2>
        <button
          className="team-icon"
          aria-label="Обновить промокоды"
          disabled={busy}
          onClick={refresh}
        >
          <RefreshCw size={18} />
        </button>
        {canEdit && (
          <button
            className="team-primary small"
            disabled={busy || !data || data.promos.length >= 100}
            onClick={() => setCreating(!creating)}
          >
            <Plus size={17} />
            Добавить
          </button>
        )}
      </div>
      {error && (
        <div className="team-error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="team-success" role="status">
          {success}
        </div>
      )}
      {creating && (
        <form className="team-form team-promo-form" onSubmit={create}>
          <h3>Новый промокод</h3>
          <p className="team-note">
            Скидка на каждый билет. Один код на заказ. Время Ялты и Москвы
            (UTC+3).
          </p>
          <fieldset disabled={busy}>
            <PromoCodeFields
              row={draft}
              update={(patch) => setDraft((value) => ({ ...value, ...patch }))}
            />
          </fieldset>
          <button className="team-primary" disabled={busy}>
            {busy ? "Сохраняем…" : "Создать промокод"}
          </button>
          <button
            type="button"
            className="team-text-link"
            disabled={busy}
            onClick={() => setCreating(false)}
          >
            Отмена
          </button>
        </form>
      )}
      {!data && !error && <p role="status">Загружаем промокоды…</p>}
      {data?.promos.length === 0 && !creating && (
        <p className="team-note">Промокоды пока не добавлены.</p>
      )}
      {data?.promos.map((promo) => {
        const counts = data.usage[promo.code];
        const paid = counts?.[`paid_${promo.limit_scope}`] || 0;
        const held = counts?.[`held_${promo.limit_scope}`] || 0;
        const status = !promo.active
          ? "Отключён"
          : promo.ends_at && Date.parse(promo.ends_at) <= Date.now()
            ? "Завершён"
            : promo.starts_at && Date.parse(promo.starts_at) > Date.now()
              ? "Запланирован"
              : promo.max_uses !== null && paid + held >= promo.max_uses
                ? "Лимит занят"
                : "Активен";
        return (
          <article className="team-link-card" key={promo.code}>
            <div className="team-link-heading">
              <h3>{promo.code}</h3>
              <span className="team-badge">{status}</span>
            </div>
            <p>
              Скидка{" "}
              {promo.kind === "fixed"
                ? money(promo.value)
                : `${promo.value / 100}%`}{" "}
              на билет
            </p>
            <p>
              {promo.limit_scope === "orders" ? "По заказам" : "По билетам"} ·{" "}
              {promo.max_uses === null
                ? "Без ограничения количества"
                : `Лимит: ${promo.max_uses}`}
            </p>
            <p>
              Использовано: {paid} · В резерве: {held}
              {promo.max_uses !== null &&
                ` · Осталось: ${Math.max(0, promo.max_uses - paid - held)}`}
            </p>
            <p>
              {promo.starts_at
                ? `С ${dateLabel(promo.starts_at)}`
                : "Без даты начала"}{" "}
              ·{" "}
              {promo.ends_at
                ? `До ${dateLabel(promo.ends_at)}`
                : "Без даты окончания"}
            </p>
          </article>
        );
      })}
      <p className="team-note">
        Промокоды общие с админкой сайта. Незавершённые заказы резервируют
        лимит. Изменить или отключить существующий код можно в админке: «Билеты
        и цены».
      </p>
    </section>
  );
}
