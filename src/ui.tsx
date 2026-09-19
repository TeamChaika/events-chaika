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
export function EventPartners() {
  return (
    <div
      className="event-partners"
      role="group"
      aria-label="ChaikaTeam и Мрия — совместное событие"
    >
      <Brand />
      <span className="partner-cross" aria-hidden="true">
        ×
      </span>
      <img
        className="partner-logo"
        src="/assets/partner-mriya.svg"
        alt="Мрия"
        width="170"
        height="40"
      />
    </div>
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
        <PhoneInput />
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

function PhoneInput() {
  const format = (input: HTMLInputElement, raw: string, caret: number) => {
    const digits = raw.replace(/\D/g, "");
    const hasCountry = /^[78]/.test(digits);
    const number = (hasCountry ? digits.slice(1) : digits).slice(0, 10);
    let value = digits ? "+7 (" + number.slice(0, 3) : "";
    if (number.length >= 3) value += ") ";
    if (number.length > 3) value += number.slice(3, 6);
    if (number.length >= 6) value += "-";
    if (number.length > 6) value += number.slice(6, 8);
    if (number.length >= 8) value += "-";
    if (number.length > 8) value += number.slice(8, 10);
    input.value = value;
    const before =
      raw.slice(0, caret).replace(/\D/g, "").length + (hasCountry ? 0 : 1);
    let seen = 0,
      position = value.length;
    if (caret < raw.length) {
      for (let i = 0; i < value.length; i++) {
        if (/\d/.test(value[i]) && ++seen >= before) {
          position = i + 1;
          break;
        }
      }
    }
    input.setSelectionRange(position, position);
  };
  return (
    <input
      type="tel"
      inputMode="tel"
      name="phone"
      autoComplete="tel"
      placeholder="+7 (___) ___-__-__"
      required
      maxLength={18}
      pattern={String.raw`\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}`}
      title="Введите номер полностью: +7 (999) 123-45-67"
      onChange={(event) => {
        const input = event.currentTarget;
        format(input, input.value, input.selectionStart ?? input.value.length);
      }}
      onKeyDown={(event) => {
        if (
          !["Backspace", "Delete"].includes(event.key) ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        const input = event.currentTarget;
        const start = input.selectionStart ?? 0;
        if (start !== input.selectionEnd || !input.value) return;
        event.preventDefault();
        const step = event.key === "Backspace" ? -1 : 1;
        let index = event.key === "Backspace" ? start - 1 : start;
        while (
          index >= 4 &&
          index < input.value.length &&
          !/\d/.test(input.value[index])
        )
          index += step;
        if (index >= 4 && index < input.value.length) {
          format(
            input,
            input.value.slice(0, index) + input.value.slice(index + 1),
            index,
          );
        } else if (
          event.key === "Backspace" &&
          !input.value.slice(4).replace(/\D/g, "")
        ) {
          input.value = "";
        }
      }}
    />
  );
}
