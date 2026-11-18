import type { EventData } from "./types";

export type EventLink =
  | { kind: "id" | "slug"; value: string }
  | { kind: "referral"; event: string; source: string };

export function utmSearch(search: string) {
  const utm = new URLSearchParams();
  for (const [name, value] of new URLSearchParams(search)) {
    if (name.startsWith("utm_") && name.length > 4) utm.append(name, value);
  }
  const query = utm.toString();
  return query ? `?${query}` : "";
}

export function publicEventRoute(
  pathname: string,
  search: string,
): EventLink | { kind: "catalog" } | { kind: "missing" } {
  const parts = pathname.split("/").filter(Boolean);
  const selected = new URLSearchParams(search).get("event");
  if (!parts.length)
    return selected ? { kind: "id", value: selected } : { kind: "catalog" };
  if (parts.length === 1 && parts[0] === "test-lending")
    return { kind: "id", value: selected || "red-moon" };
  if (parts.length !== 2) return { kind: "missing" };
  if (parts[0] === "e") {
    try {
      return { kind: "slug", value: decodeURIComponent(parts[1]) };
    } catch {
      return { kind: "missing" };
    }
  }
  return { kind: "referral", event: parts[0], source: parts[1] };
}

export const eventStart = (event: Pick<EventData, "date" | "time">) =>
  `${event.date}T${event.time}:00+03:00`;

export function ticketStatus(event: EventData, now: number) {
  if (Date.parse(eventStart(event)) <= now) return "started";
  if (!event.sales_open) return "closed";
  return event.available > 0 ? "open" : "unavailable";
}
