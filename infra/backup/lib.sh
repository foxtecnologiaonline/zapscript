#!/usr/bin/env bash
# Funções comuns dos scripts de backup do Balcão Virtual (carregar com `source lib.sh`).
# Sem dependências além de: bash, coreutils, openssl (ou age), awk, sed, psql/pg_dump/pg_restore, tar, gzip.
# NUNCA imprime chaves, senhas ou conteúdo de dados — só nomes de arquivo, tamanhos e contagens.

BV_BACKUP_DIR="${BV_BACKUP_DIR:-/var/backups/zapscript}"
BV_BACKUP_STATUS_FILE="${BV_BACKUP_STATUS_FILE:-$BV_BACKUP_DIR/status.json}"
BV_BACKUP_KEEP_DAILY="${BV_BACKUP_KEEP_DAILY:-7}"
BV_BACKUP_KEEP_WEEKLY="${BV_BACKUP_KEEP_WEEKLY:-4}"
BV_BACKUP_KEEP_MONTHLY="${BV_BACKUP_KEEP_MONTHLY:-12}"
BV_BACKUP_WEEKLY_DOW="${BV_BACKUP_WEEKLY_DOW:-7}"   # 1=segunda ... 7=domingo
BV_BACKUP_VERIFY="${BV_BACKUP_VERIFY:-1}"           # decifra e lista o conteúdo logo após gerar
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '%s [%s] %s\n' "$(date -u +%FT%TZ)" "${BV_SCRIPT:-backup}" "$*" >&2; }
die()  { log "ERRO: $*"; exit "${2:-1}"; }
now_iso() { date -u +%FT%TZ; }
need() { command -v "$1" >/dev/null 2>&1 || die "comando obrigatório ausente: $1"; }

# ── Status (JSON lido pela API: GET /balcao/security/posture) ──────────────────
# Estado em chave=valor (status.json.kv) e renderizado para JSON a cada alteração (mescla scripts diferentes).
status_set() {
  local kv="$BV_BACKUP_STATUS_FILE.kv" tmp k v pair
  mkdir -p "$(dirname "$BV_BACKUP_STATUS_FILE")"; touch "$kv"
  tmp="$(mktemp "$kv.XXXXXX")"
  cp "$kv" "$tmp"
  for pair in "$@"; do
    k="${pair%%=*}"; v="${pair#*=}"; v="${v//$'\n'/ }"
    grep -v "^${k}=" "$tmp" > "$tmp.n" || true
    printf '%s=%s\n' "$k" "$v" >> "$tmp.n"; mv "$tmp.n" "$tmp"
  done
  mv "$tmp" "$kv"
  awk -F= 'BEGIN{printf "{"} {k=$1; v=substr($0,length(k)+2); printf "%s\"%s\":", (NR>1?",":""), k;
    if (v ~ /^(true|false|-?[0-9]+(\.[0-9]+)?)$/) printf "%s", v; else { gsub(/\\/,"\\\\",v); gsub(/"/,"\\\"",v); printf "\"%s\"", v } }
    END{print "}"}' "$kv" > "$BV_BACKUP_STATUS_FILE.tmp"
  chmod 0644 "$BV_BACKUP_STATUS_FILE.tmp"; mv "$BV_BACKUP_STATUS_FILE.tmp" "$BV_BACKUP_STATUS_FILE"
}

