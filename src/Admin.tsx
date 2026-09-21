import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Ticket,
  ScanLine,
  LogOut,
  Plus,
  Search,
  Pencil,
  Settings2,
  Users,
  ArrowLeft,
  Check,
  X,
  Camera,
  RefreshCw,
  Gift,
  Banknote,
  CircleDollarSign,
  Send,
} from "lucide-react";
import { Brand, ErrorNotice, Spinner, Modal, GuestFields } from "./ui";
import {
  api,
  money,
  dateLabel,
  statusLabel,
  methodLabel,
  type EventData,
} from "./types";
type AdminOrder = {
  id: string;
  event_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  quantity: number;
  checked_count: number;
  total: number;
  status: string;
  method: string;
  mode: string;
  created_at: string;
  title: string;
  access_token: string;
  diagnostic: string | null;
};
type Delivery = {
  id: string;
  order_id: string;
  channel: string;
  kind: string;
  status: string;
  attempts: number;
  error: string | null;
  provider_id: string | null;
};
type Overview = {
  events: EventData[];
  orders: AdminOrder[];
  stats: { sold: number; checked: number; revenue: number };
  integrations: {
    qrm: boolean;
    mode: string;
    telegram: boolean;
    email: boolean;
    sms: boolean;
  };
  deliveries: Delivery[];
};
export function Admin() {
  const requestedDoor = location.pathname.startsWith("/checkin");
  const [role, setRole] = useState<string | null | undefined>(),
    [demo, setDemo] = useState(false),
    [data, setData] = useState<Overview>(),
    [tab, setTab] = useState(requestedDoor ? "checkin" : "events"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<EventData | "new" | null>(null),
    [issue, setIssue] = useState(false),
    [search, setSearch] = useState("");
  async function load() {
    try {
      setData(await api<Overview>("/admin/overview"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    api<{ role: string | null; demo: boolean }>("/auth")
      .then((a) => {
        setRole(a.role);
        setDemo(a.demo);
        if (a.role === "door") setTab("checkin");
        if (a.role) load();
      })
      .catch((e) => setError(e.message));
  }, []);
  async function login(e: FormEvent<HTMLFormElement>, asDemo = false) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const a = await api<{ role: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          role: requestedDoor ? "door" : "admin",
          password: f.get("password"),
          demo: asDemo,
        }),
      });
      setRole(a.role);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (role === undefined)
    return (
      <div className="loading-screen">
        <Brand />
        <Spinner />
        <ErrorNotice text={error} />
      </div>
    );
  if (!role)
    return (
      <div className="login-page">
        <Brand />
        <div className="login-card">
          <span className="eyebrow quiet">
            {requestedDoor ? "КОМАНДА НА ВХОДЕ" : "ЗА КУЛИСАМИ СОБЫТИЙ"}
          </span>
          <h1>
            {requestedDoor ? "Проверка билетов" : "Вход для организатора"}
          </h1>
          <p className="muted">
            {requestedDoor
              ? "Впускайте гостей с помощью камеры телефона."
              : "Всё, чтобы ваша ночь прошла идеально."}
          </p>
          <form onSubmit={(e) => login(e, demo)}>
            {!demo && (
              <label>
                Пароль
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  autoFocus
                />
              </label>
            )}
            <ErrorNotice text={error} />
            {demo && (
              <div className="demo-note">
                Локальный предпросмотр. Доступ открыт для проверки функций.
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? <Spinner /> : demo ? "Открыть демо-панель" : "Войти"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <a className="text-link" href="/">
            <ArrowLeft size={15} />
            Вернуться на сайт
          </a>
        </div>
      </div>
    );
  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <Brand />
        <div className="workspace-label">
          <span className="workspace-avatar">Ч</span>
          <div>
            Кабинет организатора
            <small>
              {demo ? "Демонстрационный режим" : "Управление событиями"}
            </small>
          </div>
        </div>
        <nav>
          {(role === "admin"
            ? [
                ["events", "Мероприятия", CalendarDays],
                ["orders", "Заказы и билеты", Ticket],
                ["checkin", "Контроль входа", ScanLine],
                ["settings", "Подключения", Settings2],
              ]
            : [["checkin", "Контроль входа", ScanLine]]
          ).map(([key, title, Icon]) => {
            const I = Icon as typeof CalendarDays;
            return (
              <button
                aria-label={title as string}
                className={tab === key ? "active" : ""}
                key={key as string}
                onClick={() => {
                  setTab(key as string);
                  setError("");
                }}
              >
                <I size={19} />
                {title as string}
                {tab === key && <span />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <a href="/" target="_blank" rel="noreferrer">
            Открыть сайт <ArrowUpRight size={16} />
          </a>
          <button
            aria-label="Выйти"
            onClick={async () => {
              try {
                await api("/auth/logout", { method: "POST", body: "{}" });
                setRole(null);
                setData(undefined);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={16} />
            Выйти
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <span>
            Пространство событий{" "}
            <span className="muted">
              /{" "}
              {tab === "events"
                ? "Афиша"
                : tab === "orders"
                  ? "Билеты"
                  : tab === "checkin"
                    ? "Вход"
                    : "Сервисы"}
            </span>
          </span>
          <span className="admin-profile">
            <i />
            {role === "door" ? "Контролёр" : "Администратор"}
          </span>
        </header>
        <main className="admin-content">
          <ErrorNotice text={error} />
          {!data ? (
            <Spinner />
          ) : (
            <>
              {tab === "events" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="micro muted">
                        ВАША СЛЕДУЮЩАЯ БОЛЬШАЯ НОЧЬ
                      </span>
                      <h1>
                        Мероприятия
                        <span className="count-badge">
                          {data.events.length}
                        </span>
                      </h1>
                      <p>
                        Создавайте события, управляйте билетами и встречайте
                        гостей.
                      </p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setEdit("new")}
                    >
                      <Plus size={18} />
                      Создать событие
                    </button>
                  </div>
                  <Stats data={data} />
                  <div className="admin-section-title">
                    <h2>Ваша афиша</h2>
                    <span>{data.events.length} мероприятий</span>
                  </div>
                  <div className="admin-event-grid">
                    {data.events.map((event) => (
                      <article className="admin-event-card" key={event.id}>
                        <div className="event-card-art">
                          <img src={event.hero_image} alt="" />
                          <span
                            className={
                              "status-pill " +
                              (event.published ? "paid" : "neutral")
                            }
                          >
                            {event.published ? "Опубликовано" : "Черновик"}
                          </span>
                          <span className="event-card-date">
                            {new Date(event.date + "T12:00:00").getDate()}
                            <small>
                              {new Date(event.date + "T12:00:00")
                                .toLocaleString("ru-RU", { month: "short" })
                                .replace(".", "")}
                            </small>
                          </span>
                          <h2>{event.title}</h2>
                        </div>
                        <div className="event-card-body">
                          <span className="muted">
                            <CalendarDays size={14} />
                            {dateLabel(event.date)} · {event.time}
                            <span className="meta-divider">/</span>
                            {event.venue}
                          </span>
                          <div className="event-card-numbers">
                            <div>
                              <small>Стоимость билета</small>
                              <strong>{money(event.price)}</strong>
                            </div>
                            <div>
                              <small>Продано и в резерве</small>
                              <strong>
                                {event.capacity - event.available}
                                <span> / {event.capacity}</span>
                              </strong>
                            </div>
                          </div>
                          <div className="capacity-bar">
                            <span
                              style={{
                                width:
                                  Math.min(
                                    100,
                                    ((event.capacity - event.available) /
                                      event.capacity) *
                                      100,
                                  ) + "%",
                              }}
                            />
                          </div>
                          <div className="event-card-actions">
                            <button
                              className="button secondary"
                              onClick={() => setEdit(event)}
                            >
                              <Pencil size={15} />
                              Редактировать
                            </button>
                            <a
                              href={"/?event=" + event.id}
                              className="icon-button"
                              aria-label={"Открыть " + event.title}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ArrowUpRight size={20} />
                            </a>
                          </div>
                        </div>
                      </article>
                    ))}
                    <button
                      className="new-event-card"
                      onClick={() => setEdit("new")}
                    >
                      <span>
                        <Plus size={28} />
                      </span>
                      <strong>Повод собраться вместе</strong>
                      <small>Добавьте новое мероприятие</small>
                    </button>
                  </div>
                  {demo && (
                    <div className="admin-hint">
                      Цена 5 000 ₽ задана вами. Время 20:00 и лимит 200 гостей —
                      тестовые значения, их можно изменить в карточке.
                    </div>
                  )}
                </>
              )}
              {tab === "orders" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="micro muted">
                        КАЖДЫЙ ГОСТЬ НА СВОЁМ МЕСТЕ
                      </span>
                      <h1>Заказы и билеты</h1>
                      <p>Оплаты, пригласительные и продажи в заведении.</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setIssue(true)}
                    >
                      <Plus size={18} />
                      Выпустить билеты
                    </button>
                  </div>
                  <Stats data={data} />
                  <div className="table-toolbar">
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Имя, телефон или почта"
                      />
                    </label>
                    <button className="button secondary" onClick={load}>
                      <RefreshCw size={15} />
                      Обновить
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Гость</th>
                          <th>Мероприятие</th>
                          <th>Билетов</th>
                          <th>Сумма</th>
                          <th>Способ</th>
                          <th>Статус</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.orders
                          .filter((o) =>
                            `${o.first_name} ${o.last_name} ${o.phone} ${o.email}`
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                          )
                          .map((o) => (
                            <tr key={o.id}>
                              <td>
                                <strong>
                                  {o.first_name} {o.last_name}
                                </strong>
                                <small>{o.phone}</small>
                                <small>{o.email}</small>
                              </td>
                              <td>
                                {o.title}
                                <small>
                                  {new Date(o.created_at).toLocaleString(
                                    "ru-RU",
                                  )}
                                </small>
                              </td>
                              <td>
                                {o.quantity}
                                {o.status === "paid" && (
                                  <small>
                                    Вошли {o.checked_count} из {o.quantity}
                                  </small>
                                )}
                              </td>
                              <td>
                                {money(o.total)}
                                {o.mode !== "live" && (
                                  <small>Тестовый заказ</small>
                                )}
                              </td>
                              <td>{methodLabel[o.method]}</td>
                              <td>
                                <span className={"status-pill " + o.status}>
                                  {statusLabel[o.status]}
                                </span>
                                {o.diagnostic && (
                                  <small className="diagnostic">
                                    {o.diagnostic}
                                  </small>
                                )}
                              </td>
                              <td>
                                <a
                                  href={"/order/" + o.access_token}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="icon-button"
                                  aria-label="Открыть заказ"
                                >
                                  <ArrowUpRight size={19} />
                                </a>
                                {!["paid", "paid_review"].includes(o.status) &&
                                  o.mode !== "demo" && (
                                    <button
                                      className="icon-button"
                                      aria-label="Перепроверить оплату"
                                      onClick={async () => {
                                        try {
                                          await api(
                                            "/admin/orders/" +
                                              o.id +
                                              "/recheck",
                                            { method: "POST", body: "{}" },
                                          );
                                          load();
                                        } catch (e) {
                                          setError((e as Error).message);
                                        }
                                      }}
                                    >
                                      <RefreshCw size={16} />
                                    </button>
                                  )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {!data.orders.length && (
                      <div className="empty-state">
                        <Ticket size={34} />
                        <h3>Первые гости уже на подходе</h3>
                        <p>Здесь появятся заказы после оформления билетов.</p>
                        <button
                          className="text-link"
                          onClick={() => setIssue(true)}
                        >
                          Выпустить приглашение
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                    )}
                    {data.orders.length > 0 &&
                      !data.orders.some((o) =>
                        `${o.first_name} ${o.last_name} ${o.phone} ${o.email}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      ) && <div className="empty-state">Ничего не найдено</div>}
                  </div>
                </>
              )}
              {tab === "checkin" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="micro muted">
                        ДОБРО ПОЖАЛОВАТЬ В НОЧЬ
                      </span>
                      <h1>Контроль входа</h1>
                      <p>Один QR — один проход. Повторный билет сразу виден.</p>
                    </div>
                    <span className="connection-label">
                      <i />
                      Проверка по серверу
                    </span>
                  </div>
                  <Checkin events={data.events} onChecked={load} />
                </>
              )}
              {tab === "settings" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="micro muted">ВСЁ РАБОТАЕТ ВМЕСТЕ</span>
                      <h1>Подключения</h1>
                      <p>Состояние оплаты и доставки билетов.</p>
                    </div>
                  </div>
                  <div className="integration-grid">
                    {[
                      [
                        "QRM · СБП",
                        "Оплата и серверная сверка",
                        data.integrations.qrm,
                        CircleDollarSign,
                      ],
                      [
                        "Telegram",
                        "Уведомления о заказах",
                        data.integrations.telegram,
                        Send,
                      ],
                      [
                        "Электронная почта",
                        "Билеты с QR через SMTP",
                        data.integrations.email,
                        Ticket,
                      ],
                      [
                        "СМС · SMS Aero",
                        "Ссылка на все билеты",
                        data.integrations.sms,
                        Send,
                      ],
                    ].map(([name, desc, enabled, Icon]) => {
                      const I = Icon as typeof Ticket;
                      return (
                        <article
                          className="integration-card"
                          key={name as string}
                        >
                          <I size={25} />
                          <h3>{name as string}</h3>
                          <p>{desc as string}</p>
                          <span
                            className={
                              "status-pill " + (enabled ? "paid" : "neutral")
                            }
                          >
                            {enabled ? "Настроено" : "Не подключено"}
                          </span>
                        </article>
                      );
                    })}
                  </div>
                  <div className="admin-hint">
                    {demo
                      ? "Сейчас действует демо-режим. Настоящие платежи и отправки отключены."
                      : "Ключи сервисов задаются в серверном файле .env. Для доставки включите DELIVERY_ENABLED."}{" "}
                    Секретные ключи не передаются в браузер.
                  </div>
                  {!demo && (
                    <div className="integration-actions">
                      <button
                        className="button secondary"
                        onClick={async () => {
                          try {
                            const m = await api<{
                              firm_name: string;
                              requires_receipt: boolean;
                            }>("/admin/qrm/check", {
                              method: "POST",
                              body: "{}",
                            });
                            setError("");
                            alert(
                              `Терминал: ${m.firm_name}. Чеки: ${m.requires_receipt ? "включены" : "выключены"}.`,
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Проверить терминал QRM
                      </button>
                      <button
                        className="button secondary"
                        onClick={async () => {
                          try {
                            await api("/admin/smsaero/check", {
                              method: "POST",
                              body: "{}",
                            });
                            setError("");
                            alert(
                              "Авторизация SMS Aero подтверждена. СМС не отправлялась.",
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Проверить SMS Aero
                      </button>
                    </div>
                  )}
                  <div className="admin-section-title">
                    <h2>Доставка сообщений</h2>
                    <button
                      className="icon-button"
                      aria-label="Обновить"
                      onClick={load}
                    >
                      <RefreshCw size={17} />
                    </button>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Заказ</th>
                          <th>Канал</th>
                          <th>Статус</th>
                          <th>Подробности</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.deliveries.map((d) => (
                          <tr key={d.id}>
                            <td>{d.order_id.slice(0, 8)}</td>
                            <td>{d.channel}</td>
                            <td>
                              {
                                (
                                  {
                                    sent: "Передано сервису",
                                    submitted: "Передано SMS Aero",
                                    delivered: "Доставлено",
                                    failed: "Не доставлено",
                                    disabled: "Отключено",
                                    pending: "В очереди",
                                    retry: "Повтор",
                                    sending: "Отправляется",
                                    unknown: "Нужна проверка",
                                  } as Record<string, string>
                                )[d.status]
                              }
                            </td>
                            <td>{d.error || "—"}</td>
                            <td>
                              {[
                                "disabled",
                                "retry",
                                "unknown",
                                "failed",
                              ].includes(d.status) && (
                                <button
                                  className="icon-button"
                                  aria-label={
                                    d.provider_id && d.status === "unknown"
                                      ? "Проверить доставку"
                                      : "Повторить отправку"
                                  }
                                  onClick={async () => {
                                    if (
                                      d.status === "unknown" &&
                                      !d.provider_id &&
                                      !confirm(
                                        "Вы проверили сервис и убедились, что сообщение не было отправлено? Повтор может создать дубликат.",
                                      )
                                    )
                                      return;
                                    try {
                                      await api(
                                        "/admin/deliveries/" + d.id + "/retry",
                                        {
                                          method: "POST",
                                          body: JSON.stringify({
                                            confirm: true,
                                          }),
                                        },
                                      );
                                      load();
                                    } catch (e) {
                                      setError((e as Error).message);
                                    }
                                  }}
                                >
                                  <RefreshCw size={16} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.deliveries.length && (
                      <div className="empty-state">
                        <Send size={28} />
                        <p>Сообщения появятся после первого заказа.</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
      {edit && (
        <EventEditor
          event={edit}
          close={() => setEdit(null)}
          saved={() => {
            setEdit(null);
            load();
          }}
        />
      )}
      {issue && data && (
        <IssueForm
          events={data.events}
          close={() => setIssue(false)}
          saved={() => {
            load();
          }}
        />
      )}
    </div>
  );
}
function Stats({ data }: { data: Overview }) {
  return (
    <div className="stats-grid">
      {[
        [
          Ticket,
          "Выпущено билетов",
          data.stats.sold,
          "Гостей с действующим QR",
        ],
        [
          CircleDollarSign,
          "Продажи",
          money(data.stats.revenue),
          "СБП и наличные",
        ],
        [
          Users,
          "Прошли на входе",
          data.stats.checked,
          "Первый проход по билету",
        ],
      ].map(([Icon, title, value, sub]) => {
        const I = Icon as typeof Ticket;
        return (
          <article className="stat" key={title as string}>
            <span>
              {title as string}
              <I size={18} />
            </span>
            <strong>{value as string}</strong>
            <small>{sub as string}</small>
          </article>
        );
      })}
    </div>
  );
}
function EventEditor({
  event,
  close,
  saved,
}: {
  event: EventData | "new";
  close: () => void;
  saved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const e = event === "new" ? undefined : event;
  const [heroImage, setHeroImage] = useState(
    e?.hero_image || "/assets/red-moon.png",
  );
  const [uploading, setUploading] = useState(false);
  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError("Изображение должно быть меньше 4 МБ");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
        reader.readAsDataURL(file);
      });
      const result = await api<{ url: string }>("/admin/media", {
        method: "POST",
        body: JSON.stringify({ data }),
      });
      setHeroImage(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setBusy(true);
    const f = new FormData(ev.currentTarget);
    const input = {
      ...Object.fromEntries(f),
      price: Math.round(Number(f.get("price")) * 100),
      capacity: Number(f.get("capacity")),
      age: Number(f.get("age")),
      published: f.get("published") === "on",
      sales_open: f.get("sales_open") === "on",
      hero_image: heroImage,
    };
    try {
      await api("/admin/events" + (e ? "/" + e.id : ""), {
        method: e ? "PUT" : "POST",
        body: JSON.stringify(input),
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={e ? "Редактировать событие" : "Новое событие"}
      close={close}
      wide
    >
      <form onSubmit={submit}>
        <div className="image-editor">
          <img src={heroImage} alt="Фон мероприятия" />
          <div>
            <label>
              Афиша / фон
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={uploading}
                onChange={(e) => {
                  upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <small>
                {uploading ? "Загружаем…" : "PNG, JPEG, WebP · до 4 МБ"}
              </small>
            </label>
            <button
              className="text-link"
              type="button"
              disabled={uploading}
              onClick={() => setHeroImage("/assets/red-moon.png")}
            >
              Вернуть красную луну
            </button>
          </div>
        </div>
        <label>
          Название
          <input
            name="title"
            defaultValue={e?.title}
            required
            minLength={3}
            maxLength={100}
            placeholder="Название вашей особенной ночи"
          />
        </label>
        <label>
          Формат
          <input
            name="subtitle"
            defaultValue={e?.subtitle || "Костюмированный бал-вечеринка"}
            required
            maxLength={120}
          />
        </label>
        <div className="form-row">
          <label>
            Дата
            <input
              type="date"
              name="date"
              defaultValue={e?.date || "2026-10-31"}
              required
            />
          </label>
          <label>
            Время
            <input
              type="time"
              name="time"
              defaultValue={e?.time || "20:00"}
              required
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Площадка
            <input
              name="venue"
              defaultValue={e?.venue || "Гастродвор"}
              required
            />
          </label>
          <label>
            Адрес
            <input
              name="address"
              defaultValue={e?.address || "Крым, Ялта"}
              required
            />
          </label>
        </div>
        <div className="form-row triple">
          <label>
            Цена, ₽
            <input
              type="number"
              name="price"
              min="1"
              max="1000000"
              step="0.01"
              defaultValue={e ? e.price / 100 : 5000}
              required
            />
          </label>
          <label>
            Лимит гостей
            <input
              type="number"
              name="capacity"
              min="1"
              max="100000"
              defaultValue={e?.capacity || 200}
              required
            />
          </label>
          <label>
            Возраст, +
            <input
              type="number"
              name="age"
              min="0"
              max="21"
              defaultValue={e?.age ?? 16}
              required
            />
          </label>
        </div>
        <label>
          Описание
          <textarea
            name="description"
            defaultValue={e?.description}
            rows={3}
            maxLength={3000}
          />
        </label>
        <label>
          Дресс-код
          <input
            name="dresscode"
            defaultValue={e?.dresscode || "Black, red & a little mystery"}
          />
        </label>
        <div className="form-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="published"
              defaultChecked={e ? Boolean(e.published) : true}
            />
            Опубликовать на сайте
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="sales_open"
              defaultChecked={e ? Boolean(e.sales_open) : true}
            />
            Открыть продажи
          </label>
        </div>
        <p className="muted small-text">
          Изменение цены применяется только к новым заказам.
        </p>
        <ErrorNotice text={error} />
        <button className="button primary full" disabled={busy || uploading}>
          {busy || uploading ? <Spinner /> : <Check size={18} />}Сохранить
          событие
        </button>
      </form>
    </Modal>
  );
}
function IssueForm({
  events,
  close,
  saved,
}: {
  events: EventData[];
  close: () => void;
  saved: () => void;
}) {
  const [method, setMethod] = useState("invite"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [url, setUrl] = useState("");
  const key = useRef(crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const result = await api<{ url: string }>("/admin/issue", {
        method: "POST",
        headers: { "Idempotency-Key": key.current },
        body: JSON.stringify({
          ...Object.fromEntries(f),
          quantity: Number(f.get("quantity")),
          method,
          cash_received: f.get("cash_received") === "on",
        }),
      });
      setUrl(result.url);
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={url ? "Билеты выпущены" : "Пригласить в ночь"} close={close}>
      {url ? (
        <div className="issue-success">
          <div className="success-icon">
            <Check />
          </div>
          <p>У каждого гостя — свой QR-код.</p>
          <a
            className="button primary full"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Открыть билеты
            <ArrowUpRight size={18} />
          </a>
          <button className="button secondary full" onClick={close}>
            Готово
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="segmented">
            <button
              type="button"
              className={method === "invite" ? "active" : ""}
              onClick={() => setMethod("invite")}
            >
              <Gift size={17} />
              Приглашение
            </button>
            <button
              type="button"
              className={method === "cash" ? "active" : ""}
              onClick={() => setMethod("cash")}
            >
              <Banknote size={17} />
              Наличные
            </button>
          </div>
          <label>
            Мероприятие
            <select name="event_id">
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} · {money(e.price)}
                </option>
              ))}
            </select>
          </label>
          <GuestFields />
          <label>
            Количество
            <input
              name="quantity"
              type="number"
              min="1"
              max="10"
              defaultValue="1"
              required
            />
          </label>
          {method === "cash" ? (
            <label className="checkbox-label">
              <input name="cash_received" type="checkbox" required />
              Подтверждаю получение наличных за все билеты
            </label>
          ) : (
            <p className="demo-note">
              Бесплатные билеты. Учитываются в лимите гостей.
            </p>
          )}
          <ErrorNotice text={error} />
          <button className="button primary full" disabled={busy}>
            {busy ? <Spinner /> : <Ticket size={18} />}Выпустить билеты
          </button>
        </form>
      )}
    </Modal>
  );
}
function Checkin({
  events,
  onChecked,
}: {
  events: EventData[];
  onChecked: () => void;
}) {
  const [event, setEvent] = useState(events[0]?.id || ""),
    [summary, setSummary] = useState<{
      issued: number;
      checked: number;
      remaining: number;
      updated_at: string;
    }>(),
    [summaryStale, setSummaryStale] = useState(false),
    [summaryRevision, setSummaryRevision] = useState(0),
    [code, setCode] = useState(""),
    [camera, setCamera] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      accepted: boolean;
      name: string;
      ordinal: number;
      used_at: string;
      mode: string;
      group: { issued: number; checked: number; remaining: number };
    }>();
  const video = useRef<HTMLVideoElement>(null),
    stop = useRef<() => void>(() => {}),
    inFlight = useRef(false),
    scanFn = useRef<(v: string) => Promise<void>>(async () => {});
  const scannerPanel = useRef<HTMLElement>(null);
  const resultPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!event) return;
    let cancelled = false,
      refreshing = false;
    async function refresh() {
      if (refreshing || document.hidden) return;
      refreshing = true;
      try {
        const next = await api<NonNullable<typeof summary>>(
          "/checkin/summary?event_id=" + encodeURIComponent(event),
        );
        if (!cancelled) {
          setSummary(next);
          setSummaryStale(false);
        }
      } catch {
        if (!cancelled) setSummaryStale(true);
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const interval = setInterval(refresh, 10000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [event, summaryRevision]);
  useEffect(() => {
    if (!matchMedia("(max-width:800px)").matches) return;
    const target = result
      ? resultPanel.current
      : camera
        ? scannerPanel.current
        : null;
    target?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [result, camera]);
  async function scan(value: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    stop.current();
    setCamera(false);
    try {
      const r = await api<{
        accepted: boolean;
        name: string;
        ordinal: number;
        used_at: string;
        mode: string;
        group: { issued: number; checked: number; remaining: number };
      }>("/checkin", {
        method: "POST",
        body: JSON.stringify({ event_id: event, code: value }),
      });
      setResult(r);
      setSummaryRevision((v) => v + 1);
      onChecked();
    } catch (e) {
      setResult(undefined);
      setError((e as Error).message);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  scanFn.current = scan;
  useEffect(() => {
    if (!camera) return;
    let cancelled = false;
    let control: { stop: () => void } | undefined;
    (async () => {
      try {
        if (!window.isSecureContext)
          throw new Error("Камера работает только по HTTPS или на localhost");
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        control = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          video.current!,
          (r) => {
            if (r && !cancelled) scanFn.current(r.getText());
          },
        );
        if (cancelled) control.stop();
        else stop.current = () => control?.stop();
      } catch (e) {
        if (!cancelled) {
          setError(
            (e as Error).message ===
              "Камера работает только по HTTPS или на localhost"
              ? (e as Error).message
              : "Не удалось открыть камеру. Разрешите доступ или введите код вручную.",
          );
          setCamera(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      control?.stop();
    };
  }, [camera]);
  return (
    <div className="checkin-layout">
      <section className="scanner-card" ref={scannerPanel}>
        <label>
          Проверяем билеты на
          <select
            value={event}
            onChange={(e) => {
              stop.current();
              setCamera(false);
              setEvent(e.target.value);
              setSummary(undefined);
              setSummaryStale(false);
              setResult(undefined);
            }}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {dateLabel(e.date)}
              </option>
            ))}
          </select>
        </label>
        <div className="attendance-summary" aria-label="Статистика входа">
          {[
            ["Выпущено", summary?.issued],
            ["Прошли", summary?.checked],
            ["Ещё не пришли", summary?.remaining],
          ].map(([label, count]) => (
            <div key={String(label)}>
              <strong>{count ?? "—"}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <p className="small-text muted">
          {summaryStale
            ? "Нет связи с сервером. Счётчики могут быть устаревшими; проход не подтверждается."
            : summary
              ? `Обновлено ${new Date(summary.updated_at).toLocaleTimeString("ru-RU")}. Учёт первых входов, без выходов.`
              : "Загружаем статистику входа…"}
        </p>
        <div className={"camera-stage " + (camera ? "camera-live" : "")}>
          {camera ? (
            <>
              <video ref={video} playsInline muted />
              <div className="scan-frame" />
              <button
                className="camera-stop icon-button"
                onClick={() => setCamera(false)}
                aria-label="Закрыть камеру"
              >
                <X />
              </button>
            </>
          ) : (
            <>
              <ScanLine size={72} strokeWidth={1} />
              <h3>Наведите камеру на билет</h3>
              <p>Подойдёт камера телефона или ноутбука</p>
              <button
                className="button primary"
                disabled={!event || busy}
                onClick={() => {
                  setCamera(true);
                  setResult(undefined);
                  setError("");
                }}
              >
                <Camera size={18} />
                Открыть камеру
              </button>
            </>
          )}
        </div>
        <div className="manual-divider">или введите код вручную</div>
        <form
          className="manual-scan"
          onSubmit={(e) => {
            e.preventDefault();
            scan(code);
          }}
        >
          <input
            aria-label="Код или ссылка билета"
            placeholder="Ссылка или полный код билета"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <button
            aria-label="Проверить билет"
            className="button secondary"
            disabled={busy || !event}
          >
            {busy ? <Spinner /> : <ArrowUpRight size={19} />}
            <span>Проверить</span>
          </button>
        </form>
        <ErrorNotice text={error} />
      </section>
      <div className="checkin-side" ref={resultPanel} aria-live="polite">
        {result ? (
          <div
            className={
              "scan-result " + (result.accepted ? "accepted" : "rejected")
            }
          >
            <div>{result.accepted ? <Check size={36} /> : <X size={36} />}</div>
            <span className="micro">
              {result.mode !== "live" ? "ТЕСТОВЫЙ БИЛЕТ" : "РЕЗУЛЬТАТ ПРОВЕРКИ"}
            </span>
            <h2>{result.accepted ? "Добро пожаловать!" : "Уже использован"}</h2>
            <h3>{result.name}</h3>
            <p>Билет № {result.ordinal}</p>
            {result.group && (
              <p>
                По заказу вошли {result.group.checked} из {result.group.issued}.
                Ещё не пришли: {result.group.remaining}.
              </p>
            )}
            <p>
              {result.accepted ? "Проход подтверждён" : "Первый проход"} в{" "}
              {new Date(result.used_at).toLocaleTimeString("ru-RU")}
            </p>
            <button
              className="button secondary full"
              onClick={() => {
                setResult(undefined);
                setCode("");
                setCamera(true);
              }}
            >
              Следующий гость
              <ArrowUpRight size={17} />
            </button>
          </div>
        ) : (
          <div className="scan-empty">
            <div className="circle-symbol">
              <Ticket size={25} />
            </div>
            <h3>Готовы встречать гостей</h3>
            <p>
              Здесь появится результат проверки: имя гостя и разрешение на
              проход.
            </p>
            <div className="scan-legend">
              <span>
                <i className="green-dot" />
                Билет действителен
              </span>
              <span>
                <i className="red-dot" />
                Повторный или неверный билет
              </span>
            </div>
          </div>
        )}
        <p className="small-text muted scan-tip">
          Для проверки нужен интернет. Телефон не сохраняет решения офлайн — это
          защищает от повторного прохода через разные входы.
        </p>
      </div>
    </div>
  );
}
