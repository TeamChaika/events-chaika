import { useEffect, useState } from "react";
import { api } from "./types";
import { Brand, ErrorNotice, Spinner } from "./ui";

export function MarketingLink({ url }: { url?: string | null }) {
  return url ? (
    <p className="marketing-link">
      <a href={url}>Отписаться от рекламных СМС</a>
    </p>
  ) : null;
}

export function UnsubscribePage() {
  const token = location.pathname.split("/")[2] || "";
  const [subscribed, setSubscribed] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ subscribed: boolean }>(`/marketing/${encodeURIComponent(token)}`)
      .then((result) => {
        if (active) setSubscribed(result.subscribed);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function unsubscribe() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ subscribed: boolean }>(
        `/marketing/${encodeURIComponent(token)}/unsubscribe`,
        {
          method: "POST",
          body: "{}",
        },
      );
      setSubscribed(result.subscribed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Brand />
        <a href="/">На афишу</a>
      </header>
      <main>
        <span className="eyebrow quiet">ГАСТРО ДВОР</span>
        <h1>
          {subscribed === false ? "Рекламные СМС отключены" : "Рекламные СМС"}
        </h1>
        <ErrorNotice text={error} />
        {subscribed === undefined && !error && <Spinner />}
        {subscribed === true && (
          <>
            <p>
              Отключить новости о мероприятиях и специальные предложения на ваш
              номер?
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={unsubscribe}
            >
              {busy ? "Отключаем…" : "Отключить рекламные СМС"}
            </button>
          </>
        )}
        {subscribed !== undefined && (
          <p role="status">
            {subscribed === false &&
              "Вы отписались от всех рекламных СМС «Гастро Двора» на этот номер. "}
            Ваши билеты и служебные сообщения по заказам сохраняются.
          </p>
        )}
        <footer className="legal-contact">
          <a href="mailto:event@chaika.team">event@chaika.team</a>
        </footer>
      </main>
    </div>
  );
}
