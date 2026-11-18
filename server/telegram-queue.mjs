// Older workers select only pending/retry. Normalize writes by either release in the
// database transaction, including old inserts, lease recovery and operator retries.
export async function installTelegramQueue(db) {
  if (db.kind === "postgres") {
    await db.exec(`
      CREATE OR REPLACE FUNCTION route_telegram_outbox() RETURNS trigger LANGUAGE plpgsql AS $queue$
      BEGIN
        IF TG_OP='UPDATE' THEN
          IF NEW.status='disabled' AND OLD.status IN ('tg_pending','tg_retry','waiting_chat','waiting_message','sending','sent','unknown')
            AND EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND mode='live' AND is_test=0 AND voided_at IS NULL)
          THEN RETURN NULL; END IF;
          IF NEW.status IN ('pending','retry') AND NEW.provider_id IS NULL THEN NEW.provider_id := OLD.provider_id; END IF;
        END IF;
        IF NEW.status IN ('pending','retry') THEN NEW.status := 'tg_' || NEW.status; END IF;
        IF NEW.status='tg_disabled' THEN NEW.status := 'disabled'; END IF;
        RETURN NEW;
      END;
      $queue$;
      CREATE OR REPLACE TRIGGER route_telegram_outbox BEFORE INSERT OR UPDATE ON outbox
        FOR EACH ROW WHEN (NEW.channel='telegram') EXECUTE FUNCTION route_telegram_outbox();
    `);
  } else {
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS route_telegram_insert AFTER INSERT ON outbox
        WHEN NEW.channel='telegram' AND NEW.status IN ('pending','retry')
        BEGIN UPDATE outbox SET status='tg_' || NEW.status WHERE id=NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS route_telegram_update AFTER UPDATE OF status ON outbox
        WHEN NEW.channel='telegram' AND NEW.status IN ('pending','retry')
        BEGIN UPDATE outbox SET status='tg_' || NEW.status,provider_id=COALESCE(NEW.provider_id,OLD.provider_id) WHERE id=NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS preserve_telegram_queue BEFORE UPDATE OF status ON outbox
        WHEN NEW.channel='telegram' AND NEW.status='disabled' AND OLD.status IN ('tg_pending','tg_retry','waiting_chat','waiting_message','sending','sent','unknown')
          AND EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND mode='live' AND is_test=0 AND voided_at IS NULL)
        BEGIN SELECT RAISE(IGNORE); END;
      CREATE TRIGGER IF NOT EXISTS finish_telegram_disable AFTER UPDATE OF status ON outbox
        WHEN NEW.channel='telegram' AND NEW.status='tg_disabled'
        BEGIN UPDATE outbox SET status='disabled' WHERE id=NEW.id; END;
    `);
  }
  await db.run(
    "UPDATE outbox SET status='tg_' || status WHERE channel='telegram' AND status IN ('pending','retry')",
  );
  await db.exec(
    "CREATE INDEX IF NOT EXISTS outbox_delivery_due ON outbox(status,next_at)",
  );
}

export const activeDelivery =
  "((channel='telegram' AND status IN ('tg_pending','tg_retry')) OR (channel<>'telegram' AND status IN ('pending','retry')))";
export const displayStatus =
  "CASE status WHEN 'tg_pending' THEN 'pending' WHEN 'tg_retry' THEN 'retry' ELSE status END";

// A held order consumes no worker slots. A newly confirmed chat or message releases
// its dependent jobs, including confirmations completed by an older in-flight worker.
export async function refreshTelegramHolds(store) {
  await store.run(`
    UPDATE outbox SET status='waiting_chat',error='Исходный чат прежней отправки не подтверждён. Ожидаем настройки TELEGRAM_LEGACY_CHAT_ID'
     WHERE status IN ('tg_pending','tg_retry') AND EXISTS
       (SELECT 1 FROM order_telegram_destinations d WHERE d.order_id=outbox.order_id AND d.chat_id IS NULL)`);
  await store.run(`
    UPDATE outbox SET status='waiting_message',error='У предыдущей отправки нет подтверждённого ID сообщения. Проверьте её в Telegram'
     WHERE status IN ('tg_pending','tg_retry') AND EXISTS
       (SELECT 1 FROM outbox p WHERE p.order_id=outbox.order_id AND p.channel='telegram' AND p.status IN ('unknown','sent') AND p.provider_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM outbox p WHERE p.order_id=outbox.order_id AND p.channel='telegram' AND p.provider_id IS NOT NULL)`);
  await store.run(`
    UPDATE outbox SET status='tg_retry',next_at=0,error=NULL WHERE status='waiting_chat' AND EXISTS
       (SELECT 1 FROM order_telegram_destinations d WHERE d.order_id=outbox.order_id AND d.chat_id IS NOT NULL)`);
  await store.run(`
    UPDATE outbox SET status='tg_retry',next_at=0,error=NULL WHERE status='waiting_message' AND EXISTS
       (SELECT 1 FROM outbox p WHERE p.order_id=outbox.order_id AND p.channel='telegram' AND p.provider_id IS NOT NULL)`);
}
