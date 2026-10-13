export type ScheduleDraft = { starts_at: string; price: string };
export type PromoDraft = {
  code: string;
  kind: "fixed" | "percent";
  value: string;
  active: boolean;
};
export const moscowInput = (iso: string) =>
  new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 16);

export function AdminPriceRules({
  schedule,
  setSchedule,
  promos,
  setPromos,
}: {
  schedule: ScheduleDraft[];
  setSchedule: (rows: ScheduleDraft[]) => void;
  promos: PromoDraft[];
  setPromos: (rows: PromoDraft[]) => void;
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
          мероприятия, без лимита использований, пока включены. Минимальная цена
          после скидки — 1 ₽.
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
          return (
            <div className="admin-pricing-tier" key={index}>
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
                  onChange={(e) =>
                    update({ code: e.target.value.toUpperCase() })
                  }
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
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={row.active}
                  onChange={(e) => update({ active: e.target.checked })}
                />
                Код активен
              </label>
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
              { code: "", kind: "fixed", value: "", active: true },
            ])
          }
        >
          Добавить промокод
        </button>
      </section>
    </>
  );
}
