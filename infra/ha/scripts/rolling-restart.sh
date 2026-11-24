#!/usr/bin/env bash
# Deploy/restart das réplicas da API UMA POR VEZ, esperando o healthcheck do Docker — sem indisponibilidade
# (o nginx retira a réplica que cai via max_fails e o Socket.IO reconecta na outra).
#   ./rolling-restart.sh [serviço ...]        padrão: api1 api2 worker
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose ${BV_HA_ENV_FILE:+--env-file "$BV_HA_ENV_FILE"} -f docker-compose.ha.yml)
SERVICES=("$@"); [ ${#SERVICES[@]} -gt 0 ] || SERVICES=(api1 api2 worker)
for s in "${SERVICES[@]}"; do
  echo "[rolling] recriando $s"
  "${COMPOSE[@]}" up -d --no-deps --force-recreate "$s"
  cid="$("${COMPOSE[@]}" ps -q "$s")"
  for i in $(seq 1 60); do
    st="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
    if [ "$st" = healthy ] || [ "$st" = running ]; then echo "[rolling] $s $st"; break; fi
    if [ "$i" = 60 ]; then echo "[rolling] ERRO: $s não ficou saudável em 5 min — interrompido (as demais réplicas seguem no ar)" >&2; exit 1; fi
    sleep 5
  done
  sleep 10   # deixa o nginx e os clientes reequilibrarem antes da próxima
done
echo "[rolling] concluído"