alert() { # avisa por webhook (opcional) — mensagem sem dados pessoais
  [ -n "${BV_BACKUP_ALERT_WEBHOOK:-}" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  curl -fsS -m 15 -H 'content-type: application/json' -d "{\"text\":\"[Balcão backup] $1\"}" "$BV_BACKUP_ALERT_WEBHOOK" >/dev/null 2>&1 || true
}

# ── Exclusão mútua ─────────────────────────────────────────────────────────────
lock_or_exit() {
  mkdir -p "$BV_BACKUP_DIR"
  exec 9>"$BV_BACKUP_DIR/.lock-${1:-backup}"
  flock -n 9 || die "outra execução de ${1:-backup} em andamento" 75
}

# ── Criptografia ───────────────────────────────────────────────────────────────
# Preferência: age com chave PÚBLICA (BV_BACKUP_AGE_RECIPIENT) — o servidor não guarda segredo capaz de decifrar.
# Alternativa: openssl AES-256-CBC + PBKDF2 (600k iterações) com chave em arquivo FORA do repositório (BV_BACKUP_KEY_FILE).
CIPHER=""; ENC_EXT=""
setup_crypto() {
  if [ -n "${BV_BACKUP_AGE_RECIPIENT:-}" ]; then
    need age; CIPHER="age"; ENC_EXT="age"
  elif [ -n "${BV_BACKUP_KEY_FILE:-}" ]; then
    need openssl; CIPHER="openssl-aes-256-cbc-pbkdf2"; ENC_EXT="enc"
    [ -f "$BV_BACKUP_KEY_FILE" ] || die "BV_BACKUP_KEY_FILE não existe"
    local mode size; mode="$(stat -c '%a' "$BV_BACKUP_KEY_FILE")"; size="$(stat -c '%s' "$BV_BACKUP_KEY_FILE")"
    [ $(( 8#$mode & 8#077 )) -eq 0 ] || die "BV_BACKUP_KEY_FILE com permissão aberta ($mode); use chmod 600"
    [ "$size" -ge 32 ] || die "BV_BACKUP_KEY_FILE curta demais (< 32 bytes); gere com: openssl rand -base64 48 > arquivo"
    case "$(readlink -f "$BV_BACKUP_KEY_FILE")" in "$(readlink -f "$LIB_DIR/../..")"/*) die "a chave não pode ficar dentro do repositório";; esac
  else
    die "sem criptografia configurada: defina BV_BACKUP_AGE_RECIPIENT (preferido) ou BV_BACKUP_KEY_FILE — backup em claro é recusado"
  fi
}
encrypt_stream() {
  if [ "$CIPHER" = age ]; then
    local args=() r
    # shellcheck disable=SC2086
    for r in $BV_BACKUP_AGE_RECIPIENT; do args+=(-r "$r"); done
    age "${args[@]}"
  else openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$BV_BACKUP_KEY_FILE"; fi
}
# decifra conforme a extensão do arquivo ($1) para o stdout
decrypt_stream() {
  case "$1" in
    *.age) [ -n "${BV_BACKUP_AGE_IDENTITY_FILE:-}" ] || die "defina BV_BACKUP_AGE_IDENTITY_FILE (chave privada age, guardada fora do servidor de produção)"; age -d -i "$BV_BACKUP_AGE_IDENTITY_FILE" "$1";;
    *.enc) [ -n "${BV_BACKUP_KEY_FILE:-}" ] || die "defina BV_BACKUP_KEY_FILE"; openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$BV_BACKUP_KEY_FILE" -in "$1";;
    *) die "extensão desconhecida: $1";;
  esac
}

# ── Conexão PostgreSQL: converte BV_PG_URL/DIRECT_URL/DATABASE_URL em variáveis PG* (a senha não vai para argv/ps) ─
urldecode() { printf '%b' "${1//%/\\x}"; }
pg_env_from_url() {
  local url="${1:-${BV_PG_URL:-${DIRECT_URL:-${DATABASE_URL:-}}}}"
  [ -n "$url" ] || return 1
  local rest="${url#*://}" auth hostpart dbq db q user pass host port kv
  auth="${rest%%@*}"; hostpart="${rest#*@}"
  if [ "$auth" = "$rest" ]; then auth=""; hostpart="$rest"; fi
  dbq="${hostpart#*/}"; hostpart="${hostpart%%/*}"; db="${dbq%%\?*}"; q=""
  if [[ "$dbq" == *\?* ]]; then q="${dbq#*\?}"; fi
  user="${auth%%:*}"; pass=""
  if [[ "$auth" == *:* ]]; then pass="${auth#*:}"; fi
  host="${hostpart%%:*}"; port=5432
  if [[ "$hostpart" == *:* ]]; then port="${hostpart#*:}"; fi
  PGUSER="$(urldecode "$user")"; PGPASSWORD="$(urldecode "$pass")"; PGHOST="$host"; PGPORT="$port"; PGDATABASE="$db"
  export PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE
  for kv in ${q//&/ }; do case "$kv" in sslmode=*) export PGSSLMODE="${kv#sslmode=}";; esac; done   # schema=/pgbouncer= são do Prisma, não do libpq
  return 0
}

# ── Rotação diária/semanal/mensal ──────────────────────────────────────────────
# Estrutura: $BV_BACKUP_DIR/<categoria>/{daily,weekly,monthly}/arquivo(.sha256|.meta.json)
link_set() { # $1=origem-dir $2=destino-dir $3=arquivo-base
  local s
  for s in "" .sha256 .meta.json; do
    if [ -f "${1:?}/${3:?}$s" ]; then ln -f "${1:?}/${3:?}$s" "${2:?}/${3:?}$s"; fi
  done
}
promote_tiers() { # $1=categoria $2=arquivo(base) — liga o backup do dia em weekly/monthly nos dias certos
  local cat="${1:?}" f="${2:?}" dow dom
  dow="$(date -u +%u)"; dom="$(date -u +%d)"
  mkdir -p "$BV_BACKUP_DIR/$cat/weekly" "$BV_BACKUP_DIR/$cat/monthly"
  if [ "$dow" = "$BV_BACKUP_WEEKLY_DOW" ]; then link_set "$BV_BACKUP_DIR/$cat/daily" "$BV_BACKUP_DIR/$cat/weekly" "$f"; fi
  if [ "$dom" = "01" ]; then link_set "$BV_BACKUP_DIR/$cat/daily" "$BV_BACKUP_DIR/$cat/monthly" "$f"; fi
}
prune_tier() { # $1=diretório $2=manter(N) — mantém os N mais recentes (o nome contém o timestamp UTC)
  local dir="${1:?}" keep="${2:?}" f n=0
  [ -d "$dir" ] || return 0
  while IFS= read -r f; do
    n=$((n+1))
    if [ "$n" -le "$keep" ]; then continue; fi
    rm -f -- "${dir:?}/${f:?}" "${dir:?}/${f:?}.sha256" "${dir:?}/${f:?}.meta.json"
  done < <(cd "$dir" && { ls -1 2>/dev/null || true; } | { grep -Ev '\.(sha256|meta\.json|partial)$' || true; } | sort -r)
}
rotate_category() { # $1=categoria
  prune_tier "$BV_BACKUP_DIR/$1/daily" "$BV_BACKUP_KEEP_DAILY"
  prune_tier "$BV_BACKUP_DIR/$1/weekly" "$BV_BACKUP_KEEP_WEEKLY"
  prune_tier "$BV_BACKUP_DIR/$1/monthly" "$BV_BACKUP_KEEP_MONTHLY"
}
latest_backup() { # $1=categoria → caminho do mais recente em daily/
  (cd "$BV_BACKUP_DIR/$1/daily" 2>/dev/null && { ls -1 2>/dev/null || true; } | { grep -Ev '\.(sha256|meta\.json|partial)$' || true; } | sort -r | sed -n "1s|^|$BV_BACKUP_DIR/$1/daily/|p") || true
}

# ── Cópia externa (S3-compatível em região no Brasil) ──────────────────────────
# BV_BACKUP_UPLOADER=aws|rclone. aws: BV_BACKUP_S3_URI=s3://bucket/prefix [BV_BACKUP_S3_ENDPOINT=https://...]
# rclone: BV_BACKUP_RCLONE_DEST=remoto:bucket/prefix. Credenciais pelo ambiente/arquivo de config do próprio aws/rclone.
upload_offsite() { # $@ = arquivos
  local up="${BV_BACKUP_UPLOADER:-}" f ep=()
  [ -n "$up" ] || return 2
  case "$up" in
    aws)    need aws; [ -n "${BV_BACKUP_S3_URI:-}" ] || return 2
            if [ -n "${BV_BACKUP_S3_ENDPOINT:-}" ]; then ep=(--endpoint-url "$BV_BACKUP_S3_ENDPOINT"); fi
            for f in "$@"; do aws "${ep[@]}" s3 cp --only-show-errors "$f" "${BV_BACKUP_S3_URI%/}/$(basename "$f")" || return 1; done;;
    rclone) need rclone; [ -n "${BV_BACKUP_RCLONE_DEST:-}" ] || return 2
            for f in "$@"; do rclone copyto --quiet "$f" "${BV_BACKUP_RCLONE_DEST%/}/$(basename "$f")" || return 1; done;;
    *) die "BV_BACKUP_UPLOADER inválido: $up (aws|rclone)";;
  esac
}
