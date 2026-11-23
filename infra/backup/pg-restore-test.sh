#!/usr/bin/env bash
# Teste de restauração: restaura o ÚLTIMO backup cifrado (ou o arquivo informado) num banco TEMPORÁRIO, valida
# contagens/migrations e registra o RTO medido em BV_BACKUP_STATUS_FILE. Backup sem restauração testada não é backup.
#
#   pg-restore-test.sh [arquivo.dump.age|.enc] [--keep] [--storage]
#     --keep     não apaga o banco temporário ao final (para inspeção manual)
#     --storage  também decifra/lista o último backup do storage (tar) e confere o sha256
#
#   Servidor de destino (precisa de CREATEDB): BV_RESTORE_PG_URL=postgresql://admin:senha@host:5432/postgres
#     Recomendado: um Postgres descartável (docker-compose.backup.yml, profile "restore-test"), NÃO o de produção.
#   Decifrar: BV_BACKUP_KEY_FILE (openssl) ou BV_BACKUP_AGE_IDENTITY_FILE (age — chave PRIVADA, fora do servidor de produção)
#   Tolerância das contagens (o dump é de um banco vivo): BV_RESTORE_TOLERANCE_PCT=2 BV_RESTORE_TOLERANCE_ABS=100
#   Opcional: BV_RESTORE_APP_CHECK_CMD='comando' roda com RESTORED_DATABASE_URL exportada (ex.: a CLI de chaves de campo:
#             node apps/api/dist/balcao/security/cli/rotate-field-keys.js --status).
#
# Saída 0 = restauração válida; 1 = falha. O RTO medido cobre decifrar + restaurar + validar (sem o tempo de
# provisionar o servidor, que deve ser somado no exercício de DR completo — ver docs/balcao/INFRA-BR-CERTIFICACOES.md).
set -Eeuo pipefail
BV_SCRIPT=pg-restore-test
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

KEEP=0; WITH_STORAGE=0; FILE=""
for a in "$@"; do
  case "$a" in --keep) KEEP=1;; --storage) WITH_STORAGE=1;; -*) die "opção desconhecida: $a";; *) FILE="$a";; esac
done

need pg_restore; need psql; need sha256sum; need awk; need flock
lock_or_exit restore
umask 077
[ -n "$FILE" ] || FILE="$(latest_backup postgres)"
[ -n "$FILE" ] && [ -f "$FILE" ] || die "nenhum backup encontrado em $BV_BACKUP_DIR/postgres/daily"
BASE="$(basename "$FILE")"

# o servidor de destino vem de BV_RESTORE_PG_URL (padrão: o mesmo servidor do backup, com aviso)
if [ -n "${BV_RESTORE_PG_URL:-}" ]; then pg_env_from_url "$BV_RESTORE_PG_URL"; else
  pg_env_from_url || die "defina BV_RESTORE_PG_URL (servidor com CREATEDB)"
  log "AVISO: BV_RESTORE_PG_URL não definido — usando o mesmo servidor do backup. Prefira um Postgres descartável."
fi
export PGDATABASE=postgres
TMPDB="bv_restore_test_$(date -u +%Y%m%d%H%M%S)_$$"
case "$TMPDB" in bv_restore_test_*) ;; *) die "nome de banco temporário inválido";; esac
WORK="$(mktemp -d "${BV_RESTORE_WORKDIR:-${TMPDIR:-/tmp}}/bv-restore.XXXXXX")"
DUMP="$WORK/restore.dump"
ERRLOG="$WORK/restore.err"
T0=$(date +%s)
DB_CREATED=0

cleanup() {
  if [ "$DB_CREATED" = 1 ] && [ "$KEEP" = 0 ]; then
    PGDATABASE=postgres psql -Atq -c "DROP DATABASE IF EXISTS \"${TMPDB:?}\" WITH (FORCE)" >/dev/null 2>&1 || log "AVISO: não foi possível apagar $TMPDB"
  fi
  rm -rf "${WORK:?}"
}
trap cleanup EXIT
fail() {
  status_set "lastRestoreTestAt=$(now_iso)" "lastRestoreTestOk=false" "lastRestoreTestError=$1" "restoredBackup=$BASE"
  alert "FALHA no teste de restauração: $1"
  die "$1"
}
trap 'fail "erro inesperado na linha $LINENO"' ERR

log "backup: $BASE"
# 1) integridade do arquivo cifrado
if [ -f "$FILE.sha256" ]; then
  ( cd "$(dirname "$FILE")" && sha256sum -c --status "$BASE.sha256" ) || fail "sha256 do arquivo não confere (corrompido/adulterado)"
  log "sha256 conferido"
else log "AVISO: sem arquivo .sha256 ao lado do backup"; fi

# 2) decifrar (para arquivo, permitindo pg_restore -j) e conferir que é um dump
decrypt_stream "$FILE" > "$DUMP" || fail "não foi possível decifrar (chave errada ou arquivo corrompido)"
pg_restore --list "$DUMP" >/dev/null 2>&1 || fail "conteúdo decifrado não é um dump válido"
T_DEC=$(date +%s)

