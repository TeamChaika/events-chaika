import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Play } from "lucide-react";
import { startVideoIntro } from "./videoIntroPlayback";
import "./video-cinematic-intro.css";

export function VideoCinematicIntro({
  ticketUrl,
  onComplete,
  autoPlay,
}: {
  ticketUrl: string;
  onComplete: () => void;
  autoPlay: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const openTicketLink = useRef<HTMLAnchorElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const playback = useRef<ReturnType<typeof startVideoIntro> | null>(null);
  const [ready, setReady] = useState(false);
  const [waitingForTap, setWaitingForTap] = useState(!autoPlay);
  const [time, setTime] = useState(0);
  const [revealing, setRevealing] = useState(false);

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
    if (!video.current) return;
    setReady(false);
    setWaitingForTap(!autoPlay);
    const controller = startVideoIntro(
      video.current,
      {
        onStarted: () => {
          setReady(true);
          setWaitingForTap(false);
        },
        onPlayRequired: () => {
          setReady(false);
          setWaitingForTap(true);
        },
        onComplete: () => setRevealing(true),
      },
      undefined,
      { autoPlay },
    );
    playback.current = controller;
    return () => {
      controller.stop();
      playback.current = null;
    };
  }, [autoPlay]);

  useEffect(() => {
    if (waitingForTap) playButton.current?.focus({ preventScroll: true });
  }, [waitingForTap]);

  useEffect(() => {
    if (!revealing) return;
    const timer = window.setTimeout(() => complete.current(), 550);
    return () => window.clearTimeout(timer);
  }, [revealing]);

  return (
    <div
      className={
        "cinematic-intro cinema-video-intro" +
        (ready || waitingForTap ? " is-ready" : "") +
        (ready ? " is-playing" : "") +
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
          src="/assets/ticket-intro-mriya-envelope-mobile.mp4"
          poster="/assets/ticket-intro-mriya-envelope.jpg"
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
      {!ready && !waitingForTap && (
        <p className="cinema-preparing" role="status">
          Открываем вашу ночь…
        </p>
      )}
      {waitingForTap && (
        <button
          type="button"
          ref={playButton}
          className="cinema-play"
          onClick={() => {
            setWaitingForTap(false);
            playback.current?.play();
          }}
        >
          <Play size={20} fill="currentColor" aria-hidden="true" />
          Смотреть приглашение
        </button>
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
