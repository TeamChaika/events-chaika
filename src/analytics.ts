export const METRIKA_ID = 113085427;
export const ANALYTICS_CHOICE_KEY = "chaika.analytics-choice.v1";
export const ANALYTICS_POLICY_VERSION = "2026-09-26.2";
export const COOKIE_SETTINGS_EVENT = "chaika:cookie-settings";
const choiceLifetime = 180 * 86400000;
export type AnalyticsChoice = "allowed" | "denied" | null;

export function readAnalyticsChoice(
  storage: Pick<Storage, "getItem">,
  now = Date.now(),
): AnalyticsChoice {
  try {
    const saved = JSON.parse(storage.getItem(ANALYTICS_CHOICE_KEY) || "null");
    if (
      saved?.version === ANALYTICS_POLICY_VERSION &&
      Number.isFinite(saved.at) &&
      saved.at <= now &&
      now - saved.at < choiceLifetime &&
      ["allowed", "denied"].includes(saved.choice)
    )
      return saved.choice;
  } catch {
    // Unavailable or malformed storage never grants consent.
  }
  return null;
}

export function saveAnalyticsChoice(choice: Exclude<AnalyticsChoice, null>) {
  try {
    localStorage.setItem(
      ANALYTICS_CHOICE_KEY,
      JSON.stringify({
        choice,
        version: ANALYTICS_POLICY_VERSION,
        at: Date.now(),
      }),
    );
  } catch {
    // The current page still respects the choice when storage is blocked.
  }
}

export function analyticsPageUrl(href: string): string | null {
  try {
    const url = new URL(href);
    // Ticket/order URLs are access credentials. Never load third-party code
    // on those routes, staff pages, previews, or the technical hosting domain.
    return url.origin === "https://event.chaika.team" && url.pathname === "/"
      ? "https://event.chaika.team/"
      : null;
  } catch {
    return null;
  }
}

export function analyticsReferrer(referrer: string): string {
  try {
    const url = new URL(referrer);
    return ["http:", "https:"].includes(url.protocol) ? url.origin + "/" : "";
  } catch {
    return "";
  }
}

type Metrika = ((...args: unknown[]) => void) & {
  a?: unknown[][];
  l?: number;
};
declare global {
  interface Window {
    ym?: Metrika;
  }
}

let tag: HTMLScriptElement | undefined;
let active = false;

export function startAnalytics(choice: AnalyticsChoice): void {
  const url = analyticsPageUrl(location.href);
  if (choice !== "allowed" || !url || tag) return;
  const script = document.createElement("script");
  tag = script;
  script.async = true;
  script.src = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`;
  script.referrerPolicy = "no-referrer";
  script.dataset.analytics = "loading";
  script.onload = () => {
    if (tag !== script || !analyticsPageUrl(location.href)) return;
    if (!window.ym) {
      script.dataset.analytics = "unavailable";
      return;
    }
    active = true;
    const referrer = analyticsReferrer(document.referrer);
    window.ym(METRIKA_ID, "init", {
      defer: true,
      webvisor: false,
      clickmap: false,
      trackLinks: false,
      trackHash: false,
      ecommerce: false,
      disableYtm: true,
      sendTitle: false,
      accurateTrackBounce: true,
      url,
      referrer,
    });
    script.dataset.analytics = "initialized";
    window.ym(METRIKA_ID, "hit", url, {
      title: "Афиша · Гастро Двор",
      referer: referrer,
      callback: () => {
        if (tag === script) script.dataset.analytics = "sent";
      },
    });
  };
  script.onerror = () => {
    script.dataset.analytics = "unavailable";
    // Analytics failures must not affect ticket sales or trigger retry loops.
  };
  // The library consumes this documented queue after loading.
  window.ym ||= Object.assign(
    (...args: unknown[]) => {
      window.ym?.a?.push(args);
    },
    { a: [] as unknown[][], l: Date.now() },
  );
  document.head.appendChild(script);
}

export function stopAnalytics(): boolean {
  const wasLoaded = Boolean(tag);
  try {
    if (active) window.ym?.(METRIKA_ID, "destruct");
  } catch {
    // A vendor error must not prevent withdrawal and the following reload.
  }
  active = false;
  if (window.ym?.a) window.ym.a.length = 0;
  if (tag) {
    tag.onload = null;
    tag.onerror = null;
    tag.remove();
    tag = undefined;
  }
  return wasLoaded;
}
