import { useEffect, useState, type FormEvent } from "react";
import { api } from "./types";
import { ErrorNotice, Spinner } from "./ui";

type Terminal = {
  configured: boolean;
  storageReady: boolean;
  firm_name: string | null;
  merchant_id: string | null;
  requires_receipt: boolean | null;
  updated_at: string | null;
};
export function PaymentSettings() {
  const [terminal, setTerminal] = useState<Terminal>();
  const [key, setKey] = useState("");
  const [host, setHost] = useState("https://app.wapiserv.qrm.ooo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<Terminal>("/admin/qrm/livadia")
      .then(setTerminal)
      .catch((e: Error) => setError(e.message));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      setTerminal(
        await api<Terminal>("/admin/qrm/livadia", {
          method: "PUT",
          body: JSON.stringify({ host, key }),
        }),
      );
      setKey("");
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="integration-card qrm-settings"
      aria-labelledby="livadia-qrm-heading"
    >
      <div className="admin-section-title">
        <h2 id="livadia-qrm-heading">СБП · Ливадия</h2>
      </div>
      <p>
        Отдельный терминал для «Одиссеи». Проверка ключа не создаёт платёж и не
        открывает продажи.
      </p>
      {terminal?.configured && (
        <p>
          Подключён: <strong>{terminal.firm_name}</strong>
          <br />
          Терминал: {terminal.merchant_id}
          <br />
          Чеки QRM: {terminal.requires_receipt ? "включены" : "выключены"}.
        </p>
      )}
      {terminal && !terminal.storageReady && (
        <p role="status">
          Сохранение ключей временно недоступно. Требуется настройка сервера.
        </p>
      )}
      <form onSubmit={submit}>
        <div className="form-row">
          <label>
            Адрес API QRM
            <input
              type="url"
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            {terminal?.configured ? "Новый API-ключ" : "API-ключ Ливадии"}
            <input
              type="password"
              required
              minLength={16}
              maxLength={2048}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              disabled={busy}
            />
          </label>
        </div>
        <p className="muted">
          Ключ скрывается после сохранения. При замене допускается только тот же
          терминал.
        </p>
        <ErrorNotice text={error} />
        {saved && (
          <p role="status">
            Ключ проверен и сохранён. Для открытия продаж включите их в
            настройках мероприятия.
          </p>
        )}
        <button
          className="button secondary"
          disabled={busy || !terminal?.storageReady}
        >
          {busy && <Spinner />}{" "}
          {busy ? "Проверяем терминал…" : "Проверить и сохранить"}
        </button>
      </form>
    </section>
  );
}
