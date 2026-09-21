import { useEffect } from "react";
import { Brand } from "./ui";
import "./moon-loader.css";

export function MoonLoader({
  revealing = false,
  ready,
  playing,
}: {
  revealing?: boolean;
  ready: boolean;
  playing: boolean;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className={
        "moon-loader" +
        (revealing ? " is-revealing" : "") +
        (ready ? " is-ready" : "") +
        (playing ? " is-playing" : "")
      }
      role="status"
      aria-label="Загружаем афишу. Ночь приближается."
    >
      <div className="loader-clouds loader-clouds-back" aria-hidden="true" />
      <div className="loader-brand" inert aria-hidden="true">
        <Brand />
      </div>
      <div className="loader-cosmos" aria-hidden="true">
        <div className="loader-halo" />
        <div className="loader-orbit" />
        <div className="loader-moon" />
        <span className="loader-coordinate">31° / RED MOON RISING</span>
      </div>
      <div className="loader-clouds loader-clouds-front" aria-hidden="true" />
      <div className="loader-copy" aria-hidden="true">
        <span className="micro">ПО ТУ СТОРОНУ ОБЫЧНОГО</span>
        <p>
          Ночь приближается<span>.</span>
        </p>
        <div className="loader-line">
          <span />
        </div>
        <small>ЗАГРУЖАЕМ ВАШУ НОЧЬ</small>
      </div>
    </div>
  );
}
