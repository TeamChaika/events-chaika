import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUpRight, Check, MapPin, Sparkles } from "lucide-react";
import { LegalLinks } from "./Legal";
import { money, dateLabel, type EventData } from "./types";
import {
  adultMenu,
  childMenu,
  newYearTickets,
  type NewYearTicket,
} from "./new-year-menu";
import "./new-year.css";

const assets = "/assets/livadia-new-year/";
const program = [
  {
    number: "I",
    title: "Вечер начинается с театра",
    text: "«Богемные истории» — постановки по мотивам юмористических рассказов Ильфа и Петрова, Тэффи, Аркадия Аверченко и Михаила Зощенко.",
  },
  {
    number: "II",
    title: "Праздник со вкусом Греции",
    text: "Греческое новогоднее меню, разговоры за праздничным столом и эффектная презентация торта — кульминация вечера.",
  },
  {
    number: "III",
    title: "Новый год. По-гречески!",
    text: "Традиционное битьё тарелок и зажигательные танцы сиртаки. Пусть новый год начнётся ярко.",
  },
];

export default function NewYearLanding({
  event,
  canBuy,
  preview,
  onBuy,
  children,
}: {
  event: EventData;
  canBuy: boolean;
  preview: boolean;
  onBuy: (option: NewYearTicket) => void;
  children?: ReactNode;
}) {
  const [menu, setMenu] = useState<NewYearTicket>("adult");
  const tickets = newYearTickets.flatMap((ticket) => {
    const option = event.ticket_options?.find(
      (option) => option.id === ticket.id,
    );
    return option
      ? [
          {
            ...ticket,
            label: option.label,
            price: event.price + option.surcharge,
          },
        ]
      : [];
  });
  const priceLabel = (id: NewYearTicket) => {
    const ticket = tickets.find((ticket) => ticket.id === id);
    return ticket ? money(ticket.price) : "Цена уточняется";
  };
  const date = dateLabel(event.date);
  const year = Number(event.date.slice(0, 4));
  const saleStatus =
    new Date(`${event.date}T${event.time}:00+03:00`) <= new Date()
      ? "Мероприятие завершено"
      : event.available <= 0
        ? "Билеты закончились"
        : "Продажи пока закрыты";
  const courses = menu === "adult" ? adultMenu : childMenu;
  const poster =
    assets + (menu === "adult" ? "adult-menu.jpg" : "child-menu.jpg");

  useEffect(() => {
    const title = document.title;
    const theme = document.querySelector('meta[name="theme-color"]');
    const oldTheme = theme?.getAttribute("content");
    document.title = `${event.title} · Новый год в ${event.venue}`;
    theme?.setAttribute("content", "#f7f2e9");
    return () => {
      document.title = title;
      if (oldTheme) theme?.setAttribute("content", oldTheme);
    };
  }, [event.title, event.venue]);

  return (
    <div className="ny-page">
      <a className="ny-skip" href="#ny-program">
        Перейти к программе
      </a>
      {preview && (
        <div className="ny-preview-label">
          Предпросмотр · Тестовая оплата без списания денег
        </div>
      )}
      <header className="ny-header">
        <a
          className="ny-brand"
          href="#ny-top"
          aria-label="Ливадия — начало страницы"
        >
          <strong>ЛИВАДИЯ</strong>
          <span>РЕСТОРАН ГРЕЧЕСКОЙ КУХНИ</span>
        </a>
        <nav aria-label="О новогоднем вечере">
          <a href="#ny-program">Программа</a>
          <a href="#ny-menu">Меню</a>
          <a href="#ny-family">Для детей</a>
        </nav>
        <a className="ny-header-link" href="#ny-tickets">
          Выбрать билет <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </header>
      <main>
        <section className="ny-hero" id="ny-top" aria-labelledby="ny-title">
          <div className="ny-hero-art" aria-hidden="true">
            <picture>
              <source
                media="(max-width: 700px)"
                srcSet={assets + "theatre-hero-mobile.webp"}
              />
              <img
                src={assets + "theatre-hero.webp"}
                alt=""
                width="1536"
                height="1024"
                fetchPriority="high"
              />
            </picture>
          </div>
          <div className="ny-hero-copy">
            <p className="ny-eyebrow ny-hero-eyebrow">{event.subtitle}</p>
            <div className="ny-ornament" aria-hidden="true">
              ✦
            </div>
            <h1 id="ny-title">
              {event.title === "Богемные истории" ? (
                <>
                  Богемные
                  <br />
                  <em>истории</em>
                </>
              ) : (
                event.title
              )}
            </h1>
            <p className="ny-hero-description">
              Театр. Вкус. Новая глава.
              <br />
              Встретим {year + 1} год красиво.
            </p>
            <div className="ny-hero-date">
              <span>{date}</span>
              <i aria-hidden="true" />
              <span>Начало в {event.time}</span>
            </div>
            <a href="#ny-tickets" className="ny-button">
              Стать частью истории <ArrowUpRight size={18} aria-hidden="true" />
            </a>
            <p className="ny-hero-prices">
              Взрослый — {priceLabel("adult")} <span>·</span> Детский —{" "}
              {priceLabel("child")}
            </p>
          </div>
          <div className="ny-hero-bottom">
            <span>{event.address}</span>
            <a href="#ny-program">
              Приоткрыть занавес <ArrowDown size={15} aria-hidden="true" />
            </a>
            <span>{event.date.split("-").reverse().join(" / ")}</span>
          </div>
        </section>

        <section
          className="ny-introduction ny-container"
          aria-labelledby="ny-intro-title"
        >
          <p className="ny-eyebrow">Особенная ночь. Ваши люди.</p>
          <h2 id="ny-intro-title">
            Год меняется.
            <br />
            <em>Истории остаются.</em>
          </h2>
          <p>
            Вас ждёт не просто праздничная программа, а целое театральное
            представление, наполненное остроумием, иронией и яркими эмоциями.
          </p>
          <span className="ny-intro-line" aria-hidden="true" />
        </section>

        <section
          className="ny-program"
          id="ny-program"
          aria-labelledby="ny-program-title"
        >
          <div className="ny-container">
            <div className="ny-section-heading">
              <div>
                <p className="ny-eyebrow">01 / Программа вечера</p>
                <h2 id="ny-program-title">
                  Одна ночь.
                  <br />
                  <em>Столько историй.</em>
                </h2>
              </div>
              <p>
                Театральное остроумие,
                <br />
                греческое гостеприимство
                <br />и радость быть вместе.
              </p>
            </div>
            <ol className="ny-acts">
              {program.map((act) => (
                <li key={act.number}>
                  <span className="ny-act-number" aria-hidden="true">
                    {act.number}
                  </span>
                  <h3>{act.title}</h3>
                  <p>{act.text}</p>
                </li>
              ))}
            </ol>
            <div className="ny-program-foot">
              <span>
                {date} · Начало в {event.time}
              </span>
              <span>
                {event.venue}. Новогодняя ночь — {year + 1}
              </span>
            </div>
          </div>
        </section>

        <section
          className="ny-menu ny-container"
          id="ny-menu"
          aria-labelledby="ny-menu-title"
        >
          <div className="ny-section-heading">
            <div>
              <p className="ny-eyebrow">02 / Гастрономия</p>
              <h2 id="ny-menu-title">
                Праздник
                <br />
                <em>к столу.</em>
              </h2>
            </div>
            <p>
              Греческое новогоднее меню.
              <br />
              Для больших гурманов
              <br />и маленьких гостей.
            </p>
          </div>
          <div className="ny-menu-toolbar">
            <div
              className="ny-menu-switch"
              role="group"
              aria-label="Выбор меню"
            >
              {newYearTickets.map((ticket) => (
                <button
                  type="button"
                  key={ticket.id}
                  aria-pressed={menu === ticket.id}
                  aria-controls="ny-menu-content"
                  onClick={() => setMenu(ticket.id)}
                >
                  {ticket.menu}
                  <span>{priceLabel(ticket.id)}</span>
                </button>
              ))}
            </div>
            <a
              className="ny-text-link"
              href={poster}
              target="_blank"
              rel="noreferrer"
            >
              Посмотреть меню на афише{" "}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
          <div id="ny-menu-content" className="ny-menu-content" key={menu}>
            <div
              className="ny-menu-book"
              aria-label={
                menu === "adult"
                  ? "Взрослое новогоднее меню"
                  : "Детское новогоднее меню"
              }
            >
              {courses.map((course, index) => (
                <section className="ny-course" key={course.title}>
                  <div className="ny-course-title">
                    <span aria-hidden="true">0{index + 1}</span>
                    <h3>{course.title}</h3>
                  </div>
                  {course.note && (
                    <p className="ny-course-note">{course.note}</p>
                  )}
                  <ul>
                    {course.dishes.map((dish) => (
                      <li key={dish.name}>
                        <div>
                          <span>{dish.name}</span>
                          {dish.weight && <small>{dish.weight}</small>}
                        </div>
                        {dish.detail && <p>{dish.detail}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="ny-menu-complement">
              <Sparkles size={22} strokeWidth={1.2} aria-hidden="true" />
              <p>
                {menu === "adult" ? (
                  <>
                    Бутылка шампанского «Новый Свет» на двоих гостей
                    <small>Брют, полусухое или полусладкое — на выбор</small>
                  </>
                ) : (
                  <>
                    Сладкий праздник и новогодний сюрприз
                    <small>
                      Праздничный торт, мандарины и фирменный подарок от «Чайки»
                    </small>
                  </>
                )}
              </p>
            </div>
          </div>
        </section>

        <section
          className="ny-family"
          id="ny-family"
          aria-labelledby="ny-family-title"
        >
          <div className="ny-container ny-family-grid">
            <div className="ny-family-poster">
              <a
                href={assets + "child-menu.jpg"}
                target="_blank"
                rel="noreferrer"
                aria-label="Открыть афишу детского меню"
              >
                <img
                  src={assets + "child-menu.jpg"}
                  alt="Детское новогоднее меню «Ливадии» с мишкой, ёлочной игрушкой и мандаринами"
                  width="1368"
                  height="1824"
                  loading="lazy"
                />
              </a>
            </div>
            <div className="ny-family-copy">
              <p className="ny-eyebrow">03 / Для всей семьи</p>
              <h2 id="ny-family-title">
                Маленьким гостям —<br />
                <em>большой праздник.</em>
              </h2>
              <p>
                Отдельная детская игровая зона с аниматорами сделает отдых
                комфортным для всех гостей.
              </p>
              <ul>
                <li>
                  <Check size={17} aria-hidden="true" /> Игровая зона с
                  аниматорами
                </li>
                <li>
                  <Check size={17} aria-hidden="true" /> Отдельное праздничное
                  меню
                </li>
                <li>
                  <Check size={17} aria-hidden="true" /> Фирменный подарок от
                  «Чайки»
                </li>
              </ul>
              <a
                href="#ny-menu"
                className="ny-text-link"
                onClick={() => setMenu("child")}
              >
                Посмотреть детское меню{" "}
                <ArrowUpRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section
          className="ny-tickets ny-container"
          id="ny-tickets"
          aria-labelledby="ny-tickets-title"
        >
          <div className="ny-section-heading">
            <div>
              <p className="ny-eyebrow">04 / Ваше приглашение</p>
              <h2 id="ny-tickets-title">
                Впишите себя
                <br />
                <em>в эту историю.</em>
              </h2>
            </div>
            <p>
              {date} {year}
              <br />
              Начало в {event.time}
              <br />
              Ресторан «{event.venue}»
            </p>
          </div>
          <div className="ny-ticket-grid">
            {tickets.map((ticket, index) => (
              <article className="ny-ticket" key={ticket.id}>
                <div className="ny-ticket-top">
                  <span>
                    {event.venue.toUpperCase()} · НОВЫЙ ГОД {year + 1}
                  </span>
                  <span>0{index + 1}</span>
                </div>
                <h3>{ticket.label}</h3>
                <p>{ticket.description}</p>
                <div className="ny-ticket-price">
                  <strong>{money(ticket.price)}</strong>
                  <span>за одного гостя</span>
                </div>
                <button
                  type="button"
                  className="ny-button"
                  disabled={!canBuy}
                  onClick={() => onBuy(ticket.id)}
                >
                  {canBuy ? "Выбрать билет" : saleStatus}{" "}
                  <ArrowUpRight size={18} aria-hidden="true" />
                </button>
                <div className="ny-ticket-bottom">
                  <span>{date}</span>
                  <span>{event.time}</span>
                  <span>Ялта</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="ny-location" aria-labelledby="ny-location-title">
          <div className="ny-container">
            <p className="ny-eyebrow">Встречаемся в «Ливадии»</p>
            <h2 id="ny-location-title">
              Новая глава.
              <br />
              <em>У самого моря.</em>
            </h2>
            <a
              className="ny-address"
              href={
                "https://yandex.ru/maps/?text=" +
                encodeURIComponent(event.address)
              }
              target="_blank"
              rel="noreferrer"
            >
              <MapPin size={19} aria-hidden="true" /> {event.address}{" "}
              <ArrowUpRight size={17} aria-hidden="true" />
            </a>
            {event.contact_phone && (
              <a
                className="ny-phone"
                href={"tel:" + event.contact_phone.replace(/[^+\d]/g, "")}
              >
                {event.contact_phone}
              </a>
            )}
            <p className="ny-location-date">
              {date} · {event.time}
            </p>
          </div>
        </section>
      </main>
      <footer className="ny-footer">
        <a className="ny-brand" href="#ny-top">
          <strong>ЛИВАДИЯ</strong>
          <span>РЕСТОРАН ГРЕЧЕСКОЙ КУХНИ</span>
        </a>
        <p>{event.title} · Новогодняя ночь</p>
        <span>CHAIKATEAM</span>
      </footer>
      <div className="ny-legal-footer">
        <LegalLinks marketing={false} />
      </div>
      <div className="ny-mobile-booking">
        <span>
          Взрослый <b>{priceLabel("adult")}</b>
          <small>Детский — {priceLabel("child")}</small>
        </span>
        <a className="ny-button" href="#ny-tickets">
          Билеты <ArrowUpRight size={17} aria-hidden="true" />
        </a>
      </div>
      {children}
    </div>
  );
}
