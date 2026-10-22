import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

export function OdisseyaScene() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [allowMotion, setAllowMotion] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAllowMotion(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !allowMotion || failed) return;
    let inView = false;
    let disposed = false;
    const sync = () => {
      if (paused || !inView || document.hidden) {
        video.pause();
      } else {
        void video.play().catch((error: unknown) => {
          if (
            !disposed &&
            !(error instanceof DOMException && error.name === "AbortError")
          )
            setPaused(true);
        });
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    observer.observe(video);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      video.pause();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [allowMotion, paused, failed]);

  return (
    <>
      <video
        ref={videoRef}
        className="odisseya-sea"
        src={
          allowMotion && !failed
            ? "/assets/odisseya-yalta-loop.mp4"
            : undefined
        }
        data-ready={allowMotion && ready && !failed}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden="true"
        onLoadedData={() => setReady(true)}
        onError={() => setFailed(true)}
      />
      {allowMotion && !failed && (
        <button
          type="button"
          className="odisseya-motion"
          onClick={() => setPaused((value) => !value)}
          aria-label={
            paused ? "Включить анимацию моря" : "Приостановить анимацию моря"
          }
          aria-pressed={paused}
        >
          {paused ? (
            <Play size={12} aria-hidden="true" />
          ) : (
            <Pause size={12} aria-hidden="true" />
          )}
          {paused ? "Оживить море" : "Пауза анимации"}
        </button>
      )}
    </>
  );
}
