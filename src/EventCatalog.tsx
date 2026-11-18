import { useEffect, useState } from "react";
import { ArrowUpRight, MapPin } from "lucide-react";
import { CookieNotice, LegalLinks } from "./Legal";
import { eventStart, ticketStatus, utmSearch } from "./public-events";
import { api, dateLabel, eventPath, money, type EventData } from "./types";
import { Spinner } from "./ui";
import "./event-catalog.css";

type CatalogItem = {
  event: EventData;
  status: ReturnType<typeof ticketStatus>;
};

const statusLabels = {
  started: "Продажа завершена",
  closed: "Продажа закрыта",
  unavailable: "Свободных билетов нет",
};

function EventList({
  items,
  archive = false,
}: {
  items: CatalogItem[];
  archive?: boolean;
}) {
  const campaign = utmSearch(location.search);
  return (
    <ul className={archive ? "catalog-list catalog-archive" : "catalog-list"}>
      {items.map(({ event, status }, index) => {
        const id = `catalog-${encodeURIComponent(event.id)}`;
        // The stock Odyssey poster has a time printed on it. Use the landing's
        // text-free artwork so the card always shows the published start time.
        const poster =
          event.layout === "odisseya" &&
          event.hero_image === "/assets/odisseya.jpg"
            ? "/assets/odisseya-yalta-poster.jpg"
            : event.hero_image;
        return (
          <li key={event.id}>
            <a
              className="catalog-card"
              href={eventPath(event) + campaign}
              aria-label={event.title}
              aria-describedby={`${id}-date ${id}-venue ${id}-status`}
            >
              <div className="catalog-poster">
                <img
                  src={poster}
                  alt=""
                  loading={index === 0 && !archive ? "eager" : "lazy"}
                  onError={(e) => {
                    e.currentTarget.hidden = true;
                  }}
                />
              </div>
              <div className="catalog-card-body">
                <time
                  id={`${id}-date`}
                  className="catalog-date"
                  dateTime={eventStart(event)}
                >
                  {dateLabel(event.date)} {event.date.slice(0, 4)} ·{" "}
                  {event.time}
                </time>
                <h3>{event.title}</h3>
                {!archive && event.subtitle && (
                  <p className="catalog-subtitle">{event.subtitle}</p>
                )}
                <p id={`${id}-venue`} className="catalog-venue">
                  <MapPin size={15} aria-hidden="true" />
                  {event.venue}
                </p>
                <div className="catalog-card-foot">
                  <span
                    id={`${id}-status`}
                    className={status === "open" ? "catalog-price" : ""}
                  >
                    {status === "open" ? (
                      <>
                        {event.ticket_options?.some(
                          (option) => option.surcharge > 0,
                        )
                          ? "Билеты от "
                          : "Билет за "}
                        {money(event.price)}
                      </>
                    ) : (
                      statusLabels[status]
                    )}
                  </span>
                  <ArrowUpRight size={20} aria-hidden="true" />
                </div>
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function EventCatalog() {
  const [events, setEvents] = useState<EventData[]>();
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    api<EventData[]>("/events", { signal: controller.signal })
      .then((list) => {
        if (active) setEvents(list);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  // The public API returns published events in ascending local date and time.
  const items = (events || []).map<CatalogItem>((event) => ({
    event,
    status: ticketStatus(event, now),
  }));
  const upcoming = items.filter(({ status }) => status !== "started");
  const archive = items.filter(({ status }) => status === "started").reverse();
  const nextStart = upcoming.length
    ? Date.parse(eventStart(upcoming[0].event))
    : null;
  useEffect(() => {
    if (nextStart === null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, nextStart - Date.now()), 2147483647),
    );
    return () => clearTimeout(timer);
  }, [nextStart, now]);

  return (
    <div className="event-catalog public-app">
      <div className="catalog-frame">
        <header className="catalog-header">
          <a
            className="catalog-brand"
            href="/"
            aria-label="Чайка Тим — главная"
          >
            <img
              src="/assets/chaikateam.png"
              width="3334"
              height="1093"
              alt="Чайка Тим"
            />
          </a>
          {upcoming.length > 0 && archive.length > 0 && (
            <nav aria-label="Разделы афиши">
              <a href="#upcoming">Ближайшие</a>
              <a href="#archive">Архив</a>
            </nav>
          )}
        </header>
        <main>
          <h1>Афиша мероприятий</h1>
          {failed ? (
            <div className="catalog-notice">
              <p role="alert">Не удалось загрузить афишу.</p>
              <button
                type="button"
                className="button secondary"
                onClick={() => location.reload()}
              >
                Попробовать ещё раз
              </button>
            </div>
          ) : !events ? (
            <p className="catalog-notice" role="status">
              <Spinner /> Загружаем афишу…
            </p>
          ) : !events.length ? (
            <p className="catalog-notice">В афише пока нет мероприятий.</p>
          ) : (
            <>
              <section id="upcoming" aria-labelledby="catalog-upcoming-title">
                <h2 id="catalog-upcoming-title">Ближайшие мероприятия</h2>
                {upcoming.length ? (
                  <EventList items={upcoming} />
                ) : (
                  <p className="catalog-notice">
                    Новые мероприятия пока не объявлены.
                  </p>
                )}
              </section>
              {archive.length > 0 && (
                <section id="archive" aria-labelledby="catalog-archive-title">
                  <h2 id="catalog-archive-title">Архив мероприятий</h2>
                  <EventList items={archive} archive />
                </section>
              )}
            </>
          )}
        </main>
        <CookieNotice />
        <footer className="catalog-footer">
          <LegalLinks />
        </footer>
      </div>
    </div>
  );
}