# 3) restaurar em banco temporário
psql -Atq -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$TMPDB\"" || fail "sem permissão para criar banco temporário (CREATEDB)"
DB_CREATED=1
set +e
pg_restore --dbname="$TMPDB" --no-owner --no-acl --jobs="${BV_RESTORE_JOBS:-2}" "$DUMP" 2> "$ERRLOG"
set -e
ERRS="$(grep -c 'error:' "$ERRLOG" 2>/dev/null || true)"; ERRS="${ERRS:-0}"
if [ "$ERRS" -gt "${BV_RESTORE_MAX_ERRORS:-0}" ]; then
  log "primeiros erros do pg_restore:"; grep 'error:' "$ERRLOG" | head -n 5 >&2 || true
  fail "pg_restore reportou $ERRS erro(s)"
fi
T_RES=$(date +%s)

# 4) validação: contagens (meta do backup × restaurado) e migrations
export PGDATABASE="$TMPDB"
META="$FILE.meta.json"
FAILS=0; CHECKED=0
if [ -f "$META" ]; then
  counts="$(sed -n 's/.*"counts":{\([^}]*\)}.*/\1/p' "$META")"
  IFS=',' read -r -a pairs <<< "$counts"
  for p in "${pairs[@]}"; do
    t="$(printf '%s' "${p%%:*}" | tr -d '"')"; exp="${p##*:}"
    [ -n "$t" ] || continue
    if [ "$exp" = "-1" ]; then continue; fi          # tabela inexistente na origem
    got="$(psql -Atq -c "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo -1)"
    tol=$(( exp * ${BV_RESTORE_TOLERANCE_PCT:-2} / 100 )); [ "$tol" -lt "${BV_RESTORE_TOLERANCE_ABS:-100}" ] && tol="${BV_RESTORE_TOLERANCE_ABS:-100}"
    diff=$(( got - exp )); [ "$diff" -lt 0 ] && diff=$(( -diff ))
    CHECKED=$((CHECKED+1))
    if [ "$got" -lt 0 ] || [ "$diff" -gt "$tol" ] || { [ "$exp" -gt 0 ] && [ "$got" -eq 0 ]; }; then
      FAILS=$((FAILS+1)); log "contagem divergente em $t: origem=$exp restaurado=$got (tolerância $tol)"
    else log "ok  $t: origem=$exp restaurado=$got"; fi
  done
  want_mig="$(sed -n 's/.*"lastMigration":"\([^"]*\)".*/\1/p' "$META")"
  if [ -n "$want_mig" ]; then
    got_mig="$(psql -Atq -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1" 2>/dev/null || true)"
    if [ "$got_mig" != "$want_mig" ]; then FAILS=$((FAILS+1)); log "última migration divergente (origem=$want_mig restaurado=${got_mig:-n/d})"; else log "ok  migrations: $got_mig"; fi
  fi
else log "AVISO: sem meta.json — validando apenas a existência de tabelas"; fi
NT="$(psql -Atq -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
[ "${NT:-0}" -gt 0 ] || { FAILS=$((FAILS+1)); log "nenhuma tabela restaurada"; }
if [ -n "${BV_RESTORE_APP_CHECK_CMD:-}" ]; then
  # shellcheck disable=SC2155
  export RESTORED_DATABASE_URL="postgresql://${PGUSER}:$(printf %s "$PGPASSWORD" | sed 's/[^A-Za-z0-9._~-]/%&/g')@${PGHOST}:${PGPORT}/${TMPDB}"
  if bash -c "$BV_RESTORE_APP_CHECK_CMD" >/dev/null 2>&1; then log "ok  verificação da aplicação"; else FAILS=$((FAILS+1)); log "verificação da aplicação falhou"; fi
fi
[ "$FAILS" -eq 0 ] || fail "validação falhou ($FAILS divergência(s))"

# 5) storage (opcional): integridade e listagem
if [ "$WITH_STORAGE" = 1 ]; then
  SF="$(latest_backup storage)"
  [ -n "$SF" ] || fail "sem backup do storage"
  ( cd "$(dirname "$SF")" && sha256sum -c --status "$(basename "$SF").sha256" ) || fail "sha256 do backup do storage não confere"
  n="$(decrypt_stream "$SF" | tar -tzf - | wc -l | tr -d ' ')" || fail "backup do storage ilegível"
  log "ok  storage: $(basename "$SF") ($n entradas)"
fi

T_END=$(date +%s)
RTO=$(( T_END - T0 ))
trap - ERR
status_set "lastRestoreTestAt=$(now_iso)" "lastRestoreTestOk=true" "lastRestoreTestError=" "restoredBackup=$BASE" "rtoSeconds=$RTO" \
  "rtoDecryptSeconds=$(( T_DEC - T0 ))" "rtoRestoreSeconds=$(( T_RES - T_DEC ))" "restoreChecks=$CHECKED" "restoreWarnings=$ERRS"
log "restauração VÁLIDA: $CHECKED contagens conferidas; RTO medido = ${RTO}s (decifrar $(( T_DEC - T0 ))s + restaurar $(( T_RES - T_DEC ))s + validar $(( T_END - T_RES ))s)"
