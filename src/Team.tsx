import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BarChart3,
  Link2,
  Users,
  Plus,
  Copy,
  RefreshCw,
  Check,
  ArrowUpRight,
  CircleHelp,
} from "lucide-react";
import { money } from "./types";
import "./team.css";

type Member = {
  telegram_id: string;
  display_name: string;
  username?: string;
  role: "owner" | "editor" | "viewer";
  status: string;
  access_group_id?: string | null;
  group_access_enabled?: boolean;
};
type Event = {
  id: string;
  title: string;
  date: string;
  capacity: number;
  published: number;
  slug: string | null;
};
type Link = {
  id: string;
  event_id: string;
  source_id: string;
  source_name: string;
  placement: string;
  slug: string;
  event_slug: string;
  url: string;
  active: number;
  created_by: string;
  creator_name: string | null;
};
type Catalog = {
  events: Event[];
  sources: { id: string; name: string }[];
  links: Link[];
};
type Counts = { orders: number; tickets: number; revenue: number };
type Report = {
  totals: Counts;
  rows: (Counts & {
    source_link_id: string | null;
    source_name: string | null;
    placement: string | null;
    slug: string | null;
    event_slug: string | null;
    event_title: string;
  })[];
  updated_at: string;
};
type TelegramApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  setHeaderColor: (value: string) => void;
  setBackgroundColor: (value: string) => void;
};
declare global {
  interface Window {
    Telegram?: { WebApp: TelegramApp };
  }
}
let sdkPromise: Promise<TelegramApp | undefined> | undefined;
function telegramApp() {
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  if (!sdkPromise)
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-web-app.js";
      script.async = true;
      const timeout = setTimeout(() => {
        script.remove();
        sdkPromise = undefined;
        reject(
          new Error(
            "Telegram не загрузился. Проверьте соединение и повторите.",
          ),
        );
      }, 12000);
      script.onload = () => {
        clearTimeout(timeout);
        resolve(window.Telegram?.WebApp);
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        sdkPromise = undefined;
        reject(
          new Error("Не удалось подключиться к Telegram. Повторите попытку."),
        );
      };
      document.head.append(script);
    });
  return sdkPromise;
}

