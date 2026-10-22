import { ArrowDown, ArrowUpRight, MapPin, Ticket, Wine } from "lucide-react";
import { ContactPhone } from "./ui";
import { LegalLinks } from "./Legal";
import { dateLabel, money, eventPath, type EventData } from "./types";
import "./odisseya.css";
import { OdisseyaScene } from "./OdisseyaScene";

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
      <main className="odisseya-page">
        <section className="odisseya-hero" aria-labelledby="odisseya-title">
          <header className="odisseya-header">
            <a
              className="odisseya-brand"
              href={eventPath(event)}
              aria-label="Ливадия — афиша"
            >
              <strong>ЛИВАДИЯ</strong>
              <span>РЕСТОРАН ГРЕЧЕСКОЙ КУХНИ</span>
            </a>
            <nav aria-label="О вечере">
              <a href="#odisseya-menu">Меню вечера</a>
              <a href="#odisseya-location">Место встречи</a>
            </nav>
            <a className="odisseya-header-ticket" href="#odisseya-tickets">
              Выбрать билет <ArrowUpRight size={17} aria-hidden="true" />
            </a>
          </header>
          <div className="odisseya-copy">
            <p className="odisseya-kicker">{event.subtitle} · Ялта</p>
            <h1 id="odisseya-title">{event.title}</h1>
            <p className="odisseya-lead">
              Шесть историй. Шесть курсов.
              <br />
              <em>Одна дорога домой.</em>
            </p>
            <div className="odisseya-date">
              <strong>{dateLabel(event.date)}</strong>
              <span>
                {event.time}
                <small>
                  сбор гостей{event.age >= 0 ? ` · ${event.age}+` : ""}
                </small>
              </span>
            </div>
            <div className="odisseya-booking">
              {buyButton}
              <span>
                <strong>
                  {event.ticket_options?.length ? "от " : ""}
                  {money(event.price)}
                </strong>
                <small>за одного гостя</small>
              </span>
            </div>
            <a className="odisseya-discover" href="#odisseya-menu">
              <ArrowDown size={16} aria-hidden="true" /> Отправиться в
              путешествие
            </a>
          </div>
          <div className="odisseya-visual">
            <img
              className="odisseya-world"
              src="/assets/odisseya-yalta-poster.jpg"
              alt=""
              width="1280"
              height="720"
              fetchPriority="high"
            />
            <OdisseyaScene />
          </div>
          <span className="odisseya-art-caption">
            Ливадия / {event.date.slice(0, 4)}
          </span>
        </section>
        <section className="odisseya-prologue" aria-label="О спектакле">
          <span className="odisseya-prologue-index">01 / ВЕЧЕР</span>
          <p>
            В этот вечер
            <br />
            <em>мифы оживают.</em>
          </p>
          <div>
            <span className="odisseya-kicker">
              Театр встречается с гастрономией
            </span>
            <p>
              От первого курса до последнего акта — путешествие по историям
              Одиссея за столом «Ливадии».
            </p>
            <a href="#odisseya-menu">
              Узнать меню <ArrowDown size={15} aria-hidden="true" />
            </a>
          </div>
        </section>
        <section
          id="odisseya-menu"
          className="odisseya-menu"
          aria-labelledby="odisseya-menu-title"
        >
          <div className="odisseya-section-heading">
            <p className="odisseya-kicker">02 / Меню путешествия</p>
            <h2 id="odisseya-menu-title">
              Море историй.
              <br />
              <em>Шесть вкусов.</em>
            </h2>
            <p>
              Каждый курс — новая глава.
              <br />
              От отправления до возвращения домой.
            </p>
            <span className="odisseya-menu-count" aria-hidden="true">
              06
            </span>
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
          id="odisseya-tickets"
          className="odisseya-tickets"
          aria-labelledby="odisseya-tickets-title"
        >
          <div className="odisseya-ticket-heading">
            <p className="odisseya-kicker">03 / Ваше приглашение</p>
            <h2 id="odisseya-tickets-title">
              Место в этой
              <br />
              <em>истории — ваше.</em>
            </h2>
            <p>
              {dateLabel(event.date)} · {event.time} · {event.venue}
            </p>
          </div>
          <div className="odisseya-ticket-choices">
            {(event.ticket_options?.length
              ? event.ticket_options
              : [
                  {
                    id: "standard",
                    label: "Гастрономический спектакль",
                    surcharge: 0,
                  },
                ]
            ).map((option) => (
              <article
                key={option.id}
                className={
                  option.surcharge
                    ? "odisseya-ticket-choice with-wine"
                    : "odisseya-ticket-choice"
                }
              >
                {option.surcharge ? (
                  <Wine size={24} strokeWidth={1.25} aria-hidden="true" />
                ) : (
                  <Ticket size={24} strokeWidth={1.25} aria-hidden="true" />
                )}
                <h3>{option.label}</h3>
                <p>
                  Шесть курсов и спектакль
                  {option.surcharge
                    ? ", дополненные винным сопровождением."
                    : "."}
                </p>
                <div className="odisseya-option-price">
                  <strong>{money(event.price + option.surcharge)}</strong>
                  <span>за одного гостя</span>
                </div>
              </article>
            ))}
            <div className="odisseya-tickets-action">
              {buyButton}
              <span>Вариант и количество гостей — на следующем шаге</span>
            </div>
          </div>
        </section>
        <section
          id="odisseya-location"
          className="odisseya-location"
          aria-labelledby="odisseya-location-title"
        >
          <div className="odisseya-location-title">
            <p className="odisseya-kicker">04 / Встречаемся у моря</p>
            <h2 id="odisseya-location-title">{event.venue}</h2>
            <p>Ресторан греческой кухни</p>
          </div>
          <div className="odisseya-location-details">
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
          </div>
        </section>
      </main>
      <footer className="odisseya-footer">
        <span>ООО «БРИЗ» · ИНН 9103090740</span>
        <LegalLinks marketing={false} />
        <a href="mailto:event@chaika.team">event@chaika.team</a>
      </footer>
      <div className="odisseya-mobile-buy">
        <span>
          <strong>
            {event.ticket_options?.length ? "от " : ""}
            {money(event.price)}
          </strong>
          <small>за одного гостя</small>
        </span>
        {buyButton}
      </div>
    </>
  );
}
