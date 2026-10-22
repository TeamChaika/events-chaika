import { useEffect, useState } from "react";
import {
  api,
  money,
  type EventData,
  type PriceQuote,
  type PriceTier,
} from "./types";
import "./pricing.css";

export function usePriceQuote(
  eventId: string,
  quantity: number,
  promoCode = "",
  ticketOption = "",
) {
  const [revision, setRevision] = useState(0);
  const requestKey = `${eventId}:${quantity}:${promoCode}:${ticketOption}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    quote?: PriceQuote;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    api<PriceQuote>(
      `/events/${encodeURIComponent(eventId)}/quote?` +
        new URLSearchParams({
          quantity: String(quantity),
          ...(promoCode ? { promo_code: promoCode } : {}),
          ...(ticketOption ? { ticket_option: ticketOption } : {}),
        }),
      { signal: controller.signal },
    )
      .then((quote) => setState({ key: requestKey, quote }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key: requestKey, error: (error as Error).message });
      });
    return () => controller.abort();
  }, [eventId, quantity, promoCode, ticketOption, requestKey]);
  return {
    quote: state?.key === requestKey ? state.quote : undefined,
    quoteError: state?.key === requestKey ? state.error : undefined,
    refreshQuote: () => setRevision((value) => value + 1),
  };
}

export function TicketOptions({
  event,
  value,
  onChange,
  disabled = false,
}: {
  event: EventData;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  if (!event.ticket_options?.length) return null;
  return (
    <fieldset className="ticket-options" disabled={disabled}>
      <legend>Вариант билета</legend>
      {event.ticket_options.map((option) => (
        <label
          key={option.id}
          className={value === option.id ? "selected" : ""}
        >
          <input
            type="radio"
            name="ticket_option"
            value={option.id}
            checked={value === option.id}
            onChange={() => onChange(option.id)}
          />
          <span>{option.label}</span>
          <strong>{money(event.price + option.surcharge)}</strong>
        </label>
      ))}
      <small>Выбранный вариант — для всех гостей в этом заказе.</small>
    </fieldset>
  );
}

export function PriceBreakdown({ quote }: { quote?: PriceQuote }) {
  return (
    <div className="price-breakdown" aria-live="polite">
      {quote ? (
        quote.lines.map((line, index) => (
          <div key={index}>
            <span>
              {line.quantity} × {money(line.unit_price)}
            </span>
            <span>{money(line.total)}</span>
          </div>
        ))
      ) : (
        <p role="status">Уточняем стоимость…</p>
      )}
      {quote?.promo && (
        <div className="promo-summary">
          <span>Скидка по коду {quote.promo.code}</span>
          <strong>−{money(quote.discount_total)}</strong>
        </div>
      )}
      {quote?.promo && quote.promo.discounted_quantity < quote.quantity && (
        <p className="small-text muted">
          Скидка на {quote.promo.discounted_quantity} из {quote.quantity}{" "}
          билетов. Остальные — по полной цене.
        </p>
      )}
    </div>
  );
}

export function PriceSchedule({ tiers }: { tiers: PriceTier[] }) {
  return (
    <ol className="price-schedule" aria-label="Ценовые ступени билетов">
      {tiers.map((tier, index) => (
        <li key={index}>
          <span>
            {index === 0
              ? `Первые ${tier.up_to} билетов`
              : tier.up_to
                ? `Билеты ${tiers[index - 1].up_to! + 1}–${tier.up_to}`
                : `С ${tiers[index - 1].up_to! + 1}-го билета`}
          </span>
          <strong>{money(tier.price)}</strong>
        </li>
      ))}
    </ol>
  );
}