export function Team() {
  const session = useRef("");
  const [member, setMember] = useState<Member>();
  const [pending, setPending] = useState<Member>();
  const [authBusy, setAuthBusy] = useState(true);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<Catalog>();
  const [report, setReport] = useState<Report>();
  const [members, setMembers] = useState<Member[]>([]);
  const [eventId, setEventId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tab, setTab] = useState("stats");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [newLink, setNewLink] = useState<Link>();
  const reportRequest = useRef(0);
  const call = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
      const response = await fetch("/api/team" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(session.current
            ? { Authorization: "Bearer " + session.current }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (path === "/auth" && data.member) setPending(data.member);
        if (response.status === 401 && path !== "/auth") {
          session.current = "";
          setMember(undefined);
        }
        throw new Error(data.error || "Не удалось загрузить данные");
      }
      return data;
    },
    [],
  );
  const authenticate = useCallback(async () => {
    setAuthBusy(true);
    setError("");
    try {
      // Browser administrators reuse their existing staff session. Telegram
      // sessions stay only in memory, so embedded browsers need no third-party cookies.
      const auth = await fetch("/api/auth", {
        signal: AbortSignal.timeout(12000),
      }).then((r) => r.json());
      if (auth.role === "admin") setMember(await call<Member>("/me"));
      else {
        const app = await telegramApp();
        app?.ready();
        app?.expand();
        try {
          app?.setHeaderColor("#101113");
          app?.setBackgroundColor("#101113");
        } catch {
          /* Older Telegram clients use their default colors. */
        }
        if (!app?.initData)
          throw new Error(
            "Откройте «Билеты и источники» в Telegram-боте @GastroDvor_bot.",
          );
        const result = await call<{ token: string; member: Member }>(
          "/auth",
          "POST",
          { initData: app.initData },
        );
        session.current = result.token;
        setPending(undefined);
        setMember(result.member);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }, [call]);
  useEffect(() => {
    document.title = "Команда · Гастро Двор";
    void authenticate();
  }, [authenticate]);
  const loadCatalog = useCallback(async () => {
    const value = await call<Catalog>("/catalog");
    setCatalog(value);
    setEventId(
      (current) =>
        current ||
        value.events.find((e) => e.published)?.id ||
        value.events[0]?.id ||
        "",
    );
  }, [call]);
  useEffect(() => {
    if (member) void loadCatalog().catch((e) => setError(e.message));
  }, [member, loadCatalog]);
  const refresh = useCallback(async () => {
    if (!eventId) return;
    const request = ++reportRequest.current;
    const params = new URLSearchParams({ event_id: eventId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const value = await call<Report>("/stats?" + params);
      if (reportRequest.current === request) {
        setReport(value);
        setError("");
      }
    } catch (e) {
      if (reportRequest.current === request) setError((e as Error).message);
    }
  }, [eventId, from, to, call]);
  useEffect(() => {
    if (!member) return;
    setReport(undefined);
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      ++reportRequest.current;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [member, refresh]);
  useEffect(() => {
    if (tab === "members" && member?.role === "owner")
      void call<Member[]>("/members")
        .then(setMembers)
        .catch((e) => setError(e.message));
  }, [tab, member, call]);
  async function copy(link: Link) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.id);
      setTimeout(() => setCopied(""), 2500);
    } catch {
      setError(
        "Не удалось скопировать. Нажмите и удерживайте адрес ссылки, чтобы скопировать его вручную.",
      );
    }
  }
  async function createLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const value = await call<Link>("/links", "POST", {
        event_id: eventId,
        event_slug: form.get("event_slug"),
        slug: form.get("slug"),
        placement: form.get("placement"),
        ...(sourceId
          ? { source_id: sourceId }
          : { source_name: form.get("source_name") }),
      });
      setNewLink(value);
      setCreating(false);
      await loadCatalog();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeMember(
    value: Member,
    role: "editor" | "viewer",
    status = "active",
  ) {
    setBusy(true);
    setError("");
    try {
      await call("/members/" + value.telegram_id, "PATCH", { role, status });
      setMembers(await call<Member[]>("/members"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const event = catalog?.events.find((e) => e.id === eventId);
  const links =
    catalog?.links.filter((link) => link.event_id === eventId) || [];
  const canEdit = member?.role !== "viewer";
  if (!member)
    return (
      <main className="team-app team-welcome">
        <div className="team-mark">
          <BarChart3 />
        </div>
        <p className="team-eyebrow">ГАСТРО ДВОР · КОМАНДА</p>
        <h1>
          Билеты
          <br />и источники
        </h1>
        <p>Продажи мероприятий и ссылки для продвижения в одном месте.</p>
        {authBusy ? (
          <p role="status">Проверяем доступ…</p>
        ) : (
          <>
            <div className="team-error" role="alert">
              {error}
            </div>
            {pending && (
              <p className="team-note">
                Ваш Telegram ID: {pending.telegram_id}. Владелец увидит запрос в
                разделе «Доступ».
              </p>
            )}
            <button className="team-primary" onClick={authenticate}>
              Проверить доступ <RefreshCw size={16} />
            </button>
            <a className="team-text-link" href="https://t.me/GastroDvor_bot">
              Открыть бота <ArrowUpRight size={15} />
            </a>
            <a className="team-text-link" href="/admin">
              Вход администратора сайта
            </a>
          </>
        )}
      </main>
    );
  return (
    <main className="team-app">
      <header className="team-header">
        <div>
          <p className="team-eyebrow">ГАСТРО ДВОР · КОМАНДА</p>
          <h1>Билеты и источники</h1>
        </div>
        <span className="team-avatar" title={member.display_name}>
          {member.display_name.slice(0, 1)}
        </span>
      </header>
      <div className="team-event">
        <label htmlFor="team-event">МЕРОПРИЯТИЕ</label>
        <select
          id="team-event"
          value={eventId}
          onChange={(e) => {
            setEventId(e.target.value);
            setCreating(false);
            setNewLink(undefined);
          }}
        >
          {catalog?.events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title} ·{" "}
              {new Date(event.date + "T12:00:00").toLocaleDateString("ru-RU")}
            </option>
          ))}
        </select>
      </div>
      <nav className="team-tabs" aria-label="Разделы панели">
        {[
          ["stats", "Продажи", BarChart3],
          ["links", "Источники", Link2],
          ...(member.role === "owner" ? [["members", "Доступ", Users]] : []),
        ].map(([id, name, Icon]) => {
          const I = Icon as typeof Users;
          return (
            <button
              key={id as string}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => {
                setTab(id as string);
                setError("");
              }}
            >
              <I size={17} />
              {name as string}
            </button>
          );
        })}
      </nav>
      {error && (
        <div className="team-error" role="alert">
          {error}
        </div>
      )}
      {!catalog && <p role="status">Загружаем мероприятия…</p>}
      {tab === "stats" && (
        <section aria-label="Статистика продаж">
          <div className="team-dates">
            <label>
              С даты
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              По дату
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <button
              className="team-icon"
              aria-label="Обновить статистику"
              onClick={refresh}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <div className="team-metrics">
            <div className="team-metric featured">
              <span>Продано билетов</span>
              <strong>{report?.totals.tickets ?? "—"}</strong>
              <small>по подтверждённым оплатам</small>
            </div>
            <div className="team-metric">
              <span>Заказов</span>
              <strong>{report?.totals.orders ?? "—"}</strong>
            </div>
            <div className="team-metric">
              <span>Выручка</span>
              <strong className="team-revenue">
                {report ? money(report.totals.revenue) : "—"}
              </strong>
            </div>
          </div>
          <div className="team-section-title">
            <h2>Откуда приходят покупки</h2>
            <span>{report?.rows.length || 0}</span>
          </div>
          {report?.rows.length === 0 && (
            <div className="team-empty">
              <BarChart3 />
              <h3>Пока нет оплаченных заказов</h3>
              <p>
                Проверьте период или создайте первую ссылку для продвижения.
              </p>
            </div>
          )}
          {report?.rows.map((row, i) => (
            <article
              className="team-source-result"
              key={`${row.source_link_id}-${i}`}
            >
              <div>
                <h3>{row.source_name || "Источник не определён"}</h3>
                <p>
                  {row.source_link_id
                    ? [row.placement, `/${row.event_slug}/${row.slug}`]
                        .filter(Boolean)
                        .join(" · ")
                    : "Прямые переходы и покупки до подключения учёта"}
                </p>
              </div>
              <div className="team-source-counts">
                <strong>
                  {row.tickets} <small>билетов</small>
                </strong>
                <span>{row.orders} заказов</span>
                <b>{money(row.revenue)}</b>
              </div>
              <div className="team-bar">
                <span
                  style={{
                    width: `${report.totals.tickets ? (row.tickets / report.totals.tickets) * 100 : 0}%`,
                  }}
                />
              </div>
            </article>
          ))}
          <p className="team-note">
            <CircleHelp size={15} />
            Тестовые, аннулированные и неоплаченные заказы, а также
            пригласительные не входят в продажи. Период — по дате оплаты, время
            Ялты.
          </p>
          <p className="team-updated">
            {report
              ? `Обновлено в ${new Date(report.updated_at).toLocaleTimeString("ru-RU")}. Обновление каждые 30 секунд.`
              : "Загружаем статистику…"}
          </p>
        </section>
      )}
      {tab === "links" && (
        <section aria-label="Источники и ссылки">
          <div className="team-section-title">
            <h2>Ссылки мероприятия</h2>
            {canEdit && (
              <button
                className="team-primary small"
                disabled={!event}
                onClick={() => {
                  setCreating(!creating);
                  setNewLink(undefined);
                }}
              >
                <Plus size={17} />
                Добавить
              </button>
            )}
          </div>
          {creating && event && (
            <form className="team-form" onSubmit={createLink} key={event.id}>
              <h3>Новая ссылка</h3>
              <label>
                Источник
                <select
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                >
                  <option value="">+ Создать новый источник</option>
                  {catalog?.sources.map((source) => (
                    <option value={source.id} key={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </label>
              {!sourceId && (
                <label>
                  Название источника
                  <input
                    name="source_name"
                    placeholder="Например, Sunset Vibes"
                    required
                    minLength={2}
                    maxLength={80}
                  />
                </label>
              )}
              <label>
                Размещение
                <input
                  name="placement"
                  placeholder="Telegram, VK, блогер, афиша…"
                  maxLength={80}
                />
              </label>
              <div className="team-form-row">
                <label>
                  Имя мероприятия
                  <input
                    name="event_slug"
                    defaultValue={
                      event.slug ||
                      (event.id === "red-moon"
                        ? "moon"
                        : "event-" + event.id.slice(0, 8))
                    }
                    readOnly={Boolean(event.slug)}
                    required
                    pattern="[a-z0-9][a-z0-9-]{0,39}"
                    maxLength={40}
                  />
                </label>
                <label>
                  Имя ссылки
                  <input
                    name="slug"
                    placeholder="sunset-tg"
                    required
                    pattern="[a-z0-9][a-z0-9-]{0,39}"
                    maxLength={40}
                  />
                </label>
              </div>
              <p className="team-note">
                Адрес: event.chaika.team / мероприятие / ссылка. Латинские
                буквы, цифры и дефис.
              </p>
              <button className="team-primary" disabled={busy}>
                {busy ? "Создаём…" : "Создать ссылку"}
                <ArrowUpRight size={17} />
              </button>
            </form>
          )}
          {newLink && (
            <div className="team-success" role="status">
              <Check size={18} />
              <div>
                Ссылка готова<strong>{newLink.url}</strong>
              </div>
              <button
                className="team-icon"
                aria-label="Скопировать новую ссылку"
                onClick={() => copy(newLink)}
              >
                {copied === newLink.id ? (
                  <Check size={18} />
                ) : (
                  <Copy size={18} />
                )}
              </button>
            </div>
          )}
          {!links.length && !creating && (
            <div className="team-empty">
              <Link2 />
              <h3>У каждого размещения своя ссылка</h3>
              <p>
                Создайте источник и передайте ссылку партнёру или СММ. Покупки
                появятся в разделе «Продажи».
              </p>
            </div>
          )}
          {links.map((link) => (
            <article className="team-link-card" key={link.id}>
              <div className="team-link-heading">
                <h3>{link.source_name}</h3>
                <span
                  className={link.active ? "team-badge" : "team-badge inactive"}
                >
                  {link.active ? "Активна" : "Отключена"}
                </span>
              </div>
              <p>{link.placement || "Размещение не указано"}</p>
              <div className="team-link-url">
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.url.replace(/^https?:\/\//, "")}
                </a>
                <button
                  className="team-icon"
                  aria-label={`Скопировать ссылку ${link.source_name}`}
                  onClick={() => copy(link)}
                >
                  {copied === link.id ? (
                    <Check size={18} />
                  ) : (
                    <Copy size={18} />
                  )}
                </button>
              </div>
              <div className="team-link-footer">
                <small>
                  Создал:{" "}
                  {link.creator_name ||
                    (link.created_by === "admin"
                      ? "Администратор сайта"
                      : link.created_by)}
                </small>
                {canEdit &&
                  (member.role === "owner" ||
                    link.created_by === member.telegram_id) && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await call("/links/" + link.id, "PATCH", {
                            active: !link.active,
                          });
                          await loadCatalog();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {link.active ? "Отключить" : "Включить"}
                    </button>
                  )}
              </div>
            </article>
          ))}
          <p className="team-note">
            Ссылка относится к одному мероприятию. Если её перешлют другому
            гостю, покупка останется за этим источником.
          </p>
        </section>
      )}
      {tab === "members" && member.role === "owner" && (
        <section aria-label="Доступ сотрудников">
          <h2>Команда</h2>
          <p className="team-note">
            {member.group_access_enabled
              ? "Участники рабочей группы получают доступ СММ / PR при первом входе. Здесь можно ограничить роль или отключить доступ отдельному сотруднику."
              : "Сотрудник открывает Mini App и попадает в этот список. Разрешите ему просмотр или создание ссылок. Общая статистика доступна всем одобренным сотрудникам."}
          </p>
          {members.map((value) => (
            <article className="team-member" key={value.telegram_id}>
              <h3>{value.display_name}</h3>
              <p>
                {value.username ? "@" + value.username : value.telegram_id} ·{" "}
                {
                  {
                    pending: "Ожидает доступа",
                    active: "Доступ открыт",
                    blocked: "Доступ отключён",
                  }[value.status]
                }
                {value.access_group_id && " · через рабочую группу"}
              </p>
              {value.role === "owner" ? (
                <span className="team-badge">Владелец</span>
              ) : (
                <div className="team-member-actions">
                  <button
                    disabled={
                      busy ||
                      (value.status === "active" && value.role === "editor")
                    }
                    onClick={() => changeMember(value, "editor")}
                  >
                    СММ / PR
                  </button>
                  <button
                    disabled={
                      busy ||
                      (value.status === "active" && value.role === "viewer")
                    }
                    onClick={() => changeMember(value, "viewer")}
                  >
                    Просмотр
                  </button>
                  {value.status !== "blocked" && (
                    <button
                      disabled={busy}
                      onClick={() => changeMember(value, "viewer", "blocked")}
                    >
                      Отключить
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
          <button
            className="team-text-link"
            onClick={() =>
              void call<Member[]>("/members")
                .then(setMembers)
                .catch((e) => setError(e.message))
            }
          >
            <RefreshCw size={15} />
            Обновить запросы
          </button>
        </section>
      )}
      <footer className="team-footer">Гастро Двор · панель команды</footer>
    </main>
  );
}
