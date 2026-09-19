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
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setAutoPlay(!preference.matches);
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);

  return (
    <VideoCinematicIntro
      ticketUrl={ticketUrl}
      onComplete={onComplete}
      autoPlay={autoPlay}
    />
  );
}
