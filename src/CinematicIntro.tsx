import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ArrowUpRight } from "lucide-react";
import { VideoCinematicIntro } from "./VideoCinematicIntro";
import "./cinematic-intro.css";
import {
  useIntroPlayback,
  MOON_INTRO_IMAGES,
  TICKET_INTRO_DURATION,
} from "./useIntroPlayback";

interface CinematicIntroProps {
  qrImage: string;
  age: number;
  demo: boolean;
  ticketUrl: string;
  onComplete: () => void;
}

export function CinematicIntro(props: CinematicIntroProps) {
  const [useVideo, setUseVideo] = useState(
    () => !matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      if (preference.matches) setUseVideo(false);
    };
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);

  return useVideo ? (
    <VideoCinematicIntro {...props} onFallback={() => setUseVideo(false)} />
  ) : (
    <StillCinematicIntro {...props} />
  );
}

// Keep the existing scene for reduced motion and browsers that block video.
function StillCinematicIntro({
  qrImage,
  age,
  demo,
  ticketUrl,
  onComplete,
}: CinematicIntroProps) {
  const [revealing, setRevealing] = useState(false);
  const images = useMemo(
    () => ["/assets/red-moon.png", ...MOON_INTRO_IMAGES, qrImage],
    [qrImage],
  );
  const { ready, playing, finished } = useIntroPlayback(
    images,
    TICKET_INTRO_DURATION,
  );
  const complete = useRef(onComplete);
  const openTicketLink = useRef<HTMLAnchorElement>(null);
  complete.current = onComplete;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    openTicketLink.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") complete.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!finished) return;
    setRevealing(true);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => complete.current(),
      reduced ? 0 : 550,
    );
    return () => window.clearTimeout(timer);
  }, [finished]);

  return (
    <div
      className={
        "cinematic-intro" +
        (revealing ? " is-revealing" : "") +
        (ready ? " is-ready" : "") +
        (playing ? " is-playing" : "")
      }
      style={
        { "--intro-duration": `${TICKET_INTRO_DURATION}ms` } as CSSProperties
      }
      role="dialog"
      aria-modal="true"
      aria-label="Открываем ваш билет на Ночь красной луны"
    >
      {!ready && (
        <p className="cinema-preparing" role="status">
          Открываем вашу ночь…
        </p>
      )}
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
      <a className="cinema-skip" href={ticketUrl} ref={openTicketLink}>
        Открыть билет <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </div>
  );
}
