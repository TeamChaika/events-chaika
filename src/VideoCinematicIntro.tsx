import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import { startVideoIntro } from "./videoIntroPlayback";
import "./video-cinematic-intro.css";

export function VideoCinematicIntro({
  ticketUrl,
  onComplete,
  onFallback,
}: {
  ticketUrl: string;
  onComplete: () => void;
  onFallback: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const openTicketLink = useRef<HTMLAnchorElement>(null);
  const callbacks = useRef({ onComplete, onFallback });
  callbacks.current = { onComplete, onFallback };
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    openTicketLink.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") callbacks.current.onComplete();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!video.current) return;
    return startVideoIntro(video.current, {
      onStarted: () => setReady(true),
      onComplete: () => setRevealing(true),
      onFallback: () => callbacks.current.onFallback(),
    });
  }, []);

  useEffect(() => {
    if (!revealing) return;
    const timer = window.setTimeout(() => callbacks.current.onComplete(), 550);
    return () => window.clearTimeout(timer);
  }, [revealing]);

  return (
    <div
      className={
        "cinematic-intro cinema-video-intro" +
        (ready ? " is-ready is-playing" : "") +
        (revealing ? " is-revealing" : "")
      }
      role="dialog"
      aria-modal="true"
      aria-label="Открываем ваш билет на Ночь красной луны"
    >
      <div className="cinema-video-backdrop" aria-hidden="true" />
      <div className="cinema-video-stage" aria-hidden="true">
        <video
          ref={video}
          src="/assets/ticket-intro-printed-qr.mp4"
          poster="/assets/ticket-intro-printed-qr.jpg"
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        />
      </div>
      <div className="cinema-vignette" aria-hidden="true" />
      <div className="cinema-topline" aria-hidden="true">
        <span>
          <i /> RED MOON EXPERIENCE
        </span>
        <span>ПО ТУ СТОРОНУ ОБЫЧНОГО</span>
      </div>
      {!ready && (
        <p className="cinema-preparing" role="status">
          Открываем вашу ночь…
        </p>
      )}
      <div className="cinema-caption" aria-hidden="true">
        <span>КРАСНАЯ ЛУНА. ИНАЯ РЕАЛЬНОСТЬ.</span>
        <p>
          {time >= 5.5 ? (
            <>
              Ваш билет <em>готов.</em>
            </>
          ) : (
            <>
              Ваша ночь <em>начинается.</em>
            </>
          )}
        </p>
        <div className="cinema-progress">
          <i
            style={
              { "--video-progress": Math.min(1, time / 8) } as CSSProperties
            }
          />
        </div>
      </div>
      <a className="cinema-skip" href={ticketUrl} ref={openTicketLink}>
        Открыть билет <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </div>
  );
}
