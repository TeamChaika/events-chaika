import { useEffect, useState } from "react";
import { VideoCinematicIntro } from "./VideoCinematicIntro";
import "./cinematic-intro.css";

export function CinematicIntro({
  ticketUrl,
  onComplete,
}: {
  ticketUrl: string;
  onComplete: () => void;
}) {
  const [autoPlay, setAutoPlay] = useState(
    () => !matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [pageVisible, setPageVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const syncVisibility = () =>
      setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("pageshow", syncVisibility);
    syncVisibility();
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("pageshow", syncVisibility);
    };
  }, []);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setAutoPlay(!preference.matches);
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);

  return (
    <VideoCinematicIntro
      // Remount on return so an invitation cannot finish unseen in another app.
      key={pageVisible ? "visible" : "hidden"}
      ticketUrl={ticketUrl}
      onComplete={onComplete}
      autoPlay={autoPlay && pageVisible}
    />
  );
}
