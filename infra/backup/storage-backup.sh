#!/usr/bin/env bash
# Backup CIFRADO do armazenamento de objetos (anexos e gravações em BV_STORAGE_DIR): tar.gz → age/openssl.
# Exclui `*/tmp/*` (temporários da exportação) e, por padrão, `*/exports/*` (derivados, expiram em dias;
# BV_STORAGE_BACKUP_EXPORTS=1 para incluir). Mesma rotação/cópia externa/status do pg-backup.sh.
#
#   BV_STORAGE_DIR=/var/lib/zapscript/bv-storage   (o mesmo volume montado na API)
#
# Observação: banco e storage devem ser restaurados do MESMO dia (as mensagens referenciam arquivos por chave).
set -Eeuo pipefail
BV_SCRIPT=storage-backup
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

need tar; need gzip; need sha256sum; need flock; need awk
setup_crypto
SRC="${BV_STORAGE_DIR:-/var/lib/zapscript/bv-storage}"
[ -d "$SRC" ] || die "BV_STORAGE_DIR não existe: $SRC"
lock_or_exit storage
umask 077

CAT=storage
TS="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="zapscript-storage-$TS.tar.gz.$ENC_EXT"
DIR="$BV_BACKUP_DIR/$CAT/daily"
mkdir -p "$DIR"
START=$(date +%s)
fail() {
  rm -f "${DIR:?}/${NAME:?}.partial"
  status_set "lastStorageBackupAt=$(now_iso)" "lastStorageBackupOk=false" "lastStorageBackupError=$1"
  alert "FALHA no backup do storage: $1"
  die "$1"
}
trap 'fail "erro inesperado na linha $LINENO"' ERR

EXCL=(--exclude='./*/tmp' --exclude='./*/tmp/*')
if [ "${BV_STORAGE_BACKUP_EXPORTS:-0}" != 1 ]; then EXCL+=(--exclude='./*/exports' --exclude='./*/exports/*'); fi
FILES="$(cd "$SRC" && find . -type f ! -path './*/tmp/*' ! -path './*/exports/*' 2>/dev/null | wc -l | tr -d ' ')"
log "iniciando tar de $SRC ($FILES arquivos; cifra: $CIPHER)"

# tar tolera arquivos que somem durante a leitura (status 1) — qualquer outro erro derruba o backup
set +e
tar -C "$SRC" "${EXCL[@]}" -cf - . | gzip -6 | encrypt_stream > "$DIR/$NAME.partial"
rc=("${PIPESTATUS[@]}")
set -e
if [ "${rc[0]}" -gt 1 ] || [ "${rc[1]}" -ne 0 ] || [ "${rc[2]}" -ne 0 ]; then fail "tar/gzip/cifra falhou (${rc[*]})"; fi
[ -s "$DIR/$NAME.partial" ] || fail "backup vazio"
mv "$DIR/$NAME.partial" "$DIR/$NAME"
SIZE="$(stat -c '%s' "$DIR/$NAME")"
( cd "$DIR" && sha256sum "$NAME" > "$NAME.sha256" )
SHA="$(cut -d' ' -f1 "$DIR/$NAME.sha256")"

ENTRIES=0
if [ "$BV_BACKUP_VERIFY" = 1 ]; then
  ENTRIES="$(decrypt_stream "$DIR/$NAME" | tar -tzf - | wc -l | tr -d ' ')" || fail "verificação pós-backup falhou"
fi
DUR=$(( $(date +%s) - START ))
printf '{"file":"%s","createdAt":"%s","cipher":"%s","sizeBytes":%s,"sha256":"%s","durationSeconds":%s,"sourceFiles":%s,"archiveEntries":%s}\n' \
  "$NAME" "$(now_iso)" "$CIPHER" "$SIZE" "$SHA" "$DUR" "$FILES" "$ENTRIES" > "$DIR/$NAME.meta.json"

promote_tiers "$CAT" "$NAME"
rotate_category "$CAT"

OFFSITE=false; RC=0; UPERR=""
if [ -n "${BV_BACKUP_UPLOADER:-}" ]; then
  if upload_offsite "$DIR/$NAME" "$DIR/$NAME.sha256" "$DIR/$NAME.meta.json"; then OFFSITE=true; else RC=3; UPERR="falha ao enviar a cópia externa"; alert "backup do storage local ok, envio externo falhou"; fi
fi
trap - ERR
status_set "lastStorageBackupAt=$(now_iso)" "lastStorageBackupOk=true" "lastStorageBackupError=" "lastStorageBackupFile=$NAME" "lastStorageBackupSizeBytes=$SIZE" "lastStorageBackupFiles=$FILES" "storageOffsite=$OFFSITE" "lastStorageUploadError=$UPERR"
log "backup do storage concluído: $NAME ($SIZE bytes, ${DUR}s, offsite=$OFFSITE)"
exit $RC
