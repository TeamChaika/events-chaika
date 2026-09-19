import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import { startVideoIntro } from "./videoIntroPlayback";
import "./video-cinematic-intro.css";

// Measured against the final held-card frames of the published 720 × 1280 clip.
const qrTrack = [
  { time: 5.5, x: 289, y: 827 },
  { time: 6.5, x: 281, y: 841 },
  { time: 7.5, x: 266, y: 829 },
  { time: 8.05, x: 262, y: 826 },
];

function qrPosition(time: number) {
  const end = qrTrack.findIndex((frame) => frame.time >= time);
  if (end <= 0) return qrTrack[end === -1 ? qrTrack.length - 1 : 0];
  const from = qrTrack[end - 1];
  const to = qrTrack[end];
  const progress = (time - from.time) / (to.time - from.time);
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}

export function VideoCinematicIntro({
  qrImage,
  ticketUrl,
  onComplete,
  onFallback,
}: {
  qrImage: string;
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
  const qr = qrPosition(time);

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
          src="/assets/ticket-intro-seedance25.mp4"
          poster="/assets/ticket-intro-poster.jpg"
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        />
        <svg
          className="cinema-video-qr"
          viewBox="0 0 720 1280"
          style={{ opacity: ready && time >= 5.5 ? 1 : 0 }}
        >
          <g transform={`translate(${qr.x} ${qr.y}) rotate(-1.5 96 96)`}>
            <image href={qrImage} width="192" height="192" />
          </g>
        </svg>
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
