import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
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
  Pause,
  Play,
  Download,
  LoaderCircle,
  Sparkles,
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
import { Brand, ErrorNotice, Spinner, Modal, GuestFields } from "./ui";
import { MoonScene } from "./MoonScene";

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
    const t = setInterval(() => setTime(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(
      0,
      new Date(`${event.date}T${event.time}:00+03:00`).getTime() - time,
    ),
    days = Math.floor(diff / 86400000),
    hours = Math.floor(diff / 3600000) % 24,
    mins = Math.floor(diff / 60000) % 60;
  return (
    <div className="countdown">
      <span className="micro muted">ДО НАЧАЛА НОЧИ</span>
      <div>
        {[
          [days, "ДНЕЙ"],
          [hours, "ЧАСОВ"],
          [mins, "МИНУТ"],
        ].map(([n, label], i) => (
          <React.Fragment key={label}>
            <span className="count-unit">
              <b>{String(n).padStart(2, "0")}</b>
              <small>{label}</small>
            </span>
            {i < 2 && <span className="count-colon">:</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
function Home() {
  const [events, setEvents] = useState<EventData[]>([]),
    [config, setConfig] = useState<Config>(),
    [error, setError] = useState(""),
    [buy, setBuy] = useState(false),
    [paused, setPaused] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  const [privacy, setPrivacy] = useState(false);
  const selected = new URLSearchParams(location.search).get("event");
  useEffect(() => {
    Promise.all([api<EventData[]>("/events"), api<Config>("/config")])
      .then(([e, c]) => {
        setEvents(e);
        setConfig(c);
      })
      .catch((e) => setError(e.message));
  }, []);
  const event = events.find((e) => e.id === selected) || events[0];
  if (error)
    return (
      <div className="loading-screen">
        <Brand />
        <ErrorNotice text={error} />
        <button className="button primary" onClick={() => location.reload()}>
          Попробовать ещё раз
        </button>
      </div>
    );
  if (!event || !config)
    return (
      <div className="loading-screen">
        <Brand />
        {config ? <p>Афиша скоро появится.</p> : <Spinner />}
        <a href="/admin">Управление событиями</a>
      </div>
    );
  const canBuy =
    Boolean(event.sales_open) &&
    event.available > 0 &&
    new Date(`${event.date}T${event.time}:00+03:00`) > new Date();
  return (
    <div className={"public-app " + (paused ? "motion-paused" : "")}>
      {(config.demo || config.paymentMode === "sandbox") && (
        <div className="preview-banner">
          <span /> ПРЕДПРОСМОТР <i />{" "}
          {config.demo
            ? "Тестовая оплата · деньги не списываются"
            : "Тестовый терминал QRM"}
        </div>
      )}
      <header className="public-header">
        <Brand />
        <nav aria-label="Навигация">
          <a href="#about">О событии</a>
          <a href="#details">Детали вечера</a>
          <a href="#questions">Вопросы</a>
        </nav>
        <a href="/admin" className="header-link">
          Организаторам <ArrowUpRight size={15} />
        </a>
      </header>
      <main>
        <section
          className={
            "hero" + (event.title === "Ночь красной луны" ? "" : " hero-custom")
          }
          aria-labelledby="event-title"
        >
          <div className="hero-art" aria-hidden="true">
            <div className="hero-scene">
              <img src={event.hero_image} alt="" fetchPriority="high" />
              {event.hero_image === "/assets/red-moon.png" && (
                <MoonScene paused={paused} />
              )}
            </div>
            <div className="mist mist-one" />
            <div className="mist mist-two" />
          </div>
          <div className="bats" aria-hidden="true">
            {[1, 2, 3, 4, 5, 6].map((i) => (
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
                  <span className="last-title">
                    ЛУНЫ
                    <svg viewBox="0 0 90 90" aria-hidden="true">
                      <path
                        d="M45 0 49 37 78 14 54 42 90 45 54 49 78 77 49 54 45 90 41 54 13 77 36 49 0 45 36 42 13 14 41 37Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                </>
              ) : (
                event.title.toUpperCase()
              )}
            </h1>
            <p className="hero-description">
              Эта ночь создана, чтобы стать кем-то другим. <br />
              Встретимся на тёмной стороне.
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
              <i />
              <span>
                <MapPin size={17} />
                {event.venue}
              </span>
            </div>
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
            <div className="payment-note">
              <ShieldCheck size={13} /> Оплата через СБП <span>·</span> Билет в
              СМС и на почту
            </div>
          </div>
          <div className="moon-caption">
            <span>{new Date(event.date + "T12:00:00").getDate()}</span>
            <span>
              {new Date(event.date + "T12:00:00")
                .toLocaleString("en-US", { month: "long" })
                .toUpperCase()}
              <br />
              RED MOON RISING
            </span>
          </div>
          <div className="hero-bottom">
            <a href="#about" className="scroll-cue">
              <span>
                <ArrowDown size={17} />
              </span>
              Эта ночь будет особенной
            </a>
            <button
              className="motion-toggle"
              onClick={() => setPaused(!paused)}
              aria-label={paused ? "Включить анимацию" : "Остановить анимацию"}
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}{" "}
              {paused ? "Оживить ночь" : "Ночь оживает"}
            </button>
          </div>
        </section>
        <div className="marquee" aria-hidden="true">
          <div>
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i}>
                BLACK TIE. RED MOON. <Sparkles /> ОДНА НОЧЬ. ДРУГАЯ РЕАЛЬНОСТЬ.{" "}
                <Sparkles />
              </span>
            ))}
          </div>
        </div>
        <section className="about section-shell" id="about">
          <div>
            <span className="eyebrow quiet">01 / ПО ТУ СТОРОНУ ОБЫЧНОГО</span>
            <h2>
              Оставьте привычное
              <br />
              до <em>рассвета.</em>
            </h2>
          </div>
          <div className="about-right">
            <p>{event.description}</p>
            <a className="text-link" href="#details">
              Всё, что нужно знать <ArrowDown size={16} />
            </a>
          </div>
        </section>
        <section className="details section-shell" id="details">
          <div className="detail-item">
            <span className="detail-index">01</span>
            <CalendarDays />
            <span className="micro muted">КОГДА</span>
            <h3>{dateLabel(event.date)}</h3>
            <p>
              Начало в {event.time} · {event.date.slice(0, 4)}
            </p>
          </div>
          <div className="detail-item">
            <span className="detail-index">02</span>
            <MapPin />
            <span className="micro muted">ГДЕ</span>
            <h3>{event.venue}</h3>
            <p>{event.address}</p>
          </div>
          <div className="detail-item">
            <span className="detail-index">03</span>
            <Sparkles />
            <span className="micro muted">ДРЕСС-КОД</span>
            <h3>Будьте загадкой</h3>
            <p>{event.dresscode}</p>
          </div>
        </section>
        <section className="reservation section-shell">
          <div>
            <span className="eyebrow quiet">
              ВАШЕ ПРИГЛАШЕНИЕ В ДРУГУЮ РЕАЛЬНОСТЬ
            </span>
            <h2>
              У ночи есть <em>ваше имя.</em>
            </h2>
            <button
              className="button primary"
              disabled={!canBuy}
              onClick={() => setBuy(true)}
            >
              Купить билет · {money(event.price)}
              <ArrowUpRight size={19} />
            </button>
          </div>
          <Countdown event={event} />
        </section>
        <section className="questions section-shell" id="questions">
          <h2>
            Перед <em>полуночью.</em>
            <small>Ответы на ваши вопросы</small>
          </h2>
          <div>
            {[
              [
                "Как я получу билет?",
                "После подтверждения оплаты билеты появятся на экране. При подключённых сервисах доставки ссылка придёт на почту и в СМС. На каждый купленный билет выпускается отдельный QR-код.",
              ],
              [
                "Как проходит оплата?",
                "На сайте доступна оплата через СБП: откройте банковское приложение по ссылке или отсканируйте платёжный QR. Статус проверяется автоматически.",
              ],
              [
                "Можно купить билеты на компанию?",
                "Да, укажите количество билетов в форме. Достаточно контактов одного покупателя. Каждый гость проходит по своему QR-коду.",
              ],
              [
                "Что показать на входе?",
                "Откройте билет с QR-кодом на телефоне. Сотрудник проверит его камерой. Каждый билет позволяет пройти один раз.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <Plus size={18} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        {events.length > 1 && (
          <section className="section-shell more-events">
            <h2>Ещё события</h2>
            {events
              .filter((e) => e.id !== event.id)
              .map((e) => (
                <a href={"/?event=" + e.id} key={e.id}>
                  {e.title}
                  <span>
                    {dateLabel(e.date)} · {money(e.price)}
                  </span>
                  <ArrowUpRight />
                </a>
              ))}
          </section>
        )}
      </main>
      <footer className="public-footer">
        <Brand />
        <span>Создаём поводы быть вместе.</span>
        <button className="plain" onClick={() => setPrivacy(true)}>
          Конфиденциальность
        </button>
        <a href="/checkin">
          Вход для контролёра <ArrowUpRight size={13} />
        </a>
        <small>© Чайка, 2026</small>
      </footer>
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
function TicketCard({
  ticket,
  event,
  name,
  demo,
  quantity,
}: {
  ticket: TicketData;
  event: EventData;
  name: string;
  demo: boolean;
  quantity?: number;
}) {
  return (
    <article className="real-ticket">
      <div className="ticket-top">
        <Brand />
        <span>{demo ? "ДЕМО-БИЛЕТ" : "ЭЛЕКТРОННЫЙ БИЛЕТ"}</span>
      </div>
      <h2>{event.title}</h2>
      <div className="ticket-details">
        <span>
          {dateLabel(event.date)} · {event.time}
        </span>
        <span>{event.venue}</span>
      </div>
      <div className="ticket-perforation" />
      <img
        className="ticket-qr"
        src={ticket.qr_image}
        alt={"QR-код билета " + ticket.ordinal}
      />
      <strong className="ticket-guest">{name}</strong>
      <span className="ticket-number">
        Билет {ticket.ordinal}
        {quantity ? " из " + quantity : ""} ·{" "}
        {ticket.used_at ? "Уже использован" : "Один гость — один проход"}
      </span>
      <code>{ticket.code.slice(0, 8).toUpperCase()}</code>
      <a className="ticket-own-link" href={"/ticket/" + ticket.code}>
        Открыть отдельный билет <ArrowUpRight size={12} />
      </a>
    </article>
  );
}
function OrderPage() {
  const access = location.pathname.split("/")[2];
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
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 4000);
    return () => clearInterval(t);
  }, [access]);
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
  return (
    <div className="order-page">
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
            <span className="eyebrow quiet">ДО ВСТРЕЧИ ПОД КРАСНОЙ ЛУНОЙ</span>
            <h1>Эта ночь — ваша.</h1>
            <p className="muted">
              {order.first_name},{" "}
              {order.quantity === 1 ? "ваш билет готов" : "ваши билеты готовы"}.
              Покажите QR на входе.
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
                    {d.status === "sent"
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
              {order.event.title} · {order.quantity} бил. · {money(order.total)}
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
  );
}
function SingleTicket() {
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
  return (
    <div className="single-ticket-page">
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
        </>
      ) : (
        !error && <Spinner />
      )}
    </div>
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
