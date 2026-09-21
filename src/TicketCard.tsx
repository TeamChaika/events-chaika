import { ArrowUpRight, MapPin } from "lucide-react";
import { Brand, EventPartners, ContactPhone } from "./ui";
import { dateLabel, type EventData, type TicketData } from "./types";

export function TicketCard({
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
  const redMoon = event.id === "red-moon";
  const venue = event.venue === "Гастродвор" ? "Гастро Двор" : event.venue;
  return (
    <article
      className="real-ticket"
      aria-label={`Билет ${ticket.ordinal}: ${event.title}`}
    >
      <div className="ticket-visual">
        <div className="ticket-lunar-art" aria-hidden="true">
          <div className="ticket-orbit" />
          <div className="ticket-moon" />
          <div className="ticket-grid" />
        </div>
        <div className="ticket-top">
          {redMoon ? <EventPartners /> : <Brand />}
          <span className="ticket-age">{event.age}+</span>
        </div>
        <div className="ticket-edition">
          <span>{demo ? "ДЕМО-БИЛЕТ" : "ЭЛЕКТРОННЫЙ БИЛЕТ"}</span>
          <span>№ {String(ticket.ordinal).padStart(2, "0")}</span>
        </div>
        <h2>{event.title}</h2>
        <p className="ticket-tagline">
          {redMoon ? "КРАСНАЯ ЛУНА. ИНАЯ РЕАЛЬНОСТЬ." : event.subtitle}
        </p>
        <div className="ticket-schedule">
          <div>
            <span>ДАТА</span>
            <strong>{dateLabel(event.date)}</strong>
          </div>
          <div>
            <span>НАЧАЛО</span>
            <strong>{event.time}</strong>
          </div>
          <div className="ticket-year" aria-hidden="true">
            {event.date.slice(0, 4)}
          </div>
        </div>
      </div>
      <div className="ticket-location-row">
        <a
          className="ticket-location"
          href={`https://yandex.ru/maps/?text=${encodeURIComponent(event.address)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${venue}, ${event.address} — открыть в Яндекс Картах`}
        >
          <MapPin size={17} aria-hidden="true" />
          <span>
            <strong>{venue}</strong>
            <span>{event.address}</span>
          </span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
      <div className="ticket-perforation" aria-hidden="true">
        <span />
      </div>
      <div className="ticket-admission">
        <div className="ticket-guest-row">
          <div>
            <span className="ticket-label">ГОСТЬ</span>
            <strong className="ticket-guest">{name}</strong>
          </div>
          <span className="ticket-admit">
            БИЛЕТ {ticket.ordinal}
            {quantity ? ` / ${quantity}` : ""}
          </span>
        </div>
        <div className="ticket-qr-frame">
          <img
            className="ticket-qr"
            src={ticket.qr_image}
            alt={`QR-код билета ${ticket.ordinal}`}
            width="320"
            height="320"
          />
        </div>
        <p className={"ticket-number" + (ticket.used_at ? " ticket-used" : "")}>
          {ticket.used_at ? "Уже использован" : "Покажите QR-код на входе"}
        </p>
        <div className="ticket-serial-row">
          <div>
            <span className="ticket-label">НОМЕР БИЛЕТА</span>
            <code>{ticket.code.slice(0, 8).toUpperCase()}</code>
          </div>
        </div>
        <a className="ticket-own-link" href={"/ticket/" + ticket.code}>
          Открыть отдельный билет <ArrowUpRight size={12} />
        </a>
        <ContactPhone />
      </div>
    </article>
  );
}
