#!/usr/bin/env bash
# Backup lógico CIFRADO do PostgreSQL do Balcão Virtual (pg_dump -Fc → age/openssl → arquivo + sha256 + meta).
#
#   BV_BACKUP_AGE_RECIPIENT=age1...   (preferido; chave pública)   OU   BV_BACKUP_KEY_FILE=/etc/zapscript/backup.key
#   BV_PG_URL=postgresql://user:senha@host:5432/db   (padrão: DIRECT_URL, depois DATABASE_URL)
#   BV_BACKUP_DIR=/var/backups/zapscript  BV_BACKUP_STATUS_FILE=$BV_BACKUP_DIR/status.json
#   BV_BACKUP_KEEP_DAILY=7 BV_BACKUP_KEEP_WEEKLY=4 BV_BACKUP_KEEP_MONTHLY=12
#   Cópia externa (opcional): BV_BACKUP_UPLOADER=aws|rclone + BV_BACKUP_S3_URI/BV_BACKUP_S3_ENDPOINT | BV_BACKUP_RCLONE_DEST
#
# Códigos de saída: 0 ok | 1 falha | 3 backup local ok, cópia externa falhou | 75 já em execução.
# Procedimento e política: infra/backup/README.md
set -Eeuo pipefail
BV_SCRIPT=pg-backup
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

need pg_dump; need psql; need pg_restore; need sha256sum; need flock; need awk
setup_crypto
pg_env_from_url || die "defina BV_PG_URL (ou DIRECT_URL/DATABASE_URL)"
lock_or_exit pg
umask 077

CAT=postgres
TS="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="zapscript-pg-$TS.dump.$ENC_EXT"
DIR="$BV_BACKUP_DIR/$CAT/daily"
mkdir -p "$DIR"
START=$(date +%s)
fail() { # registra falha no status (a API/posture mostra FAIL) e avisa
  local msg="$1"
  rm -f "${DIR:?}/${NAME:?}.partial"
  status_set "lastBackupAt=$(now_iso)" "lastBackupOk=false" "lastBackupError=$msg" "encrypted=true" "cipher=$CIPHER"
  alert "FALHA no backup do PostgreSQL: $msg"
  die "$msg"
}
trap 'fail "erro inesperado na linha $LINENO"' ERR

log "iniciando pg_dump de $PGHOST:$PGPORT/$PGDATABASE (cifra: $CIPHER)"

# contagens de referência (usadas pelo pg-restore-test.sh) e última migration — antes do dump
COUNT_TABLES="${BV_BACKUP_COUNT_TABLES:-BvOrg BvUser BvContact BvConversation BvMessage BvAuditLog}"
counts_json=""
for t in $COUNT_TABLES; do
  n="$(psql -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo -1)"
  counts_json+="${counts_json:+,}\"$t\":$n"
done
last_mig="$(psql -Atq -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1" 2>/dev/null || true)"
server_ver="$(psql -Atq -c 'SHOW server_version' 2>/dev/null | tr -d '\n' || true)"

# dump em formato custom (já comprimido) → cifra → arquivo parcial; só vira definitivo se tudo deu certo (pipefail)
pg_dump --format=custom --no-owner --no-acl --compress=6 | encrypt_stream > "$DIR/$NAME.partial"
[ -s "$DIR/$NAME.partial" ] || fail "backup vazio"
mv "$DIR/$NAME.partial" "$DIR/$NAME"
SIZE="$(stat -c '%s' "$DIR/$NAME")"
( cd "$DIR" && sha256sum "$NAME" > "$NAME.sha256" )
SHA="$(cut -d' ' -f1 "$DIR/$NAME.sha256")"

if [ "$BV_BACKUP_VERIFY" = 1 ]; then
  # prova de que o arquivo é decifrável de ponta a ponta e começa com o cabeçalho de dump custom (PGDMP); a
  # restauração completa é provada por pg-restore-test.sh
  decrypt_stream "$DIR/$NAME" | { head -c 5 > "$DIR/$NAME.magic"; cat >/dev/null; } || fail "verificação pós-backup falhou (decifra)"
  [ "$(cat "$DIR/$NAME.magic")" = "PGDMP" ] || fail "verificação pós-backup falhou (cabeçalho do dump inválido)"
  rm -f "${DIR:?}/${NAME:?}.magic"
fi

DUR=$(( $(date +%s) - START ))
cat > "$DIR/$NAME.meta.json" <<JSON
{"file":"$NAME","createdAt":"$(now_iso)","cipher":"$CIPHER","sizeBytes":$SIZE,"sha256":"$SHA","durationSeconds":$DUR,"pgServerVersion":"$server_ver","lastMigration":"$last_mig","counts":{$counts_json}}
JSON

promote_tiers "$CAT" "$NAME"
rotate_category "$CAT"

OFFSITE=false; RC=0; UPERR=""
if [ -n "${BV_BACKUP_UPLOADER:-}" ]; then
  if upload_offsite "$DIR/$NAME" "$DIR/$NAME.sha256" "$DIR/$NAME.meta.json"; then OFFSITE=true; log "cópia externa concluída"
  else RC=3; UPERR="falha ao enviar a cópia externa"; alert "backup local ok, mas o envio externo falhou"; fi
else log "AVISO: cópia externa não configurada (BV_BACKUP_UPLOADER) — um único servidor não protege contra perda do host/região"; fi

trap - ERR
status_set "lastBackupAt=$(now_iso)" "lastBackupOk=true" "lastBackupError=" "lastBackupFile=$NAME" "lastBackupSizeBytes=$SIZE" "lastBackupSha256=$SHA" \
  "lastBackupDurationSeconds=$DUR" "encrypted=true" "cipher=$CIPHER" "offsite=$OFFSITE" "lastUploadError=$UPERR" "retention=${BV_BACKUP_KEEP_DAILY}d/${BV_BACKUP_KEEP_WEEKLY}w/${BV_BACKUP_KEEP_MONTHLY}m"
log "backup concluído: $NAME ($SIZE bytes, ${DUR}s, offsite=$OFFSITE)"
exit $RC
