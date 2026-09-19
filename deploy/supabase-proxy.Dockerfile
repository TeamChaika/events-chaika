FROM alpine:3.23
RUN apk add --no-cache pgbouncer && addgroup -S events && adduser -S -G events -u 10001 events
USER 10001:10001
ENTRYPOINT ["pgbouncer", "/config/pgbouncer.ini"]
