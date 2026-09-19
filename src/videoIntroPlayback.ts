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

// Autoplay denial is recoverable through a direct user gesture. Media failures
// release the ticket; neither case should replace the current invitation.
export function startVideoIntro(
  video: HTMLVideoElement,
  callbacks: {
    onStarted: () => void;
    onComplete: () => void;
    onPlayRequired: () => void;
    onUnavailable: () => void;
  },
  clock: VideoIntroClock = browserClock,
  options: { autoPlay: boolean } = { autoPlay: true },
) {
  let stopped = false;
  let started = false;
  let waitingForTap = false;
  let attempt = 0;
  let deadline = Infinity;
  let timer: number | undefined;
  let unsubscribe = () => {};

  const clearTimer = () => {
    if (timer !== undefined) clock.cancel(timer);
    timer = undefined;
  };
  const stop = () => {
    stopped = true;
    attempt++;
    clearTimer();
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("ended", onEnded);
    video.removeEventListener("error", unavailable);
    unsubscribe();
    video.pause();
  };
  const finish = (callback: () => void) => {
    if (stopped) return;
    stop();
    callback();
  };
  const complete = () => finish(callbacks.onComplete);
  const unavailable = () => finish(callbacks.onUnavailable);
  const requireTap = () => {
    if (stopped || waitingForTap) return;
    waitingForTap = true;
    attempt++;
    clearTimer();
    deadline = Infinity;
    video.pause();
    callbacks.onPlayRequired();
  };
  const onEnded = () => {
    if (started && !waitingForTap) complete();
  };
  const onPlaying = () => {
    if (stopped) return;
    if (waitingForTap) {
      video.pause();
      return;
    }
    if (started) return;
    started = true;
    clearTimer();
    // The published clip lasts 8 seconds; the extra time allows brief buffering.
    deadline = clock.now() + 12000;
    timer = clock.after(complete, 12000);
    callbacks.onStarted();
  };
  const tryPlay = () => {
    const currentAttempt = ++attempt;
    const rejected = (error: unknown) => {
      if (stopped || waitingForTap || currentAttempt !== attempt) return;
      if (error instanceof Error && error.name === "NotSupportedError") {
        unavailable();
      } else {
        requireTap();
      }
    };
    try {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      Promise.resolve(video.play()).catch(rejected);
    } catch (error) {
      rejected(error);
    }
  };
  const play = () => {
    if (stopped) return;
    waitingForTap = false;
    started = false;
    clearTimer();
    deadline = clock.now() + 12000;
    timer = clock.after(requireTap, 12000);
    // Keep this call synchronous: iOS requires play() inside the click handler.
    tryPlay();
  };
  const resume = () => {
    if (stopped || waitingForTap) return;
    if (clock.now() >= deadline) {
      (started ? complete : requireTap)();
    } else if (video.paused && !video.ended) {
      tryPlay();
    }
  };

  video.addEventListener("playing", onPlaying);
  video.addEventListener("ended", onEnded);
  video.addEventListener("error", unavailable);
  unsubscribe = clock.subscribe(resume);
  if (options.autoPlay) play();
  else requireTap();
  return { stop, play };
}
