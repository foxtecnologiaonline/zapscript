#!/usr/bin/env bash
# Agendador mínimo para o container de backup (alternativa a cron/systemd no host).
#   BV_BACKUP_AT=03:15   horário UTC diário (padrão 03:15 UTC = 00:15 em Brasília)
#   BV_BACKUP_RUN_NOW=1  executa uma vez ao iniciar (útil para validar a configuração)
# Falha de um passo não derruba o agendador (o status.json e o alerta registram).
set -u
BV_SCRIPT=scheduler
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SELF_DIR/lib.sh"

AT="${BV_BACKUP_AT:-03:15}"
run_all() {
  "$SELF_DIR/pg-backup.sh" || log "pg-backup terminou com código $?"
  if [ -d "${BV_STORAGE_DIR:-/var/lib/zapscript/bv-storage}" ]; then "$SELF_DIR/storage-backup.sh" || log "storage-backup terminou com código $?"; fi
}
[ "${BV_BACKUP_RUN_NOW:-0}" = 1 ] && run_all
log "agendador ativo: backup diário às $AT UTC"
while true; do
  now=$(date -u +%s); target=$(date -u -d "today $AT" +%s)
  [ "$target" -le "$now" ] && target=$(date -u -d "tomorrow $AT" +%s)
  sleep $(( target - now ))
  run_all
done
