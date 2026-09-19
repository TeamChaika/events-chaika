interface VideoIntroClock {
  now: () => number;
  after: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
  subscribe: (callback: () => void) => () => void;
}

const browserClock: VideoIntroClock = {
  now: () => Date.now(),
  after: (callback, delay) => window.setTimeout(callback, delay),
  cancel: (timer) => window.clearTimeout(timer),
  subscribe: (callback) => {
    window.addEventListener("pageshow", callback);
    window.addEventListener("focus", callback);
    return () => {
      window.removeEventListener("pageshow", callback);
      window.removeEventListener("focus", callback);
    };
  },
};

// Media events determine the normal duration. Independent deadlines cover
// blocked autoplay, failed downloads and a stalled mobile media decoder.
export function startVideoIntro(
  video: HTMLVideoElement,
  callbacks: {
    onStarted: () => void;
    onComplete: () => void;
    onFallback: () => void;
  },
  clock: VideoIntroClock = browserClock,
) {
  let stopped = false;
  let started = false;
  let deadline = clock.now() + 8000;
  let timer: number | undefined;
  let unsubscribe = () => {};

  const stop = () => {
    stopped = true;
    if (timer !== undefined) clock.cancel(timer);
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("ended", complete);
    video.removeEventListener("error", fallback);
    unsubscribe();
    video.pause();
  };
  const finish = (callback: () => void) => {
    if (stopped) return;
    stop();
    callback();
  };
  const complete = () => finish(callbacks.onComplete);
  const fallback = () => finish(callbacks.onFallback);
  const onPlaying = () => {
    if (stopped || started) return;
    started = true;
    if (timer !== undefined) clock.cancel(timer);
    // The published clip lasts 8 seconds; the extra time allows brief buffering.
    deadline = clock.now() + 12000;
    timer = clock.after(complete, 12000);
    callbacks.onStarted();
  };
  const play = () => {
    try {
      Promise.resolve(video.play()).catch(fallback);
    } catch {
      fallback();
    }
  };
  const resume = () => {
    if (stopped) return;
    if (clock.now() >= deadline) {
      (started ? complete : fallback)();
    } else if (video.paused && !video.ended) {
      play();
    }
  };

  video.addEventListener("playing", onPlaying);
  video.addEventListener("ended", complete);
  video.addEventListener("error", fallback);
  unsubscribe = clock.subscribe(resume);
  timer = clock.after(fallback, 8000);
  play();
  return stop;
}
