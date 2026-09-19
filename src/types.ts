export type EventData = {
  id: string;
  title: string;
  subtitle: string;
  date: string;
  time: string;
  venue: string;
  address: string;
  price: number;
  capacity: number;
  available: number;
  description: string;
  dresscode: string;
  age: number;
  published: boolean | number;
  sales_open: boolean | number;
  hero_image: string;
};
export type Config = {
  demo: boolean;
  paymentMode: string;
  paymentReady: boolean;
};
export type TicketData = {
  code: string;
  ordinal: number;
  used_at: string | null;
  qr_image: string;
};
export type OrderData = {
  id: string;
  access_token: string;
  event: EventData;
  first_name: string;
  last_name: string;
  quantity: number;
  unit_price: number;
  total: number;
  status: string;
  method: string;
  mode: string;
  created_at: string;
  expires_at: string;
  payment_url: string | null;
  qr_image: string | null;
  tickets: TicketData[];
  delivery: { channel: string; status: string }[];
};
export const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
    value / 100,
  ) + " ₽";
export const dateLabel = (value: string) =>
  new Date(value + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
export const statusLabel: Record<string, string> = {
  paid: "Оплачен",
  pending: "Ожидает оплаты",
  creating: "Создаём платёж",
  unknown: "Нужна проверка",
  failed: "Ошибка оплаты",
  expired: "Время истекло",
  cancelled: "Отменён",
  paid_review: "Оплачен · нужна проверка",
};
export const methodLabel: Record<string, string> = {
  sbp: "СБП",
  invite: "Пригласительный",
  cash: "Наличные",
};
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch("/api" + url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Ошибка соединения");
  return data;
}
