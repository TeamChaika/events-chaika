import { ArrowUpRight, MapPin, Ticket } from "lucide-react";
import { ContactPhone } from "./ui";
import { LegalLinks } from "./Legal";
import { dateLabel, money, type EventData } from "./types";
import "./odisseya.css";

const courses = [
  [
    "Отплытие",
    "Крудо из черноморского горбыля",
    "Ладолемоно · крем из феты · мини-каперсы",
  ],
  [
    "Лотос",
    "Авторский греческий пирог Спанакопита",
    "Цветок из фило · тыква · мятный дзадзики · пудра из цветков лотоса",
  ],
  [
    "Полифем",
    "Халлуми",
    "Подвяленная свёкла · виноград в красном вине · сухофрукты",
  ],
  [
    "Сирены",
    "По мотивам греческого блюда саганаки",
    "Пита · рагу из осьминога · страчателла · томаты",
  ],
  [
    "Чары Цирцеи",
    "Клефтико из ягнёнка",
    "Крем из сельдерея · лимонный картофель · горные травы",
  ],
  [
    "Пенелопа",
    "Портокалопита",
    "Домашние цукаты из апельсина · заварной крем на греческом йогурте",
  ],
];

export function OdisseyaLanding({
  event,
  canBuy,
  preview,
  onBuy,
}: {
  event: EventData;
  canBuy: boolean;
  preview: boolean;
  onBuy: () => void;
}) {
  const buyButton = (
    <button className="button primary" disabled={!canBuy} onClick={onBuy}>
      <Ticket size={19} aria-hidden="true" />
      {canBuy ? "Купить билет" : "Скоро в продаже"}
      <ArrowUpRight size={19} aria-hidden="true" />
    </button>
  );
  return (
    <>
      {preview && (
        <div className="odisseya-preview">
          Предпросмотр · тестовая оплата без списания денег
        </div>
      )}
      <main>
        <section className="odisseya-hero" aria-labelledby="odisseya-title">
          <picture className="odisseya-world" aria-hidden="true">
            <source
              media="(max-width: 760px)"
              srcSet="/assets/odisseya-world-mobile.jpg"
            />
            <img
              src="/assets/odisseya-world.jpg"
              alt=""
              width="1536"
              height="1024"
              fetchPriority="high"
            />
          </picture>
          <header className="odisseya-header">
            <a href="#odisseya-menu">Меню вечера</a>
            <a
              className="odisseya-brand"
              href={"/?" + new URLSearchParams({ event: event.id })}
              aria-label="Ливадия — афиша"
            >
              <strong>ЛИВАДИЯ</strong>
              <span>РЕСТОРАН ГРЕЧЕСКОЙ КУХНИ</span>
            </a>
            <a href="#odisseya-location">Место встречи</a>
          </header>
          <div className="odisseya-copy">
            <p className="odisseya-date">
              <strong>{Number(event.date.slice(-2))}</strong>
              <span>
                {dateLabel(event.date).replace(/^\d+\s*/, "")}
                <small>
                  {new Date(event.date + "T12:00:00").toLocaleDateString(
                    "ru-RU",
                    { weekday: "long" },
                  )}{" "}
                  · {event.date.slice(0, 4)}
                </small>
              </span>
            </p>
            <h1 id="odisseya-title">{event.title}</h1>
            <svg
              className="odisseya-waves"
              viewBox="0 0 150 22"
              aria-hidden="true"
            >
              <path
                d="M0 11C25-7 45 29 74 11S125-7 150 11M14 17C37 3 53 29 77 17S117 3 138 17"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            <p className="odisseya-subtitle">{event.subtitle}</p>
            <div className="odisseya-rule" aria-hidden="true" />
            <p className="odisseya-tagline">
              Шесть историй · Шесть курсов
              <br />
              <em>Одна дорога домой</em>
            </p>
            <div className="odisseya-booking">
              {buyButton}
              <span>
                <strong>{money(event.price)}</strong>
                <small>за одного гостя</small>
              </span>
            </div>
            <p className="odisseya-arrival">
              Сбор гостей в {event.time}
              {event.age >= 0 ? ` · ${event.age}+` : ""}
            </p>
          </div>
        </section>
        <section
          id="odisseya-menu"
          className="odisseya-menu"
          aria-labelledby="odisseya-menu-title"
        >
          <div className="odisseya-section-heading">
            <p className="odisseya-kicker">Вкус каждой истории</p>
            <h2 id="odisseya-menu-title">
              Шесть остановок.
              <br />
              <em>Одно путешествие.</em>
            </h2>
            <p>Меню гастрономического спектакля</p>
          </div>
          <ol>
            {courses.map(([title, dish, details], i) => (
              <li key={title}>
                <span className="odisseya-course-number">0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p className="odisseya-dish">{dish}</p>
                  <p>{details}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section
          id="odisseya-location"
          className="odisseya-location"
          aria-labelledby="odisseya-location-title"
        >
          <p className="odisseya-kicker">Место встречи</p>
          <h2 id="odisseya-location-title">{event.venue}</h2>
          <p>Ресторан греческой кухни</p>
          <a
            href={
              "https://yandex.ru/maps/?text=" +
              encodeURIComponent(event.address)
            }
            target="_blank"
            rel="noreferrer"
          >
            <MapPin size={18} aria-hidden="true" />
            {event.address}
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
          <ContactPhone phone={event.contact_phone || ""} />
          {event.dresscode && <p>Дресс-код: {event.dresscode}</p>}
          <p>
            {dateLabel(event.date)} · Сбор гостей в {event.time}
          </p>
          <div className="odisseya-booking">
            {buyButton}
            <strong>{money(event.price)}</strong>
          </div>
        </section>
      </main>
      <footer className="odisseya-footer">
        <span>ООО «БРИЗ» · ИНН 9103090740</span>
        <LegalLinks />
        <a href="mailto:event@chaika.team">event@chaika.team</a>
      </footer>
      <div className="odisseya-mobile-buy">
        <span>
          <strong>{money(event.price)}</strong>
          <small>за одного гостя</small>
        </span>
        {buyButton}
      </div>
    </>
  );
}
