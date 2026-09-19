# Публикация на Timeweb Apps

Репозиторий: https://github.com/TeamChaika/events-chaika, ветка `main`.
Целевой домен: `event.chaika.team`.

## Рабочая схема

- Timeweb Apps: backend Docker, один процесс Node 22 обслуживает React и API, HTTP-порт 8787. Московский preset 2731: 1 CPU / 1 ГБ, 510 ₽/мес по API Timeweb на 19 сентября 2026. HTTPS завершает платформа.
- PostgreSQL 17: отдельный контейнер на выбранном пользователем сервере **SupaBase — Отчеты**, ID `8012470`. Файлы в `/opt/chaika-events-db`; самостоятельная база `chaika_events`, отдельная роль приложения без superuser/создания других баз. Данные других систем не используются. Ограничения контейнера: 1 CPU / 1 ГБ RAM.
- Сеть базы: `8012470-co83680.twc1.net:55432`, обязательный TLS, проверка сертификата через доверенный CA. Секреты передаются только через защищённые переменные Apps и root-only конфигурацию сервера.
- Заказы, билеты, сессии, очередь доставки и загруженные афиши хранятся в PostgreSQL. Временная файловая система Apps не содержит пользовательских данных. Исходная афиша и карты 3D-луны входят в Git.
- `DEMO_MODE=false`, `QRM_MODE=disabled`, `DELIVERY_ENABLED=false`: оплата и отправка сообщений не включаются при размещении.

База создана и TLS проверен. Сборка Apps и привязка домена выполняются; окончательное подтверждение размещения фиксируется после проверки публичного сайта.

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
cd /opt/chaika-events-db
umask 077
mkdir -p backups
docker compose exec -T database pg_dump -U events_owner -d chaika_events -Fc > "backups/events-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Копии в этом каталоге защищают от ошибки обновления, но не от потери сервера. До открытия реальных продаж нужно настроить внешнее резервное копирование и проверить восстановление. Сертификат PostgreSQL выдан на 825 дней с 19 сентября 2026; при продлении сохранить доверенный CA либо согласованно обновить `PG_CA_CERT` в Apps.

## Альтернативное размещение

`compose.production.yml` и `deploy/update.sh` относятся только к ранее подготовленному варианту отдельного VPS с SQLite. Они не используются в Apps. [App Platform запрещает пользовательские volumes в Docker Compose](https://timeweb.cloud/docs/apps/deploying-with-docker-compose).
