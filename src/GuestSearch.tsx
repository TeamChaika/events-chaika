import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api } from "./types";
import { ErrorNotice, Spinner } from "./ui";

type SearchOrder = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  group: { issued: number; checked: number; remaining: number };
  tickets: { code: string; ordinal: number; used_at: string | null }[];
};

export function GuestSearch({
  eventId,
  revision,
  busy,
  onSelect,
}: {
  eventId: string;
  revision: number;
  busy: boolean;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<{ query: string }>();
  const [data, setData] = useState<{ orders: SearchOrder[]; more: boolean }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (!submitted) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError("");
    void api<NonNullable<typeof data>>("/checkin/search", {
      method: "POST",
      body: JSON.stringify({ event_id: eventId, query: submitted.query }),
      signal: controller.signal,
    })
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setData(undefined);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [submitted, eventId, revision]);
  return (
    <div className="guest-search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          activeRequest.current?.abort();
          setData(undefined);
          setSubmitted({ query: query.trim() });
        }}
      >
        <label htmlFor="guest-query">Телефон, имя или фамилия покупателя</label>
        <div className="guest-search-form">
          <input
            id="guest-query"
            value={query}
            maxLength={120}
            autoComplete="off"
            placeholder="Например, Иван Петров или 6854"
            onChange={(e) => {
              activeRequest.current?.abort();
              setQuery(e.target.value);
              setSubmitted(undefined);
              setData(undefined);
              setError("");
              setLoading(false);
            }}
          />
          <button
            className="button secondary"
            disabled={!query.trim() || !eventId || loading || busy}
          >
            {loading ? <Spinner /> : <Search size={18} />}Найти
          </button>
        </div>
        <p className="small-text muted">
          От 2 букв или 4 цифр. Имя и фамилия — в любом порядке.
        </p>
      </form>
      <ErrorNotice text={error} />
      <div
        className="guest-search-results"
        aria-live="polite"
        aria-busy={loading}
      >
        {loading && <p>Ищем билеты…</p>}
        {data && !loading && (
          <>
            {!data.orders.length && (
              <p>
                Действующие билеты не найдены. Проверьте данные покупателя и
                выбранное мероприятие.
              </p>
            )}
            {data.more && (
              <p>Найдено больше 20 заказов. Уточните телефон или фамилию.</p>
            )}
            {data.orders.map((order) => (
              <article className="guest-search-order" key={order.id}>
                <h3>
                  {order.first_name} {order.last_name}
                </h3>
                <p>
                  {order.phone} · Заказ {order.id.slice(0, 8)}
                </p>
                <p>
                  Вошли {order.group.checked} из {order.group.issued} · Осталось{" "}
                  {order.group.remaining}
                </p>
                <div className="guest-ticket-statuses">
                  {order.tickets.map((ticket) => (
                    <span
                      key={ticket.code}
                      className={ticket.used_at ? "used" : "unused"}
                    >
                      № {ticket.ordinal} ·{" "}
                      {ticket.used_at ? "вошёл" : "ожидаем"}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="button secondary full"
                  disabled={busy || order.group.remaining === 0}
                  onClick={() => onSelect(order.tickets[0].code)}
                >
                  {order.group.remaining
                    ? "Выбрать количество гостей"
                    : "Все гости уже прошли"}
                </button>
              </article>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
