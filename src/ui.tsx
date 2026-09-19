import React, { useEffect, useRef } from "react";
import { X, LoaderCircle } from "lucide-react";
export function Brand() {
  return (
    <a className="brand" href="/" aria-label="ChaikaTeam — главная">
      <span className="brand-mark">
        <img
          src="/assets/chaikateam.png"
          alt="ChaikaTeam"
          width="3334"
          height="1093"
        />
      </span>
    </a>
  );
}
export function ErrorNotice({ text }: { text: string }) {
  return text ? (
    <div role="alert" className="error-notice">
      {text}
    </div>
  ) : null;
}
export function Spinner() {
  return <LoaderCircle size={19} className="spinner" aria-label="Загрузка" />;
}
export function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal " + (wide ? "wide-modal" : "")}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <span className="micro">CHAIKATEAM</span>
          <button className="icon-button" aria-label="Закрыть" onClick={close}>
            <X size={22} />
          </button>
        </div>
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
export function GuestFields() {
  return (
    <>
      <div className="form-row">
        <label>
          Имя
          <input
            name="first_name"
            autoComplete="given-name"
            placeholder="Иван"
            required
            minLength={2}
            maxLength={60}
          />
        </label>
        <label>
          Фамилия
          <input
            name="last_name"
            autoComplete="family-name"
            placeholder="Иванов"
            required
            minLength={2}
            maxLength={60}
          />
        </label>
      </div>
      <label>
        Номер телефона
        <input
          type="tel"
          name="phone"
          autoComplete="tel"
          placeholder="+7 999 123-45-67"
          required
          pattern="[+0-9 ()\-]{10,22}"
        />
      </label>
      <label>
        Электронная почта
        <input
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          maxLength={160}
        />
        <small>Сюда отправим ваши билеты</small>
      </label>
    </>
  );
}
