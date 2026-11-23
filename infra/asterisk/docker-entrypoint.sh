#!/bin/sh
# Entrypoint do container Asterisk do Balcão Virtual:
#   1) valida variáveis obrigatórias  2) copia conf/ estático  3) renderiza templates/*.tpl (render.js)
#   4) gera os ramais WebRTC (gen-agents.js)  5) ajusta permissões  6) sobe o Asterisk em primeiro plano.
set -eu

CONF=/etc/asterisk
SRC=/opt/balcao

: "${BV_ARI_PASS:?BV_ARI_PASS é obrigatório (senha do usuário ARI)}"
: "${BV_SIP_SECRET:?BV_SIP_SECRET é obrigatório (mesmo valor da API; deriva a senha dos ramais)}"

# Certificado do WSS: ausente → falha clara, ou autoassinado se BV_WSS_SELF_SIGNED=1 (SÓ bancada: o navegador recusa).
CERT="${BV_WSS_CERT:-/etc/asterisk/keys/fullchain.pem}"
KEY="${BV_WSS_KEY:-/etc/asterisk/keys/privkey.pem}"
if [ ! -r "$CERT" ] || [ ! -r "$KEY" ]; then
  if [ "${BV_WSS_SELF_SIGNED:-0}" = "1" ]; then
    echo "[balcao] AVISO: certificado WSS ausente — gerando AUTOASSINADO (somente desenvolvimento)." >&2
    mkdir -p "$CONF/keys-selfsigned"
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=${BV_SIP_DOMAIN:-balcao.local}" \
      -keyout "$CONF/keys-selfsigned/privkey.pem" -out "$CONF/keys-selfsigned/fullchain.pem" >/dev/null 2>&1
    BV_WSS_CERT="$CONF/keys-selfsigned/fullchain.pem"; BV_WSS_KEY="$CONF/keys-selfsigned/privkey.pem"; export BV_WSS_CERT BV_WSS_KEY
  else
    echo "[balcao] ERRO: certificado WSS não legível ($CERT / $KEY). Monte ./keys (fullchain.pem + privkey.pem, legíveis pelo uid do asterisk) ou use BV_WSS_SELF_SIGNED=1 só para testes." >&2
    exit 1
  fi
fi

if [ -n "${BV_TRUNK_HOST:-}" ] && [ -z "${BV_TRUNK_IPS:-}" ] && [ "${BV_TRUNK_AUTH:-ip}" != "userpass" ]; then
  echo "[balcao] AVISO: BV_TRUNK_HOST definido sem BV_TRUNK_IPS — chamadas ENTRANDO do tronco não serão associadas ao endpoint (identify)." >&2
fi
[ -n "${BV_EXTERNAL_IP:-}" ] || echo "[balcao] AVISO: BV_EXTERNAL_IP vazio — sem IP público anunciado o áudio (RTP) não chega ao tronco/navegador atrás do NAT do Docker." >&2

cp "$SRC"/conf/*.conf "$CONF"/
node "$SRC/render.js" "$SRC/templates" "$CONF"
node "$SRC/gen-agents.js" "$CONF/pjsip_agents.conf"

chown -R asterisk:asterisk "$CONF" /var/spool/asterisk /var/log/asterisk /var/run/asterisk /var/lib/asterisk/sounds/balcao 2>/dev/null || true
# moh e keys podem ser montados somente-leitura: ignora erro
chown -R asterisk:asterisk /var/lib/asterisk/moh 2>/dev/null || true

echo "[balcao] configuração gerada em $CONF: $(ls "$CONF" | tr '\n' ' ')"
exec asterisk -f -U asterisk -G asterisk
