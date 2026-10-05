import { useEffect, useState } from "react";
import { api, money, type PriceQuote, type PriceTier } from "./types";
import "./pricing.css";

export function usePriceQuote(eventId: string, quantity: number) {
  const [revision, setRevision] = useState(0);
  const requestKey = `${eventId}:${quantity}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    quote?: PriceQuote;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    api<PriceQuote>(
      `/events/${encodeURIComponent(eventId)}/quote?quantity=${quantity}`,
      { signal: controller.signal },
    )
      .then((quote) => setState({ key: requestKey, quote }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key: requestKey, error: (error as Error).message });
      });
    return () => controller.abort();
  }, [eventId, quantity, requestKey]);
  return {
    quote: state?.key === requestKey ? state.quote : undefined,
    quoteError: state?.key === requestKey ? state.error : undefined,
    refreshQuote: () => setRevision((value) => value + 1),
  };
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
