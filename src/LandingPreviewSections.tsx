import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Expand,
  X,
} from "lucide-react";
import { dateLabel, money, type EventData } from "./types";
import "./landing-preview.css";

const asset = (name: string) => `/assets/landing-preview/${name}.webp`;
type Artist = { name: string; image: string; poster?: string; time: string };
const stages: {
  number: string;
  name: string;
  opening: string;
  artists: Artist[];
}[] = [
  {
    number: "01",
    name: "Главная сцена",
    opening: "21:00 — 21:40 · Шоу-перформанс",
    artists: [
      {
        name: "DIBIDABO",
        image: "dibidabo",
        poster: "poster-dibidabo",
        time: "21:40 — 23:00",
      },
      {
        name: "NERAK",
        image: "nerak",
        poster: "poster-nerak",
        time: "23:00 — 00:30",
      },
      {
        name: "РОМА BUSHA",
        image: "roma-busha",
        poster: "poster-roma-busha",
        time: "00:30 — 02:00",
      },
    ],
  },
  {
    number: "02",
    name: "Альтернативная сцена",
    opening: "21:00 — 02:00 · Другая сторона ночи",
    artists: [
      {
        name: "MARTIN.W",
        image: "martin-w",
        poster: "poster-martin-w",
        time: "21:00 — 22:30",
      },
      {
        name: "LEON",
        image: "leo-n",
        poster: "poster-leo-n",
        time: "22:30 — 00:00",
      },
      {
        name: "JOHNNY T",
        image: "johny-t",
        poster: "poster-johny-t",
        time: "00:00 — 02:00",
      },
    ],
  },
];

function ArtistArtwork({ artist }: { artist: Artist }) {
  const [posterFailed, setPosterFailed] = useState(false);
  const poster = posterFailed ? undefined : artist.poster;
  return (
    <div className={`lp-portrait${poster ? "" : " lp-portrait-pending"}`}>
      <img
        src={asset(poster || artist.image)}
        width="800"
        height="1000"
        loading="lazy"
        decoding="async"
        alt={
          poster ? `Афиша ${artist.name} — Ночь красной луны, 31 октября` : ""
        }
        onError={poster ? () => setPosterFailed(true) : undefined}
      />
      {!poster && (
        <div className="lp-poster-pending-copy">
          <span>НОЧЬ КРАСНОЙ ЛУНЫ</span>
          <strong>АФИША СКОРО</strong>
          <span>{artist.name}</span>
        </div>
      )}
    </div>
  );
}
const looks = [
  "Красный монохром и выразительная маска",
  "Бальная эстетика в современной интерпретации",
  "Геометрия силуэта и глубокий чёрный",
  "Архитектура корсета и смелые детали",
  "Контраст красного и чёрного",
  "Парные образы и маски на глаза",
  "Необычные формы и фактуры",
  "Акцентные детали вечернего образа",
];

