import { useEffect, useState } from "react";
import { prepareIntroImages, startVisibleIntroTimer } from "./introPlayback";

export const MOON_INTRO_IMAGES = [
  "/assets/moon-color.jpg",
  "/assets/red-clouds.svg",
] as const;
export const MOON_INTRO_DURATION = 4200;
export const TICKET_INTRO_DURATION = 6500;

export function useIntroPlayback(images: readonly string[], duration: number) {
  const [preparedImages, setPreparedImages] = useState<readonly string[]>();
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const ready = preparedImages === images;

  useEffect(() => {
    setFinished(false);
    return prepareIntroImages(images, () => setPreparedImages(images));
  }, [images]);

  useEffect(() => {
    if (!ready) return;
    return startVisibleIntroTimer(
      duration,
      () => setFinished(true),
      setPlaying,
    );
  }, [ready, images, duration]);

  return { ready, playing: ready && playing, finished };
}
