import nodemailer from "nodemailer";
import QRCode from "qrcode";
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function channelReady(channel) {
  if (process.env.DELIVERY_ENABLED !== "true") return false;
  return channel === "email"
    ? !!(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.MAIL_FROM
      )
    : channel === "sms"
      ? !!process.env.SMS_RU_API_ID
      : !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}
export async function deliver(job, order, event, tickets, origin) {
  const link = `${origin}/order/${order.access_token}`;
  if (job.channel === "email") {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_SECURE !== "false",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
    const attachments = await Promise.all(
      tickets.map(async (t) => ({
        filename: `ticket-${t.ordinal}.png`,
        content: await QRCode.toBuffer(`${origin}/ticket/${t.code}`, {
          width: 500,
          margin: 4,
        }),
        cid: `ticket-${t.ordinal}`,
      })),
    );
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: order.email,
      subject: `Ваши билеты · ${event.title}`,
      text: `${order.first_name}, ваши билеты: ${event.title}, ${event.date} в ${event.time}, ${event.venue}. Билетов: ${order.quantity}. Открыть: ${link}`,
      html: `<div style="font-family:Arial;max-width:560px;margin:auto"><h1>${escape(event.title)}</h1><p>${escape(order.first_name)}, до встречи ${escape(event.date)} в ${escape(event.time)}!</p><p>${escape(event.venue)} · ${escape(event.address)}</p>${tickets.map((t) => `<h3>Билет ${t.ordinal} из ${order.quantity}</h3><img width="240" alt="QR билета" src="cid:ticket-${t.ordinal}"/>`).join("")}<p><a href="${link}">Открыть все билеты</a></p><p>Каждый QR действует для одного гостя и одного прохода.</p></div>`,
      attachments,
    });
    if (!info.accepted?.length) throw new Error("email_rejected");
  } else if (job.channel === "sms") {
    const res = await fetch("https://sms.ru/sms/send", {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        api_id: process.env.SMS_RU_API_ID,
        to: order.phone.replace(/\D/g, ""),
        msg: `${event.title}. Ваши билеты (${order.quantity}): ${link}`,
        json: "1",
      }),
    });
    const body = await res.json();
    if (
      !res.ok ||
      body.status !== "OK" ||
      !Object.values(body.sms || {}).length ||
      Object.values(body.sms).some((v) => v.status !== "OK")
    )
      throw new Error("sms_rejected");
  } else {
    const res = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        signal: AbortSignal.timeout(12000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `${job.kind === "created" ? "Новый заказ" : job.kind === "review" ? "Оплата требует проверки мест" : "Билеты выпущены"} · ${event.title}\n${order.first_name} ${order.last_name}\n${order.phone}\nБилетов: ${order.quantity} · ${(order.total / 100).toLocaleString("ru-RU")} ₽\nСпособ: ${order.method}\nСтатус: ${order.status}\nЗаказ: ${order.id.slice(0, 8)}`,
        }),
      },
    );
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error("telegram_rejected");
  }
}

export async function processOutbox(store, origin, demo) {
  const jobs = store.all(
    "SELECT * FROM outbox WHERE status IN ('pending','retry') AND next_at<=? ORDER BY rowid LIMIT 10",
    Date.now(),
  );
  for (const job of jobs) {
    const o = store.get("SELECT * FROM orders WHERE id=?", job.order_id);
    if (demo || o.mode !== "live" || !channelReady(job.channel)) {
      store.run(
        "UPDATE outbox SET status='disabled',error='Отправка не подключена или заказ тестовый' WHERE id=?",
        job.id,
      );
      continue;
    }
    const claimed = store.run(
      "UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=? AND status IN ('pending','retry')",
      job.id,
    );
    if (!claimed.changes) continue;
    try {
      await deliver(
        job,
        o,
        store.event(o.event_id),
        store.all(
          "SELECT * FROM tickets WHERE order_id=? ORDER BY ordinal",
          o.id,
        ),
        origin,
      );
      store.run(
        "UPDATE outbox SET status='sent',sent_at=?,error=NULL WHERE id=?",
        new Date().toISOString(),
        job.id,
      );
    } catch (error) {
      // An uncertain transport response might already have sent a message. Manual review avoids duplicate SMS.
      const definite = [
        "sms_rejected",
        "email_rejected",
        "telegram_rejected",
      ].includes(error.message);
      store.run(
        "UPDATE outbox SET status=?,next_at=?,error=? WHERE id=?",
        definite && job.attempts < 2 ? "retry" : "unknown",
        Date.now() + 60000,
        definite
          ? "Сервис отклонил отправку"
          : "Результат отправки неизвестен: проверьте сервис перед повтором",
        job.id,
      );
    }
  }
}
