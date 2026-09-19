import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import "./cinematic-intro.css";

const CINEMATIC_INTRO_DURATION = 4800;

// A browser-rendered alternative to video. The heroine remains the original
// still artwork; the invitation and atmosphere move independently around her.
export function CinematicIntro({
  qrImage,
  age,
  demo,
  onComplete,
}: {
  qrImage: string;
  age: number;
  demo: boolean;
  onComplete: () => void;
}) {
  const [revealing, setRevealing] = useState(false);
  const complete = useRef(onComplete);
  complete.current = onComplete;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") complete.current();
    };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealTimer = setTimeout(
      () => setRevealing(true),
      reduced ? 0 : CINEMATIC_INTRO_DURATION,
    );
    const finishTimer = setTimeout(
      () => complete.current(),
      reduced ? 0 : CINEMATIC_INTRO_DURATION + 550,
    );
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(revealTimer);
      clearTimeout(finishTimer);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      className={"cinematic-intro" + (revealing ? " is-revealing" : "")}
      role="dialog"
      aria-modal="true"
      aria-label="Открываем ваш билет на Ночь красной луны"
    >
      <div className="cinema-art" aria-hidden="true" />
      <div className="cinema-aura" aria-hidden="true" />
      <div className="cinema-fog" aria-hidden="true" />
      <div className="cinema-vignette" aria-hidden="true" />

      <div className="cinema-topline" aria-hidden="true">
        <span>
          <i /> RED MOON EXPERIENCE
        </span>
        <span>ПО ТУ СТОРОНУ ОБЫЧНОГО</span>
      </div>

      <div className="cinema-invitation" aria-hidden="true">
        <div className="cinema-pass">
          <div className="cinema-pass-shine" />
          <header>
            <span>RED MOON</span>
            <ArrowUpRight size={20} />
          </header>
          <div className="cinema-pass-moon" />
          <p>
            ДРУГАЯ
            <br />
            <em>РЕАЛЬНОСТЬ</em>
          </p>
          <div className="cinema-qr">
            <img src={qrImage} width="132" height="132" alt="" />
          </div>
          <footer>
            <span>{demo ? "ДЕМО-БИЛЕТ" : "ВАШ БИЛЕТ"}</span>
            <span>{age}+</span>
          </footer>
        </div>
        <div className="cinema-pass-shadow" />
      </div>

      <div className="cinema-caption" aria-hidden="true">
        <span>КРАСНАЯ ЛУНА. ИНАЯ РЕАЛЬНОСТЬ.</span>
        <p>
          Ваш билет <em>готов.</em>
        </p>
        <div className="cinema-progress">
          <i />
        </div>
      </div>
      <button className="cinema-skip" onClick={onComplete} autoFocus>
        Пропустить <ArrowUpRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
