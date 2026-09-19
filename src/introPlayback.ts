export interface IntroClock {
  now: () => number;
  visible: () => boolean;
  after: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
  subscribe: (callback: () => void) => () => void;
}

const browserClock: IntroClock = {
  now: () => Date.now(),
  visible: () => document.visibilityState !== "hidden",
  after: (callback, delay) => window.setTimeout(callback, delay),
  cancel: (timer) => window.clearTimeout(timer),
  subscribe: (callback) => {
    document.addEventListener("visibilitychange", callback);
    window.addEventListener("pageshow", callback);
    window.addEventListener("focus", callback);
    return () => {
      document.removeEventListener("visibilitychange", callback);
      window.removeEventListener("pageshow", callback);
      window.removeEventListener("focus", callback);
    };
  },
};

// Preserve short foreground interruptions, but never let a stale mobile
// visibility state leave the intro blocking access to the ticket indefinitely.
export function startVisibleIntroTimer(
  duration: number,
  onComplete: () => void,
  onPlaying: (playing: boolean) => void,
  clock: IntroClock = browserClock,
) {
  let remaining = duration;
  let started: number | null = null;
  let timer: number | undefined;
  let deadlineTimer: number | undefined;
  let stopped = false;
  let unsubscribe = () => {};
  const maxDuration = duration + 4000;
  const deadline = clock.now() + maxDuration;
  const pause = () => {
    if (timer !== undefined) clock.cancel(timer);
    timer = undefined;
    if (started !== null)
      remaining = Math.max(0, remaining - (clock.now() - started));
    started = null;
  };
  const stop = () => {
    stopped = true;
    pause();
    if (deadlineTimer !== undefined) clock.cancel(deadlineTimer);
    unsubscribe();
  };
  const finish = () => {
    if (stopped) return;
    stop();
    onPlaying(false);
    onComplete();
  };
  const update = () => {
    if (stopped) return;
    if (clock.now() >= deadline) {
      finish();
      return;
    }
    pause();
    const visible = clock.visible();
    onPlaying(visible);
    if (!visible) return;
    started = clock.now();
    timer = clock.after(() => {
      if (!clock.visible()) {
        update();
        return;
      }
      finish();
    }, remaining);
  };
  unsubscribe = clock.subscribe(update);
  deadlineTimer = clock.after(finish, maxDuration);
  update();
  return stop;
}

export interface IntroImage {
  src: string;
  onload: HTMLImageElement["onload"];
  onerror: HTMLImageElement["onerror"];
  decode?: () => Promise<void>;
}

// CSS backgrounds have no load event. Preload and decode them before playback,
// but keep a bounded fallback so a broken asset never blocks the ticket.
export function prepareIntroImages(
  urls: readonly string[],
  onReady: () => void,
  options: {
    createImage: () => IntroImage;
    after: (callback: () => void, delay: number) => number;
    cancel: (timer: number) => void;
  } = {
    createImage: () => new Image(),
    after: (callback, delay) => window.setTimeout(callback, delay),
    cancel: (timer) => window.clearTimeout(timer),
  },
) {
  let stopped = false;
  let remaining = urls.length;
  const images: IntroImage[] = [];
  const finish = () => {
    if (stopped) return;
    stopped = true;
    options.cancel(timeout);
    for (const image of images) image.onload = image.onerror = null;
    onReady();
  };
  const timeout = options.after(finish, 8000);
  for (const url of urls) {
    const image = options.createImage();
    let settled = false;
    const done = () => {
      if (stopped || settled) return;
      settled = true;
      remaining -= 1;
      if (remaining === 0) finish();
    };
    image.onload = () => {
      Promise.resolve()
        .then(() => image.decode?.())
        .catch(() => {})
        .then(done);
    };
    image.onerror = done;
    images.push(image);
    image.src = url;
  }
  if (!remaining) finish();
  return () => {
    stopped = true;
    options.cancel(timeout);
    for (const image of images) image.onload = image.onerror = null;
  };
}
