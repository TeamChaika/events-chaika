import nodemailer from "nodemailer";
import QRCode from "qrcode";
import { smsAeroReady, sendSmsAero, readSmsAeroStatus } from "./smsaero.mjs";
import { telegram } from "./telegram.mjs";
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
      ? smsAeroReady()
      : !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}
export function ticketSms(event, tickets, origin) {
  if (!tickets.length) throw new Error("sms_tickets_missing");
  return `Гастро Двор. ${event.title}.\n${tickets.map((ticket) => `${origin}/ticket/${ticket.code}`).join("\n")}`;
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
    return sendSmsAero(order.phone, ticketSms(event, tickets, origin));
  } else {
    return telegram.send(
      `${job.kind === "created" ? "Новый заказ" : job.kind === "review" ? "Оплата требует проверки мест" : "Билеты выпущены"} · ${event.title}\n${order.first_name} ${order.last_name}\n${order.phone}\nБилетов: ${order.quantity} · ${(order.total / 100).toLocaleString("ru-RU")} ₽\nСпособ: ${order.method}\nСтатус: ${order.status}\nЗаказ: ${order.id.slice(0, 8)}`,
    );
  }
}

export async function processOutbox(store, origin, demo) {
  const jobs = await store.all(
    "SELECT * FROM outbox WHERE status IN ('pending','retry') AND next_at<=? ORDER BY rowid LIMIT 10",
    Date.now(),
  );
  for (const job of jobs) {
    const o = await store.get("SELECT * FROM orders WHERE id=?", job.order_id);
    if (demo || o.mode !== "live" || !channelReady(job.channel)) {
      await store.run(
        "UPDATE outbox SET status='disabled',error='Отправка не подключена или заказ тестовый' WHERE id=?",
        job.id,
      );
      continue;
    }
    const claimed = await store.run(
      "UPDATE outbox SET status='sending',attempts=attempts+1,next_at=? WHERE id=? AND status IN ('pending','retry')",
      Date.now() + 120000,
      job.id,
    );
    if (!claimed.changes) continue;
    try {
      const delivery = await deliver(
        job,
        o,
        await store.event(o.event_id),
        await store.all(
          "SELECT * FROM tickets WHERE order_id=? ORDER BY ordinal",
          o.id,
        ),
        origin,
      );
      await store.run(
        "UPDATE outbox SET status=?,sent_at=?,provider_id=?,provider_status=?,status_attempts=0,next_at=?,error=? WHERE id=?",
        delivery?.status || "sent",
        new Date().toISOString(),
        delivery?.providerId || null,
        delivery?.providerStatus ?? null,
        Date.now() + 30000,
        delivery?.status === "failed"
          ? "SMS Aero: сообщение не доставлено или отклонено"
          : null,
        job.id,
      );
    } catch (error) {
      // An uncertain transport response might already have sent a message. Manual review avoids duplicate SMS.
      const definite = [
        "sms_rejected",
        "email_rejected",
        "telegram_rejected",
      ].includes(error.message);
      await store.run(
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
  if (!demo && channelReady("sms")) await reconcileSms(store);
}

async function reconcileSms(store) {
  const jobs = await store.all(
    "SELECT o.*,r.phone FROM outbox o JOIN orders r ON r.id=o.order_id WHERE o.channel='sms' AND o.status='submitted' AND o.provider_id IS NOT NULL AND r.mode='live' AND o.next_at<=? ORDER BY o.next_at LIMIT 4",
    Date.now(),
  );
  for (const job of jobs) {
    const claimed = await store.run(
      "UPDATE outbox SET next_at=?,status_attempts=status_attempts+1 WHERE id=? AND status='submitted' AND next_at<=?",
      Date.now() + 120000,
      job.id,
      Date.now(),
    );
    if (!claimed.changes) continue;
    const exhausted = job.status_attempts + 1 >= 100;
    const next =
      Date.now() +
      Math.min(900000, 30000 * 2 ** Math.min(job.status_attempts, 5));
    try {
      const result = await readSmsAeroStatus(job.provider_id, job.phone);
      await store.run(
        "UPDATE outbox SET status=?,provider_status=?,next_at=?,error=? WHERE id=? AND status='submitted'",
        result.status === "submitted" && exhausted ? "unknown" : result.status,
        result.providerStatus,
        next,
        result.status === "failed"
          ? "SMS Aero: сообщение не доставлено или отклонено"
          : result.status === "submitted" && exhausted
            ? "SMS Aero не подтвердил доставку: нужна проверка статуса"
            : null,
        job.id,
      );
    } catch {
      await store.run(
        "UPDATE outbox SET status=?,next_at=?,error=? WHERE id=? AND status='submitted'",
        exhausted ? "unknown" : "submitted",
        next,
        "Не удалось подтвердить доставку в SMS Aero; повторная отправка не выполнялась",
        job.id,
      );
    }
  }
}
