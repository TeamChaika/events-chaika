import {
  ANALYTICS_CHOICE_EVENT,
  ANALYTICS_POLICY_VERSION,
  readAnalyticsChoice,
} from "./analytics";

export const ATTRIBUTION_KEY = "chaika.attribution.v1";
export const ATTRIBUTION_TTL = 30 * 86400000;
type Visit = { first: string; last: string; at: number };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const current = new Map<string, Visit>();
const initial = new Map<string, string>();
function allowed() {
  try {
    return readAnalyticsChoice(localStorage) === "allowed";
  } catch {
    return false;
  }
}
function saved(): Record<string, Visit> {
  try {
    if (!allowed()) {
      localStorage.removeItem(ATTRIBUTION_KEY);
      return {};
    }
    const value = JSON.parse(localStorage.getItem(ATTRIBUTION_KEY) || "{}");
    if (!value || Array.isArray(value) || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter(([key, row]) => {
        const item = row as Visit;
        return (
          key.length <= 80 &&
          item &&
          uuid.test(item.first) &&
          uuid.test(item.last) &&
          Number.isFinite(item.at) &&
          item.at <= Date.now() &&
          Date.now() - item.at < ATTRIBUTION_TTL
        );
      }),
    ) as Record<string, Visit>;
  } catch {
    return {};
  }
}
function persist() {
  try {
    if (!allowed()) {
      localStorage.removeItem(ATTRIBUTION_KEY);
      return;
    }
    const value = { ...saved(), ...Object.fromEntries(current) };
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(value));
  } catch {
    /* Source on the current page still works when storage is blocked. */
  }
}
export function rememberSource(eventId: string, linkId: string) {
  if (!uuid.test(linkId)) return;
  const old = current.get(eventId) || saved()[eventId];
  initial.set(eventId, linkId);
  current.set(eventId, {
    first: old?.first || linkId,
    last: linkId,
    at: Date.now(),
  });
  persist();
}
export function orderAttribution(eventId: string) {
  if (!allowed()) return undefined;
  const value = current.get(eventId) || saved()[eventId];
  return value && Date.now() - value.at < ATTRIBUTION_TTL
    ? {
        first: value.first,
        last: value.last,
        consent_version: ANALYTICS_POLICY_VERSION,
      }
    : undefined;
}
export function watchAttributionChoice() {
  const update = () => {
    if (!allowed()) {
      current.clear();
      for (const [event, link] of initial)
        current.set(event, { first: link, last: link, at: Date.now() });
    }
    persist();
  };
  const storage = (event: StorageEvent) => {
    if (!event.key || event.key === "chaika.analytics-choice.v1") update();
  };
  window.addEventListener(ANALYTICS_CHOICE_EVENT, update);
  window.addEventListener("storage", storage);
  update();
  return () => {
    window.removeEventListener(ANALYTICS_CHOICE_EVENT, update);
    window.removeEventListener("storage", storage);
  };
}
