#!/bin/sh
set -eu
cd /opt/events-chaika
docker compose -f compose.production.yml exec -T app node deploy/backup.mjs
git pull --ff-only origin main
docker compose -f compose.production.yml up -d --build --wait --wait-timeout 180
git rev-parse HEAD
