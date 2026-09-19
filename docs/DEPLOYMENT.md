# Публикация на Timeweb Apps

Репозиторий: https://github.com/TeamChaika/events-chaika, ветка `main`.
Сайт: https://event.chaika.team. Админка: https://event.chaika.team/admin. Контроль входа: https://event.chaika.team/checkin.

## Рабочая схема

- Timeweb Apps: backend Docker, один процесс Node 22 обслуживает React и API, HTTP-порт 8787. Московский preset 2731: 1 CPU / 1 ГБ, 510 ₽/мес по API Timeweb на 19 сентября 2026. HTTPS завершает платформа.
- Существующий Supabase на выбранном пользователем сервере **SupaBase — Отчеты**, ID `8012470`: база `postgres`, отдельная схема `chaika_events`, роль `chaika_events_app` без superuser/создания баз/ролей. Схема не включена в публичный Data API; у `anon` и `authenticated` нет доступа. На таблицах включены и принудительно применяются RLS-политики только для backend-роли.
- Сеть базы: `8012470-co83680.twc1.net:55433`, обязательный TLS, проверка сертификата через доверенный CA. Секреты передаются только через защищённые переменные Apps и root-only конфигурацию сервера. Отдельный PgBouncer в `/opt/chaika-events-supabase` принимает TLS и соединяется с `supabase-db` внутри Docker-сети. Существующие Supabase и Supavisor не перезапускаются. Лимиты pooler: 128 МБ RAM, 0.5 CPU, 12 соединений; session pooling сохраняет search_path роли.
- Заказы, билеты, сессии, очередь доставки и загруженные афиши хранятся в PostgreSQL. Временная файловая система Apps не содержит пользовательских данных. Исходная афиша и карты 3D-луны входят в Git.
- `DEMO_MODE=false`. По поручению владельца настроены существующий live-терминал QRM и SMS Aero. SMS включены (`DELIVERY_ENABLED=true`), но новые платежи временно закрыты (`QRM_MODE=disabled`): после успешного создания QR сервер QRM не ответил на документированный запрос SSE-статуса даже для просроченного проверочного QR. Ключи и привязка получателя сохранены; возвращать `QRM_MODE=live` после восстановления и проверки серверной сверки. Telegram и SMTP отдельно не настраивались.

Приложение Apps ID `256931` работает. Технический адрес: https://teamchaika-events-chaika-3a5f.twc1.net. Версия с Supabase успешно опубликована и прошла повторное развёртывание: скрытое тестовое мероприятие и загруженный PNG сохранились. После проверки эти две тестовые записи удалены; в рабочей базе осталось первое мероприятие, заказов и билетов нет. Резервная копия схемы сохранена на сервере.

DNS `event.chaika.team` направлен на IP Apps `109.71.247.127`, TTL 300 секунд. Проверен HTTPS с доверенным сертификатом для основного и технического доменов. При первоначальном переключении наблюдалось запаздывание одного DNS-сервера Timeweb и локального кэша; это отдельно от успешного запуска контейнера.

Временный отдельный PostgreSQL остановлен и удалён из Docker после проверки Supabase. Его файлы оставлены в закрытом архиве `/opt/chaika-events-db-retired-20260919`. Новый платный VPS не создавался. Существующие сервисы сервера «Отчеты» продолжают работать.

## Настройки приложения

`Dockerfile` в корне, ветка `main`, HTTP-порт из `EXPOSE 8787`. Нужны:

- `NODE_ENV=production`, `PORT=8787`, `APP_ORIGIN=https://event.chaika.team`.
- `DATABASE_URL`, `PG_CA_CERT` (PEM доверенного CA), `REQUIRE_POSTGRES=true`.
- `TRUST_PROXY_HOPS=1` за доверенным proxy Timeweb.
- Сильные различные `ADMIN_PASSWORD` и `SCANNER_PASSWORD`.
- `DEMO_MODE=false`, временно `QRM_MODE=disabled`, сохранены `QRM_API_BASE_URL`, `QRM_LIVE_API_KEY`, `QRM_EXPECTED_MERCHANT_ID`.
- `DELIVERY_ENABLED=true`, `SMSAERO_EMAIL`, `SMSAERO_API_KEY`, `SMSAERO_SIGN`. Значения секретов не коммитятся.

Не переносить локальную SQLite-базу с демонстрационными заказами. На Apps отсутствие PostgreSQL останавливает запуск вместо незаметного перехода на временную БД.

## Обновление и сохранность

После push выполнить новый deploy конкретного SHA в Apps и проверить логи, `/api/health`, главную страницу, `/admin`, `/checkin`. Автоматический deploy пока выключен. Транзакции PostgreSQL сериализуют резервирование мест и проход, в том числе при временном пересечении экземпляров. Начальная миграция и заполнение первого события также защищены транзакцией.

Перед обновлением базы сделать резервную копию:

```sh
cd /opt/chaika-events-supabase
umask 077
mkdir -p backups
docker exec supabase-db pg_dump -U supabase_admin -d postgres -n chaika_events -Fc > "backups/events-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Копии в этом каталоге защищают от ошибки обновления, но не от потери сервера. До открытия реальных продаж нужно настроить внешнее резервное копирование и проверить восстановление. Сертификат PostgreSQL выдан на 825 дней с 19 сентября 2026; при продлении сохранить доверенный CA либо согласованно обновить `PG_CA_CERT` в Apps.

## Альтернативное размещение

`deploy/supabase-proxy.compose.yml` и `deploy/supabase-proxy.Dockerfile` описывают TLS-pooler текущей установки. Порт 55433 — только вход для backend через TLS; внутри локальной Docker-сети используется существующий Supabase PostgreSQL.

`compose.production.yml` и `deploy/update.sh` относятся только к ранее подготовленному варианту отдельного VPS с SQLite. Они не используются в Apps. [App Platform запрещает пользовательские volumes в Docker Compose](https://timeweb.cloud/docs/apps/deploying-with-docker-compose).
