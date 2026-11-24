#!/usr/bin/env bash
# Verificação rápida do estado de HA (somente leitura): réplicas da API, Redis (master/replicas) e replicação do Postgres.
#   PRIMARY_URL=postgresql://user:senha@primario:5432/db   STANDBY_URL=postgresql://user:senha@standby:5432/db
#   API_URLS="http://127.0.0.1:3001 http://127.0.0.1:3002"  REDIS_PASSWORD=... REDIS_PROXY=127.0.0.1:6379 (opcional)
# Saída 0 = tudo certo; 1 = alguma checagem falhou. Nunca imprime senhas.
set -u
rc=0
ok()   { printf 'OK    %s\n' "$*"; }
bad()  { printf 'FALHA %s\n' "$*"; rc=1; }

for u in ${API_URLS:-http://127.0.0.1:3001 http://127.0.0.1:3002}; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$u/health" || true)"
  if [ "$code" = 200 ]; then ok "API $u /health"; else bad "API $u /health (HTTP ${code:-000})"; fi
done

if command -v redis-cli >/dev/null 2>&1 && [ -n "${REDIS_PASSWORD:-}" ]; then
  h="${REDIS_PROXY:-127.0.0.1:6379}"
  role="$(REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli -h "${h%%:*}" -p "${h##*:}" info replication 2>/dev/null | tr -d '\r' | sed -n 's/^role://p')"
  if [ "$role" = master ]; then ok "Redis (via proxy) aponta para um master"; else bad "Redis (via proxy) não é master (role=${role:-?})"; fi
fi

if command -v psql >/dev/null 2>&1; then
  if [ -n "${PRIMARY_URL:-}" ]; then
    out="$(psql "$PRIMARY_URL" -Atqc "SELECT application_name||'|'||state||'|'||sync_state||'|'||COALESCE(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn),-1)::bigint FROM pg_stat_replication" 2>&1)"
    if [ -n "$out" ] && ! printf '%s' "$out" | grep -q 'psql:'; then
      while IFS='|' read -r app state sync lag; do
        if [ "$state" = streaming ]; then ok "standby $app streaming ($sync), atraso ${lag} bytes"; else bad "standby $app em estado $state"; fi
      done <<< "$out"
    else bad "primário sem standby conectado (ou inacessível)"; fi
  fi
  if [ -n "${STANDBY_URL:-}" ]; then
    out="$(psql "$STANDBY_URL" -Atqc "SELECT pg_is_in_recovery()::text||'|'||COALESCE(EXTRACT(EPOCH FROM now()-pg_last_xact_replay_timestamp())::int,-1)" 2>&1)"
    rec="${out%%|*}"; lag="${out##*|}"
    if [ "$rec" = true ]; then ok "standby em recovery, último replay há ${lag}s (valor alto é normal sem escrita no primário)"; else bad "standby não está em recovery ($out)"; fi
  fi
else bad "psql ausente"; fi
exit $rc
