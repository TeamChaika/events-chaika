# Публикация на Timeweb Apps

Репозиторий: https://github.com/TeamChaika/events-chaika, ветка `main`.
Целевой домен: `event.chaika.team`.

## Рабочая схема

- Timeweb Apps: backend Docker, один процесс Node 22 обслуживает React и API, HTTP-порт 8787. Московский preset 2731: 1 CPU / 1 ГБ, 510 ₽/мес по API Timeweb на 19 сентября 2026. HTTPS завершает платформа.
- Существующий Supabase на выбранном пользователем сервере **SupaBase — Отчеты**, ID `8012470`: база `postgres`, отдельная схема `chaika_events`, роль `chaika_events_app` без superuser/создания баз/ролей. Схема не включена в публичный Data API; у `anon` и `authenticated` нет доступа. На таблицах включены и принудительно применяются RLS-политики только для backend-роли.
- Сеть базы: `8012470-co83680.twc1.net:55433`, обязательный TLS, проверка сертификата через доверенный CA. Секреты передаются только через защищённые переменные Apps и root-only конфигурацию сервера. Отдельный PgBouncer в `/opt/chaika-events-supabase` принимает TLS и соединяется с `supabase-db` внутри Docker-сети. Существующие Supabase и Supavisor не перезапускаются. Лимиты pooler: 128 МБ RAM, 0.5 CPU, 12 соединений; session pooling сохраняет search_path роли.
- Заказы, билеты, сессии, очередь доставки и загруженные афиши хранятся в PostgreSQL. Временная файловая система Apps не содержит пользовательских данных. Исходная афиша и карты 3D-луны входят в Git.
- `DEMO_MODE=false`, `QRM_MODE=disabled`, `DELIVERY_ENABLED=false`: оплата и отправка сообщений не включаются при размещении.

Приложение Apps ID `256931` создано, домен привязан. Технический адрес: `teamchaika-events-chaika-3a5f.twc1.net`. Supabase содержит перенесённое первое мероприятие, TLS и запрет доступа ролей anon/authenticated проверены. Выполняется финальный deploy и проверка HTTPS.

## Настройки приложения

`Dockerfile` в корне, ветка `main`, HTTP-порт из `EXPOSE 8787`. Нужны:

- `NODE_ENV=production`, `PORT=8787`, `APP_ORIGIN=https://event.chaika.team`.
- `DATABASE_URL`, `PG_CA_CERT` (PEM доверенного CA), `REQUIRE_POSTGRES=true`.
- `TRUST_PROXY_HOPS=1` за доверенным proxy Timeweb.
- Сильные различные `ADMIN_PASSWORD` и `SCANNER_PASSWORD`.
- `DEMO_MODE=false`, `QRM_MODE=disabled`, `DELIVERY_ENABLED=false` до отдельной настройки интеграций.

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
