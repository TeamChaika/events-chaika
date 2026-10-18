export type ScheduleDraft = { starts_at: string; price: string };
export type PromoDraft = {
  code: string;
  kind: "fixed" | "percent";
  value: string;
  active: boolean;
  limit_scope: "orders" | "tickets";
  max_uses: string;
  starts_at: string;
  ends_at: string;
};
export type PromoRule = Omit<
  PromoDraft,
  "value" | "max_uses" | "starts_at" | "ends_at"
> & {
  value: number;
  max_uses: number | null;
  starts_at: string | null;
  ends_at: string | null;
};
export type PromoUsage = Record<
  string,
  {
    paid_orders: number;
    held_orders: number;
    paid_tickets: number;
    held_tickets: number;
  }
>;
export const moscowInput = (iso: string) =>
  new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 16);
export const promoDraft = (row: PromoRule): PromoDraft => ({
  ...row,
  value: String(row.value / 100),
  max_uses: row.max_uses === null ? "" : String(row.max_uses),
  starts_at: row.starts_at ? moscowInput(row.starts_at) : "",
  ends_at: row.ends_at ? moscowInput(row.ends_at) : "",
});

export function AdminPriceRules({
  schedule,
  setSchedule,
  promos,
  setPromos,
  usage,
}: {
  schedule: ScheduleDraft[];
  setSchedule: (rows: ScheduleDraft[]) => void;
  promos: PromoDraft[];
  setPromos: (rows: PromoDraft[]) => void;
  usage: PromoUsage;
}) {
  return (
    <>
      <section
        className="admin-price-rules"
        aria-labelledby="scheduled-prices-title"
      >
        <h3 id="scheduled-prices-title">Цена по дате</h3>
        <p className="small-text muted">
          Время Ялты и Москвы (UTC+3). До первой даты работают ценовые ступени
          выше. С указанного момента действует заданная цена за каждый билет
          независимо от количества продаж — до следующей даты.
        </p>
        {!schedule.length && (
          <p className="small-text muted">Изменения по датам пока не заданы.</p>
        )}
        {schedule.map((row, index) => (
          <div className="admin-pricing-tier" key={index}>
            <div className="form-row">
              <label>
                Начало действия
                <input
                  aria-label={`Начало действия цены ${index + 1}`}
                  type="datetime-local"
                  required
                  value={row.starts_at}
                  onChange={(e) =>
                    setSchedule(
                      schedule.map((item, i) =>
                        i === index
                          ? { ...item, starts_at: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Цена за билет, ₽
                <input
                  aria-label={`Цена по дате ${index + 1}`}
                  type="number"
                  min="1"
                  max="1000000"
                  step="0.01"
                  required
                  value={row.price}
                  onChange={(e) =>
                    setSchedule(
                      schedule.map((item, i) =>
                        i === index ? { ...item, price: e.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="text-link"
              aria-label={`Удалить дату ${index + 1}`}
              onClick={() =>
                setSchedule(schedule.filter((_, i) => i !== index))
              }
            >
              Удалить дату
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={schedule.length >= 30}
          onClick={() =>
            setSchedule([...schedule, { starts_at: "", price: "" }])
          }
        >
          Добавить дату
        </button>
      </section>
      <section
        className="admin-price-rules"
        aria-labelledby="promo-codes-title"
      >
        <h3 id="promo-codes-title">Промокоды</h3>
        <p className="small-text muted">
          Один код на заказ. Скидка применяется к каждому билету после расчёта
          цены по количеству или дате. Коды действуют только для этого
          мероприятия. Минимальная цена после скидки — 1 ₽. Незавершённая оплата
          резервирует лимит; подтверждённая отмена или истечение оплаты
          освобождает его.
        </p>
        {!promos.length && (
          <p className="small-text muted">Промокоды пока не добавлены.</p>
        )}
        {promos.map((row, index) => {
          const update = (patch: Partial<PromoDraft>) =>
            setPromos(
              promos.map((item, i) =>
                i === index ? { ...item, ...patch } : item,
              ),
            );
          const counts = usage[row.code.trim().toUpperCase()];
          return (
            <div className="admin-pricing-tier" key={index}>
              <PromoCodeFields
                row={row}
                index={index}
                update={update}
                counts={counts}
              />
              <button
                type="button"
                className="text-link"
                aria-label={`Удалить промокод ${index + 1}`}
                onClick={() => setPromos(promos.filter((_, i) => i !== index))}
              >
                Удалить код
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="button secondary"
          disabled={promos.length >= 100}
          onClick={() =>
            setPromos([
              ...promos,
              {
                code: "",
                kind: "fixed",
                value: "",
                active: true,
                limit_scope: "orders",
                max_uses: "",
                starts_at: "",
                ends_at: "",
              },
            ])
          }
        >
          Добавить промокод
        </button>
      </section>
    </>
  );
}

export function PromoCodeFields({
  row,
  index = 0,
  update,
  counts,
}: {
  row: PromoDraft;
  index?: number;
  update: (patch: Partial<PromoDraft>) => void;
  counts?: PromoUsage[string];
}) {
  return (
    <>
      <label>
        Код
        <input
          aria-label={`Промокод ${index + 1}`}
          required
          minLength={2}
          maxLength={32}
          value={row.code}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => update({ code: e.target.value.toUpperCase() })}
        />
      </label>
      <div className="form-row">
        <label>
          Тип скидки
          <select
            aria-label={`Тип скидки ${index + 1}`}
            value={row.kind}
            onChange={(e) =>
              update({
                kind: e.target.value as PromoDraft["kind"],
                value: "",
              })
            }
          >
            <option value="fixed">Рубли за каждый билет</option>
            <option value="percent">Процент от каждого билета</option>
          </select>
        </label>
        <label>
          {row.kind === "fixed" ? "Скидка, ₽" : "Скидка, %"}
          <input
            aria-label={`Размер скидки ${index + 1}`}
            type="number"
            required
            min={row.kind === "fixed" ? 1 : 0.01}
            max={row.kind === "fixed" ? 1000000 : 99}
            step="0.01"
            value={row.value}
            onChange={(e) => update({ value: e.target.value })}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Считать использования
          <select
            aria-label={`Считать использования ${index + 1}`}
            value={row.limit_scope}
            onChange={(e) =>
              update({
                limit_scope: e.target.value as PromoDraft["limit_scope"],
              })
            }
          >
            <option value="orders">По заказам</option>
            <option value="tickets">По билетам</option>
          </select>
        </label>
        <label>
          Лимит
          <select
            aria-label={`Режим лимита ${index + 1}`}
            value={
              row.max_uses === ""
                ? "unlimited"
                : row.max_uses === "1"
                  ? "once"
                  : "limited"
            }
            onChange={(e) =>
              update({
                max_uses:
                  e.target.value === "unlimited"
                    ? ""
                    : e.target.value === "once"
                      ? "1"
                      : "2",
              })
            }
          >
            <option value="unlimited">Без ограничений</option>
            <option value="once">Одно использование</option>
            <option value="limited">Задать количество</option>
          </select>
        </label>
      </div>
      {row.max_uses !== "" && (
        <label>
          Всего {row.limit_scope === "orders" ? "заказов" : "билетов"} со
          скидкой
          <input
            aria-label={`Количество использований ${index + 1}`}
            type="number"
            min="1"
            max="1000000"
            step="1"
            required
            value={row.max_uses}
            onChange={(e) => update({ max_uses: e.target.value })}
          />
        </label>
      )}
      <p className="small-text muted">
        {row.limit_scope === "orders"
          ? "Один заказ — одно использование. Скидка на каждый билет заказа."
          : "Одно использование — один билет со скидкой. Если лимита не хватит, остальные билеты будут по полной цене."}{" "}
        Оплачено: {counts?.[`paid_${row.limit_scope}`] || 0}. В резерве:{" "}
        {counts?.[`held_${row.limit_scope}`] || 0}. Счётчики сохраняются при
        отключении и повторном добавлении кода.
      </p>
      <div className="form-row">
        <label>
          Действует с (UTC+3)
          <input
            aria-label={`Начало промокода ${index + 1}`}
            type="datetime-local"
            value={row.starts_at}
            onChange={(e) => update({ starts_at: e.target.value })}
          />
        </label>
        <label>
          Действует до (UTC+3)
          <input
            aria-label={`Окончание промокода ${index + 1}`}
            type="datetime-local"
            value={row.ends_at}
            onChange={(e) => update({ ends_at: e.target.value })}
          />
        </label>
      </div>
      <p className="small-text muted">
        Пустые даты — без ограничения по времени. В момент окончания код
        перестаёт действовать.
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={row.active}
          onChange={(e) => update({ active: e.target.checked })}
        />
        Код активен
      </label>
    </>
  );
}

export function promoRule(row: PromoDraft): PromoRule {
  return {
    ...row,
    code: row.code.trim().toUpperCase(),
    value: Math.round(Number(row.value) * 100),
    max_uses: row.max_uses === "" ? null : Number(row.max_uses),
    starts_at: row.starts_at
      ? new Date(`${row.starts_at}:00+03:00`).toISOString()
      : null,
    ends_at: row.ends_at
      ? new Date(`${row.ends_at}:00+03:00`).toISOString()
      : null,
  };
}