function Gallery({ close, initial }: { close: () => void; initial: number }) {
  const [index, setIndex] = useState(initial);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current?.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, []);
  const move = (step: number) =>
    setIndex((current) => (current + step + looks.length) % looks.length);
  return (
    <dialog
      ref={dialog}
      className="lp-lightbox"
      aria-label="Галерея дресс-кода"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          move(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div className="lp-lightbox-inner">
        <button
          className="lp-lightbox-close"
          onClick={close}
          aria-label="Закрыть галерею"
          autoFocus
        >
          <X size={23} />
        </button>
        <img src={asset(`dress-${index + 1}`)} alt={looks[index]} />
        <div className="lp-lightbox-controls">
          <button onClick={() => move(-1)} aria-label="Предыдущий образ">
            <ChevronLeft />
          </button>
          <p aria-live="polite">
            Образ {index + 1} <span>/ {looks.length}</span>
          </p>
          <button onClick={() => move(1)} aria-label="Следующий образ">
            <ChevronRight />
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default function LandingPreviewSections({
  event,
  canBuy,
  onBuy,
}: {
  event: EventData;
  canBuy: boolean;
  onBuy: () => void;
}) {
  const [look, setLook] = useState<number | null>(null);
  return (
    <div className="lp">
      <nav className="lp-nav lp-wrap" aria-label="О вечеринке">
        {[
          ["about", "О событии"],
          ["lineup", "Лайнап"],
          ["dresscode", "Дресс-код"],
          ["collab", "Организаторы"],
        ].map(([id, label], i) => (
          <a key={id} href={`#${id}`}>
            <span>0{i + 1}</span>
            {label}
            <ArrowDown size={14} />
          </a>
        ))}
      </nav>

      <section
        id="about"
        className="lp-about lp-section lp-wrap"
        aria-labelledby="lp-about-title"
      >
        <div className="lp-eyebrow">
          <span /> О СОБЫТИИ <i>01 / 04</i>
        </div>
        <div className="lp-about-grid">
          <h2 id="lp-about-title" className="lp-display">
            БОЛЬШЕ,
            <br />
            ЧЕМ <em>ВЕЧЕРИНКА.</em>
          </h2>
          <div className="lp-about-copy">
            <p className="lp-lead">
              Новая точка притяжения для тех, кто выбирает музыку, эмоции и
              особую атмосферу.
            </p>
            <p>
              Ночь красной луны объединит творческую команду «Чайка Team» и
              команду вечеринок Sunset Vibes. Масштабный формат, яркий лайнап и
              энергия ночи, которая останется в памяти надолго.
            </p>
            <p>
              Это пространство, где встречаются музыка, люди и моменты, которые
              невозможно повторить. Два танцпола, одна ночь и миллион
              впечатлений.
            </p>
          </div>
        </div>
        <div className="lp-facts">
          <div>
            <strong>02</strong>
            <span>
              ТАНЦПОЛА
              <br />
              <small>Два звучания одной ночи</small>
            </span>
          </div>
          <div>
            <strong>06</strong>
            <span>
              ДИДЖЕЕВ
              <br />
              <small>От первого сета до финала</small>
            </span>
          </div>
          <div>
            <strong>20:30</strong>
            <span>
              СБОР ГОСТЕЙ
              <br />
              <small>{dateLabel(event.date)} · Ялта</small>
            </span>
          </div>
        </div>
      </section>

      <section
        id="lineup"
        className="lp-lineup lp-section"
        aria-labelledby="lp-lineup-title"
      >
        <div className="lp-wrap">
          <div className="lp-eyebrow">
            <span /> МУЗЫКА <i>02 / 04</i>
          </div>
          <div className="lp-heading-row">
            <h2 id="lp-lineup-title" className="lp-display">
              ЗВУК
              <br />
              <em>ЭТОЙ НОЧИ.</em>
            </h2>
            <div className="lp-section-aside">
              <p>
                Две сцены. Разные ритмы.
                <br />
                Одна общая энергия.
              </p>
              <span>LINE UP / {event.date.slice(0, 4)}</span>
            </div>
          </div>
          {stages.map((stage) => (
            <div className="lp-stage" key={stage.number}>
              <div className="lp-stage-heading">
                <h3>
                  <span>{stage.number}</span>
                  {stage.name}
                </h3>
                <p>{stage.opening}</p>
              </div>
              <div className="lp-artists">
                {stage.artists.map((artist) => (
                  <article className="lp-artist" key={artist.name}>
                    <ArtistArtwork artist={artist} />
                    <div className="lp-artist-caption">
                      <h4>{artist.name}</h4>
                      <span>{artist.time}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        id="dresscode"
        className="lp-dresscode lp-section lp-wrap"
        aria-labelledby="lp-dresscode-title"
      >
        <div className="lp-eyebrow">
          <span /> ОБРАЗ НОЧИ <i>03 / 04</i>
        </div>
        <div className="lp-heading-row">
          <h2 id="lp-dresscode-title" className="lp-display">
            ДРЕСС-КОД.
          </h2>
          <p className="lp-dress-intro">
            Когда появляется красная луна, наружу выходит то, что обычно скрыто.
            Образ этой ночи — отражение собственной энергии через форму, цвет и
            детали.
          </p>
        </div>
        <div className="lp-dress-rules">
          <div>
            <span className="lp-rule-number">01 / ПАЛИТРА</span>
            <div className="lp-swatches" aria-hidden="true">
              <i />
              <i />
            </div>
            <h3>Чёрный. Красный.</h3>
            <p>
              Глубокий чёрный и насыщенный красный. Контраст, выразительность и
              сила в каждом оттенке.
            </p>
          </div>
          <div>
            <span className="lp-rule-number">02 / СИЛУЭТ</span>
            <h3>Геометрия свободы.</h3>
            <p>
              Бальная эстетика через призму сюрреализма. Острые линии,
              асимметрия, баллонные юбки, архитектурные корсеты и смелый
              монохром.
            </p>
          </div>
          <div>
            <span className="lp-rule-number">03 / ГЛАВНЫЙ АТРИБУТ</span>
            <h3>Маска на глаза.</h3>
            <p>
              Шёлк, чёрное кружево, геометрический акрил, зеркальные или
              жидкокристаллические вставки. Маска не прячет личность — она
              становится частью образа.
            </p>
          </div>
        </div>
        <div className="lp-gallery-heading">
          <span>ВДОХНОВЕНИЕ ДЛЯ ВАШЕГО ОБРАЗА</span>
          <span>
            Нажмите, чтобы рассмотреть <Expand size={14} />
          </span>
        </div>
        <div className="lp-gallery">
          {looks.map((alt, i) => (
            <button
              key={alt}
              onClick={() => setLook(i)}
              aria-label={`Рассмотреть образ ${i + 1}: ${alt}`}
            >
              <img
                src={asset(`dress-${i + 1}`)}
                alt={alt}
                width="1000"
                height="1000"
                loading="lazy"
                decoding="async"
              />
              <span>
                0{i + 1}
                <Expand size={16} />
              </span>
            </button>
          ))}
        </div>
        <blockquote className="lp-quote">
          Эта ночь — не о том, чтобы стать кем-то другим.{" "}
          <br />
          <em>
            Она о том, чтобы показать ту сторону себя,
            <br className="lp-desktop-break" /> которая обычно остаётся
            невидимой.
          </em>
        </blockquote>
      </section>

      <section
        id="collab"
        className="lp-collab lp-section"
        aria-labelledby="lp-collab-title"
      >
        <div className="lp-wrap">
          <div className="lp-eyebrow">
            <span /> КОЛЛАБОРАЦИЯ <i>04 / 04</i>
          </div>
          <div className="lp-heading-row">
            <h2 id="lp-collab-title" className="lp-display">
              ДВЕ КОМАНДЫ.
              <br />
              <em>ОДНА ОРБИТА.</em>
            </h2>
            <p className="lp-dress-intro">
              Разные истории. Общая страсть к музыке, людям и событиям, которые
              хочется проживать вместе.
            </p>
          </div>
          <div className="lp-organizers">
            <article>
              <div className="lp-organizer-logo">
                <img
                  src="/assets/gastro-dvor.png"
                  width="2084"
                  height="1049"
                  alt="Гастро Двор"
                  loading="lazy"
                />
              </div>
              <span className="lp-rule-number">КОМАНДА «ЧАЙКА TEAM»</span>
              <h3>
                Место встречи —<br />
                Гастро Двор.
              </h3>
              <p>
                Творческая команда сети «Чайка Team» и Гастро Двор объединяют
                пространство, гастрономию и атмосферу для новой встречи под
                красной луной.
              </p>
            </article>
            <span className="lp-collab-cross" aria-label="совместно с">
              ×
            </span>
            <article>
              <div className="lp-organizer-logo">
                <img
                  src="/assets/sunset-vibes.png"
                  width="1072"
                  height="366"
                  alt="Sunset Vibes"
                  loading="lazy"
                />
              </div>
              <span className="lp-rule-number">КОМАНДА SUNSET VIBES</span>
              <h3>
                Музыка, которая
                <br />
                объединяет.
              </h3>
              <p>
                Команда вечеринок Sunset Vibes привносит в коллаборацию своё
                звучание и энергию. В центре — музыка, эмоции и моменты, которые
                невозможно повторить.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-finale lp-wrap" aria-labelledby="lp-finale-title">
        <div className="lp-finale-moon" aria-hidden="true" />
        <span className="lp-eyebrow">
          {dateLabel(event.date).toUpperCase()} · {event.venue.toUpperCase()} ·
          ЯЛТА
        </span>
        <h2 id="lp-finale-title" className="lp-display">
          УВИДИМСЯ ПОД
          <br />
          <em>КРАСНОЙ ЛУНОЙ.</em>
        </h2>
        <p>
          Красная луна восходит лишь однажды.
          <br />
          Увидеть её можно только этой ночью.
        </p>
        <button className="button primary" disabled={!canBuy} onClick={onBuy}>
          {canBuy ? "Быть частью ночи" : "Продажа закрыта"}
          <ArrowUpRight size={21} />
        </button>
        <span className="lp-finale-price">
          {money(event.price)} / за одного гостя
        </span>
      </section>
      {look !== null && <Gallery initial={look} close={() => setLook(null)} />}
    </div>
  );
}
