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

// Keep playback errors recoverable. Only an ended video or the explicit skip
// action should reveal the ticket, including when a mobile browser suspends media.
export function startVideoIntro(
  video: HTMLVideoElement,
  callbacks: {
    onStarted: () => void;
    onComplete: () => void;
    onPlayRequired: () => void;
  },
  clock: VideoIntroClock = browserClock,
  options: { autoPlay: boolean } = { autoPlay: true },
) {
  let stopped = false;
  let requested = false;
  let started = false;
  let waitingForTap = false;
  let pendingPlay = false;
  let needsReload = false;
  let attempt = 0;
  let lastTime = video.currentTime;
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
    video.removeEventListener("error", onError);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("timeupdate", onProgress);
    unsubscribe();
    video.pause();
  };
  const complete = () => {
    if (stopped) return;
    stop();
    callbacks.onComplete();
  };
  const requireTap = () => {
    if (stopped || waitingForTap) return;
    waitingForTap = true;
    started = false;
    clearTimer();
    deadline = Infinity;
    // pause() would cancel a still-pending play() on slow mobile connections.
    // Leave it intact: a late successful start is also a valid recovery.
    callbacks.onPlayRequired();
  };
  const watchForStall = (delay: number) => {
    clearTimer();
    deadline = clock.now() + delay;
    timer = clock.after(requireTap, delay);
  };
  const onError = () => {
    if (!video.error) return; // Ignore an old queued error after load() reset it.
    needsReload = true;
    pendingPlay = false;
    attempt++;
    requireTap();
  };
  const onEnded = () => {
    if (started) complete();
  };
  const onPause = () => {
    if (started && !video.ended) requireTap();
  };
  const onPlaying = () => {
    if (stopped) return;
    if (!requested) {
      video.pause();
      return;
    }
    pendingPlay = false;
    if (started) return;
    started = true;
    waitingForTap = false;
    lastTime = video.currentTime;
    watchForStall(15000);
    callbacks.onStarted();
  };
  const onProgress = () => {
    if (!started) return;
    if (video.ended) {
      complete();
    } else if (video.currentTime > lastTime && !video.paused) {
      lastTime = video.currentTime;
      watchForStall(15000);
    }
  };
  const tryPlay = (reload = false) => {
    const currentAttempt = ++attempt;
    pendingPlay = true;
    const rejected = (error: unknown) => {
      if (stopped || currentAttempt !== attempt) return;
      pendingPlay = false;
      if (error instanceof Error && error.name === "NotSupportedError") {
        needsReload = true;
      }
      requireTap();
    };
    try {
      if (reload) {
        needsReload = false;
        video.load();
      }
      Promise.resolve(video.play()).then(() => {
        if (currentAttempt === attempt) pendingPlay = false;
      }, rejected);
    } catch (error) {
      rejected(error);
    }
  };
  const play = () => {
    if (stopped) return;
    requested = true;
    waitingForTap = false;
    watchForStall(20000);
    // Reset failed media and play synchronously within the same trusted tap.
    tryPlay(needsReload || video.error !== null);
  };
  const resume = () => {
    if (stopped || waitingForTap) return;
    if (video.ended && started) {
      complete();
    } else if (clock.now() >= deadline) {
      requireTap();
    } else if (!pendingPlay && video.paused) {
      tryPlay();
    }
  };

  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.addEventListener("playing", onPlaying);
  video.addEventListener("ended", onEnded);
  video.addEventListener("error", onError);
  video.addEventListener("pause", onPause);
  video.addEventListener("timeupdate", onProgress);
  unsubscribe = clock.subscribe(resume);
  if (options.autoPlay) play();
  else requireTap();
  return { stop, play };
}
