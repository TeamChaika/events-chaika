import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api } from "./types";
import { ErrorNotice, Modal, Spinner } from "./ui";

type Employee = {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "door";
  active: number;
  last_login_at: string | null;
};
type Action =
  | { kind: "password" | "access"; employee: Employee }
  | { kind: "create" };

export function StaffAccounts({ currentId }: { currentId: string | null }) {
  const [employees, setEmployees] = useState<Employee[]>();
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  async function load() {
    try {
      setEmployees(await api<Employee[]>("/admin/staff"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function open(next: Action) {
    setFormError("");
    setAction(next);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action || busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setFormError("");
    try {
      if (action.kind === "create") {
        await api("/admin/staff", {
          method: "POST",
          body: JSON.stringify({
            display_name: form.get("display_name"),
            username: form.get("username"),
            password: form.get("password"),
            role: form.get("role"),
          }),
        });
      } else {
        await api(`/admin/staff/${action.employee.id}`, {
          method: "PATCH",
          body: JSON.stringify(
            action.kind === "password"
              ? { password: form.get("password") }
              : { active: !action.employee.active },
          ),
        });
      }
      setAction(null);
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="micro muted">КОМАНДА СОБЫТИЯ</span>
          <h1>Сотрудники</h1>
          <p>Индивидуальные логины, пароли и доступ к рабочим разделам.</p>
        </div>
        <button
          className="button primary"
          onClick={() => open({ kind: "create" })}
        >
          <Plus size={18} /> Добавить сотрудника
        </button>
      </div>
      <p className="admin-hint">
        Контролёр проверяет билеты и выдаёт браслеты. Администратор получает
        полный доступ. После создания первого контролёра общий пароль сканера
        перестанет работать. Пароль сотрудника не отображается после сохранения
        — при необходимости задайте новый.
      </p>
      <ErrorNotice text={error} />
      {!employees && !error && <Spinner />}
      {error && (
        <button className="button secondary" onClick={() => void load()}>
          Повторить загрузку
        </button>
      )}
      {employees?.length === 0 && (
        <div className="empty-state">
          <h3>Добавьте первого сотрудника</h3>
          <p>Передайте ему логин, пароль и ссылку на сканер.</p>
        </div>
      )}
      <div className="integration-grid staff-grid">
        {employees?.map((employee) => (
          <article className="integration-card staff-card" key={employee.id}>
            <h2>{employee.display_name}</h2>
            <p>
              Логин: <strong>{employee.username}</strong>
            </p>
            <p>
              {employee.role === "admin"
                ? "Администратор · полный доступ"
                : "Контролёр · вход и браслеты"}
            </p>
            <span
              className={`status-pill ${employee.active ? "paid" : "neutral"}`}
            >
              {employee.active ? "Доступ открыт" : "Доступ отключён"}
            </span>
            <p className="small-text muted">
              Последний вход:{" "}
              {employee.last_login_at
                ? new Date(employee.last_login_at).toLocaleString("ru-RU")
                : "ещё не входил"}
            </p>
            {employee.id === currentId ? (
              <p className="small-text muted">
                Вы вошли под этой учётной записью. Её может изменить другой
                администратор или владелец.
              </p>
            ) : (
              <div className="staff-actions">
                <button
                  className="button secondary"
                  onClick={() => open({ kind: "password", employee })}
                >
                  Сменить пароль
                </button>
                <button
                  className="button secondary"
                  onClick={() => open({ kind: "access", employee })}
                >
                  {employee.active ? "Отключить доступ" : "Включить доступ"}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {action && (
        <Modal
          title={
            action.kind === "create"
              ? "Новый сотрудник"
              : action.kind === "password"
                ? "Сменить пароль"
                : action.employee.active
                  ? "Отключить доступ"
                  : "Включить доступ"
          }
          close={() => {
            if (!busy) setAction(null);
          }}
        >
          <form onSubmit={submit} className="staff-form">
            {action.kind !== "create" && (
              <p>
                {action.employee.display_name} · {action.employee.username}
              </p>
            )}
            {action.kind === "create" && (
              <>
                <label>
                  Имя и фамилия
                  <input
                    name="display_name"
                    minLength={2}
                    maxLength={80}
                    autoComplete="off"
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Логин
                  <input
                    name="username"
                    minLength={3}
                    maxLength={48}
                    pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                  />
                </label>
                <p className="small-text muted">
                  Латинские буквы, цифры, точка, дефис или подчёркивание.
                </p>
                <label>
                  Роль
                  <select name="role" defaultValue="door">
                    <option value="door">Контролёр — вход и браслеты</option>
                    <option value="admin">Администратор — полный доступ</option>
                  </select>
                </label>
              </>
            )}
            {action.kind !== "access" && (
              <label>
                {action.kind === "create" ? "Пароль" : "Новый пароль"}
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
                <span className="small-text muted">Минимум 12 символов.</span>
              </label>
            )}
            {action.kind === "create" && (
              <p className="small-text muted">
                Сохраните логин и пароль перед созданием — передайте их
                сотруднику лично.
              </p>
            )}
            {(action.kind === "password" ||
              (action.kind === "access" && action.employee.active)) && (
              <p className="small-text muted">
                Все открытые сеансы этого сотрудника сразу завершатся.
              </p>
            )}
            <ErrorNotice text={formError} />
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : action.kind === "create" ? (
                "Создать сотрудника"
              ) : (
                "Подтвердить"
              )}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
