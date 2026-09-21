import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  MapPin,
  Clock3,
  Ticket,
  X,
  Minus,
  Plus,
  Check,
  ShieldCheck,
  Smartphone,
  Mail,
  ChevronLeft,
  Download,
  LoaderCircle,
} from "lucide-react";
import { Admin } from "./Admin";
import {
  api,
  money,
  dateLabel,
  statusLabel,
  type EventData,
  type Config,
  type OrderData,
  type TicketData,
} from "./types";
import {
  Brand,
  ContactPhone,
  ErrorNotice,
  Spinner,
  Modal,
  GuestFields,
} from "./ui";
import { MoonScene } from "./MoonScene";
import { MoonLoader } from "./MoonLoader";
import { CinematicIntro } from "./CinematicIntro";
import {
  useIntroPlayback,
  MOON_INTRO_IMAGES,
  MOON_INTRO_DURATION,
} from "./useIntroPlayback";
import { TicketCard } from "./TicketCard";

function Bat({ index }: { index: number }) {
  return (
    <div className={"bat bat-" + index}>
      <svg viewBox="0 0 160 70" aria-hidden="true">
        <g className="bat-left">
          <path d="M80 38C64 15 31 18 1 1 13 21 13 33 11 46 28 31 35 41 40 53 54 42 65 47 76 62Z" />
        </g>
        <g className="bat-right">
          <path d="M80 38C96 15 129 18 159 1 147 21 147 33 149 46 132 31 125 41 120 53 106 42 95 47 84 62Z" />
        </g>
        <path d="M73 29 73 16 80 26 87 16 87 30Q100 45 80 67 60 45 73 29Z" />
      </svg>
    </div>
  );
}
function Countdown({ event }: { event: EventData }) {
  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(
      0,
      new Date(`${event.date}T${event.time}:00+03:00`).getTime() - time,
    ),
    days = Math.floor(diff / 86400000),
    hours = Math.floor(diff / 3600000) % 24,
    mins = Math.floor(diff / 60000) % 60,
    secs = Math.floor(diff / 1000) % 60;
  return (
    <div className="countdown" role="timer" aria-label="До начала мероприятия">
      <span className="micro muted">ДО НАЧАЛА НОЧИ</span>
      <div>
        {[
          [days, "ДНЕЙ"],
          [hours, "ЧАСОВ"],
          [mins, "МИНУТ"],
          [secs, "СЕКУНД"],
        ].map(([n, label], i) => (
          <React.Fragment key={label}>
            <span className="count-unit">
              <b>{String(n).padStart(2, "0")}</b>
              <small>{label}</small>
            </span>
            {i < 3 && <span className="count-colon">:</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
function Home() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [config, setConfig] = useState<Config>();
  const [error, setError] = useState("");
  const {
    ready: moonReady,
    playing: moonPlaying,
    finished: minimumElapsed,
  } = useIntroPlayback(MOON_INTRO_IMAGES, MOON_INTRO_DURATION);
  const [artworkReady, setArtworkReady] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [revealing, setRevealing] = useState(false);
  const selected = new URLSearchParams(location.search).get("event");
  const event = events.find((e) => e.id === selected) || events[0];

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => {
      controller.abort();
      setError(
        "Не удалось загрузить афишу. Проверьте соединение и попробуйте ещё раз.",
      );
    }, 15000);
    Promise.all([
      api<EventData[]>("/events", { signal: controller.signal }),
      api<Config>("/config", { signal: controller.signal }),
    ])
      .then(([e, c]) => {
        if (!active) return;
        setEvents(e);
        setConfig(c);
      })
      .catch((e: Error) => {
        if (active && !controller.signal.aborted) setError(e.message);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!event) return;
    // An unavailable poster must never trap the guest behind the intro.
    const timeout = setTimeout(() => setArtworkReady(true), 4000);
    return () => clearTimeout(timeout);
  }, [event]);

  useEffect(() => {
    if (!event || !config || !minimumElapsed || !artworkReady) return;
    setRevealing(true);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeout = setTimeout(() => setShowIntro(false), reduced ? 0 : 550);
    return () => clearTimeout(timeout);
  }, [event, config, minimumElapsed, artworkReady]);

  const introActive = showIntro && !error && (!config || Boolean(event));
  return (
    <>
      {introActive && (
        <MoonLoader
          revealing={revealing}
          ready={moonReady}
          playing={moonPlaying}
        />
      )}
      {error ? (
        <div className="loading-screen">
          <Brand />
          <ErrorNotice text={error} />
          <button className="button primary" onClick={() => location.reload()}>
            Попробовать ещё раз
          </button>
        </div>
      ) : event && config ? (
        <EventLanding
          event={event}
          config={config}
          introActive={introActive}
          onArtworkReady={() => setArtworkReady(true)}
        />
      ) : config ? (
        <div className="loading-screen">
          <Brand />
          <p>Афиша скоро появится.</p>
          <a href="/admin">Управление событиями</a>
        </div>
      ) : null}
    </>
  );
}

function EventLanding({
  event,
  config,
  introActive,
  onArtworkReady,
}: {
  event: EventData;
  config: Config;
  introActive: boolean;
  onArtworkReady: () => void;
}) {
  const [buy, setBuy] = useState(false);
  const [paused] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [privacy, setPrivacy] = useState(false);
  const canBuy =
    Boolean(event.sales_open) &&
    event.available > 0 &&
    new Date(`${event.date}T${event.time}:00+03:00`) > new Date();
  return (
    <div
      className={"public-app " + (paused ? "motion-paused" : "")}
      inert={introActive}
      aria-hidden={introActive || undefined}
    >
      {(config.demo || config.paymentMode === "sandbox") && (
        <div className="preview-banner">
          <span /> ПРЕДПРОСМОТР <i />{" "}
          {config.demo
            ? "Тестовая оплата · деньги не списываются"
            : "Тестовый терминал QRM"}
        </div>
      )}
      <main>
        <section
          className={
            "hero" + (event.title === "Ночь красной луны" ? "" : " hero-custom")
          }
          aria-labelledby="event-title"
        >
          <div className="hero-art" aria-hidden="true">
            <div className="hero-scene">
              <img
                src={event.hero_image}
                alt=""
                fetchPriority="high"
                onLoad={onArtworkReady}
                onError={onArtworkReady}
              />
              {event.hero_image === "/assets/red-moon.png" && (
                <MoonScene paused={paused || introActive} />
              )}
            </div>
            <div className="mist mist-one" />
            <div className="mist mist-two" />
          </div>
          <div className="bats" aria-hidden="true">
            {[2, 3, 4, 5, 6].map((i) => (
              <Bat key={i} index={i} />
            ))}
          </div>
          <div className="hero-side-label">
            HALLOWEEN NIGHT · {event.date.slice(0, 4)}
          </div>
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> {event.subtitle}{" "}
              <span className="age-label">{event.age}+</span>
            </div>
            <h1 id="event-title">
              {event.title === "Ночь красной луны" ? (
                <>
                  <span>НОЧЬ</span>
                  <span className="red-title">КРАСНОЙ</span>
                  <span className="last-title">ЛУНЫ</span>
                </>
              ) : (
                event.title.toUpperCase()
              )}
            </h1>
            <p className="hero-description">
              <span>Одна ночь. Два танцпола.</span>
              <span>Красная луна. Иная реальность.</span>
            </p>
            <div className="event-meta">
              <span>
                <CalendarDays size={17} />
                {dateLabel(event.date)}
              </span>
              <i />
              <span>
                <Clock3 size={17} />
                {event.time}
              </span>
            </div>
            <div className="venue-brands">
              <Brand />
            </div>
            <a
              className="event-location"
              href={`https://yandex.ru/maps/?text=${encodeURIComponent(event.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${event.venue}, ${event.address} — открыть в Яндекс Картах, новая вкладка`}
            >
              <MapPin size={18} aria-hidden="true" />
              <span className="location-copy">
                <strong>{event.venue}</strong>
                <span>{event.address}</span>
              </span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
            <ContactPhone />
            <div className="hero-actions">
              <button
                className="button primary ticket-cta"
                disabled={!canBuy}
                onClick={() => setBuy(true)}
              >
                <Ticket size={19} />
                {canBuy ? "Быть частью ночи" : "Продажа закрыта"}
                <ArrowUpRight size={21} />
              </button>
              <div className="hero-price">
                <strong>{money(event.price)}</strong>
                <span>за одного гостя</span>
              </div>
            </div>
          </div>
          <div className="hero-countdown">
            <Countdown event={event} />
          </div>
        </section>
        <div className="marquee" aria-hidden="true">
          <div>
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i}>
                ОДНА НОЧЬ. ДВА ТАНЦПОЛА. <i /> КРАСНАЯ ЛУНА. ИНАЯ РЕАЛЬНОСТЬ.
                <i />
              </span>
            ))}
          </div>
        </div>
      </main>
      <footer className="public-footer">
        <span>Создаём поводы быть вместе.</span>
        <button className="plain" onClick={() => setPrivacy(true)}>
          Конфиденциальность
        </button>
        <small>@ Чайка Тим, 2026</small>
      </footer>
      <div className="mobile-buy-bar" hidden={buy || privacy || introActive}>
        <div className="hero-price">
          <strong>{money(event.price)}</strong>
          <span>за одного гостя</span>
        </div>
        <button
          className="button primary"
          disabled={!canBuy}
          onClick={() => setBuy(true)}
        >
          <Ticket size={18} aria-hidden="true" />
          {canBuy ? "Купить билет" : "Продажа закрыта"}
          <ArrowUpRight size={19} aria-hidden="true" />
        </button>
      </div>
      {buy && (
        <Checkout event={event} config={config} close={() => setBuy(false)} />
      )}
      {privacy && (
        <Modal title="Обработка данных" close={() => setPrivacy(false)}>
          <p className="legal-copy">
            Имя, фамилия, телефон и почта нужны для оформления заказа, отправки
            билетов и проверки на входе. Рекламная рассылка не включена.
          </p>
          <p className="legal-copy">
            Это локальная версия сайта. Перед публичным запуском организатор
            должен указать свои реквизиты, политику обработки данных, условия
            покупки и возврата.
          </p>
        </Modal>
      )}
    </div>
  );
}
function Checkout({
  event,
  config,
  close,
}: {
  event: EventData;
  config: Config;
  close: () => void;
}) {
  const [quantity, setQuantity] = useState(1),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const order = await api<OrderData>("/orders", {
        method: "POST",
        headers: { "Idempotency-Key": key.current },
        body: JSON.stringify({
          ...Object.fromEntries(form),
          event_id: event.id,
          quantity,
          consent: form.get("consent") === "on",
        }),
      });
      location.href = "/order/" + order.access_token;
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }
  return (
    <Modal title="Ваш пропуск в ночь" close={close}>
      <div className="checkout-event">
        <img src={event.hero_image} alt="" />
        <div>
          <strong>{event.title}</strong>
          <span>
            {dateLabel(event.date)} · {event.time} · {event.venue}
          </span>
        </div>
      </div>
      <form onSubmit={submit}>
        <GuestFields />
        <div className="quantity-row">
          <div>
            <strong>Количество билетов</strong>
            <span>{money(event.price)} за гостя</span>
          </div>
          <div className="stepper">
            <button
              type="button"
              aria-label="Уменьшить количество"
              disabled={quantity <= 1}
              onClick={() => setQuantity(quantity - 1)}
            >
              <Minus size={17} />
            </button>
            <output>{quantity}</output>
            <button
              type="button"
              aria-label="Увеличить количество"
              disabled={quantity >= Math.min(10, event.available)}
              onClick={() => setQuantity(quantity + 1)}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
        <label className="checkbox-label">
          <input type="checkbox" name="consent" required />
          <span>
            Согласен на обработку данных для покупки и получения билетов
          </span>
        </label>
        <div className="checkout-total">
          <span>К оплате</span>
          <strong>{money(event.price * quantity)}</strong>
        </div>
        <ErrorNotice text={error} />
        {(config.demo || config.paymentMode === "sandbox") && (
          <p className="demo-note">
            {config.demo
              ? "Демонстрационный заказ. Деньги не списываются."
              : "Тестовый терминал QRM. Этот заказ не является рабочей продажей."}
          </p>
        )}
        <button
          className="button primary full"
          disabled={loading || !config.paymentReady}
        >
          {loading ? <Spinner /> : <ShieldCheck size={18} />}{" "}
          {config.paymentReady
            ? config.demo
              ? "Перейти к тестовой оплате"
              : "Оплатить через СБП"
            : "Оплата ещё не подключена"}
          <ArrowRight size={18} />
        </button>
        <div className="checkout-foot">
          <Smartphone size={13} /> СБП · Быстро и без ввода номера карты
        </div>
      </form>
    </Modal>
  );
}
function OrderPage() {
  const access = location.pathname.split("/")[2];
  const [showIntro, setShowIntro] = useState(
    () => new URLSearchParams(location.search).get("intro") !== "skip",
  );
  const [order, setOrder] = useState<OrderData>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setOrder(await api<OrderData>("/orders/" + access));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    const refresh = () => {
      if (!document.hidden) load();
    };
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 4000);
    return () => {
      clearInterval(t);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [access]);
  const singleTicketPath =
    order?.status === "paid" && order.tickets.length === 1
      ? "/ticket/" + order.tickets[0].code
      : null;
  useEffect(() => {
    if (singleTicketPath) location.replace(singleTicketPath);
  }, [singleTicketPath]);
  const introActive = Boolean(
    showIntro &&
      order?.status === "paid" &&
      order.event.id === "red-moon" &&
      order.tickets.length > 1,
  );
  async function demoPay() {
    setBusy(true);
    try {
      await api("/orders/" + access + "/demo-pay", {
        method: "POST",
        body: "{}",
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (singleTicketPath) return <Spinner />;
  return (
    <>
      {introActive && (
        <CinematicIntro
          ticketUrl={location.pathname + "?intro=skip"}
          onComplete={() => setShowIntro(false)}
        />
      )}
      <div
        className="order-page"
        inert={introActive}
        aria-hidden={introActive || undefined}
      >
        <header className="simple-header">
          <Brand />
          <a href="/" className="text-link">
            <ChevronLeft size={16} />
            На афишу
          </a>
        </header>
        <main className="order-main">
          <ErrorNotice text={error} />
          {!order ? (
            <Spinner />
          ) : order.status === "paid" ? (
            <>
              <div className="success-icon">
                <Check />
              </div>
              <span className="eyebrow quiet">
                ДО ВСТРЕЧИ ПОД КРАСНОЙ ЛУНОЙ
              </span>
              <h1>Эта ночь — ваша.</h1>
              <p className="muted">
                {order.first_name},{" "}
                {order.quantity === 1
                  ? "ваш билет готов"
                  : "ваши билеты готовы"}
                . Покажите QR на входе.
              </p>
              {order.mode !== "live" && (
                <div className="demo-note">
                  Тестовые билеты · оплата не проводилась
                </div>
              )}
              <div className="tickets-grid">
                {order.tickets.map((t) => (
                  <TicketCard
                    key={t.code}
                    ticket={t}
                    event={order.event}
                    name={`${order.first_name} ${order.last_name}`}
                    demo={order.mode !== "live"}
                    quantity={order.quantity}
                  />
                ))}
              </div>
              <button
                className="button primary print-action"
                onClick={() => window.print()}
              >
                <Download size={18} />
                Сохранить / распечатать билеты
              </button>
              <div className="delivery-info">
                {order.delivery
                  .filter((d) => d.channel !== "telegram")
                  .map((d) => (
                    <span key={d.channel}>
                      {d.channel === "email" ? (
                        <Mail size={16} />
                      ) : (
                        <Smartphone size={16} />
                      )}{" "}
                      {d.channel === "email" ? "Почта" : "СМС"}:{" "}
                      {d.status === "delivered"
                        ? "доставлено"
                        : d.status === "failed"
                          ? "не доставлено"
                          : ["sent", "submitted"].includes(d.status)
                            ? "передано сервису"
                            : d.status === "disabled"
                              ? "отправка не подключена"
                              : d.status === "unknown"
                                ? "нужна проверка отправки"
                                : "ожидает отправки"}
                    </span>
                  ))}
              </div>
            </>
          ) : (
            <div className="payment-panel">
              <span className="eyebrow quiet">ПОЧТИ ТАМ / ОПЛАТА</span>
              <h1>
                {["pending", "creating"].includes(order.status)
                  ? "До встречи один шаг."
                  : statusLabel[order.status]}
              </h1>
              <p>
                {order.event.title} · {order.quantity} бил. ·{" "}
                {money(order.total)}
              </p>
              {order.status === "pending" && (
                <>
                  {order.mode === "demo" ? (
                    <div className="demo-payment">
                      <ShieldCheck size={38} />
                      <h3>Тестовая оплата через СБП</h3>
                      <p>
                        В рабочей версии здесь будет QR QRM и кнопка перехода в
                        банк. Сейчас можно проверить выпуск билетов без списания
                        денег.
                      </p>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={demoPay}
                      >
                        {busy ? <Spinner /> : <Check size={18} />}Симулировать
                        успешную оплату
                      </button>
                    </div>
                  ) : (
                    <>
                      <img
                        className="payment-qr"
                        src={order.qr_image || ""}
                        alt="QR для оплаты через СБП"
                      />
                      <a
                        className="button primary"
                        href={order.payment_url || "#"}
                      >
                        Открыть приложение банка
                        <ArrowUpRight size={18} />
                      </a>
                      <p className="muted">
                        Страница обновится после подтверждения оплаты.
                      </p>
                      <p className="micro">
                        Если окно оплаты закрылось, вернитесь на эту страницу.
                      </p>
                    </>
                  )}
                </>
              )}
              {order.status === "creating" && <Spinner />}
              {order.status === "unknown" && (
                <p>
                  Проверяем результат создания платежа. Не оплачивайте заказ
                  повторно: свяжитесь с организатором и назовите номер{" "}
                  {order.id.slice(0, 8)}.
                </p>
              )}
              {["expired", "cancelled", "failed"].includes(order.status) && (
                <a href="/" className="button secondary">
                  Вернуться к мероприятию
                </a>
              )}
              {order.status === "paid_review" && (
                <p>
                  Платёж подтверждён после завершения резерва. Организатор
                  проверит наличие мест и свяжется с вами.
                </p>
              )}
              <span className="order-reference">
                Заказ {order.id.slice(0, 8).toUpperCase()}
              </span>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
function SingleTicket() {
  const [showIntro, setShowIntro] = useState(
    () => new URLSearchParams(location.search).get("intro") !== "skip",
  );
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get("intro") !== "skip") return;
    // Legacy direct-to-ticket links skip this visit only, not every reload.
    url.searchParams.delete("intro");
    history.replaceState(
      history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  }, []);
  const [data, setData] = useState<
      TicketData & {
        event: EventData;
        first_name: string;
        last_name: string;
        mode: string;
      }
    >(),
    [error, setError] = useState("");
  useEffect(() => {
    api<
      TicketData & {
        event: EventData;
        first_name: string;
        last_name: string;
        mode: string;
      }
    >("/tickets/" + location.pathname.split("/")[2])
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const introActive = Boolean(
    showIntro &&
      data &&
      data.event.id === "red-moon" &&
      !data.used_at &&
      !error,
  );
  return (
    <>
      {introActive && data && (
        <CinematicIntro
          ticketUrl={location.pathname + "?intro=skip"}
          onComplete={() => setShowIntro(false)}
        />
      )}
      <div
        className="single-ticket-page"
        inert={introActive}
        aria-hidden={introActive || undefined}
      >
        <ErrorNotice text={error} />
        {data ? (
          <>
            <TicketCard
              ticket={data}
              event={data.event}
              name={data.first_name + " " + data.last_name}
              demo={data.mode !== "live"}
            />
            <button className="button secondary" onClick={() => window.print()}>
              <Download size={16} />
              Сохранить билет
            </button>
            {data.event.id === "red-moon" && !data.used_at && (
              <button
                className="cinema-ticket-replay"
                onClick={() => setShowIntro(true)}
              >
                Повторить интро <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            )}
          </>
        ) : (
          !error && <Spinner />
        )}
      </div>
    </>
  );
}
export default function App() {
  const path = location.pathname;
  return path.startsWith("/admin") || path.startsWith("/checkin") ? (
    <Admin />
  ) : path.startsWith("/order/") ? (
    <OrderPage />
  ) : path.startsWith("/ticket/") ? (
    <SingleTicket />
  ) : (
    <Home />
  );
}
