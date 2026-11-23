#!/bin/sh
# Deploy-hook do certbot: copia o certificado renovado para a pasta montada no container do Asterisk (WSS).
# Instalação (no host Vultr):
#   install -m 755 certbot-deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/asterisk-wss.sh
# Variáveis (padrões entre parênteses): BV_WSS_DOMAIN (voz.zapscript.me) · BV_KEYS_DIR (/opt/zapscript/asterisk/keys)
#   ASTERISK_UID (1000) · ASTERISK_CONTAINER (balcao-asterisk)
# O certbot só chama o hook quando RENOVA; rode uma vez à mão após a 1ª emissão. NUNCA use --standalone (ver CLAUDE.md).
set -eu
DOMAIN="${BV_WSS_DOMAIN:-voz.zapscript.me}"
DEST="${BV_KEYS_DIR:-/opt/zapscript/asterisk/keys}"
UID_AST="${ASTERISK_UID:-1000}"
SRC="/etc/letsencrypt/live/$DOMAIN"
[ -r "$SRC/fullchain.pem" ] || { echo "certificado de $DOMAIN não encontrado em $SRC" >&2; exit 1; }
mkdir -p "$DEST"
install -m 640 -o "$UID_AST" -g "$UID_AST" "$SRC/fullchain.pem" "$DEST/fullchain.pem"
install -m 640 -o "$UID_AST" -g "$UID_AST" "$SRC/privkey.pem" "$DEST/privkey.pem"
# O Asterisk só relê o certificado do WSS ao recarregar o HTTP; se não pegar, reinicie em janela sem chamadas.
docker exec "${ASTERISK_CONTAINER:-balcao-asterisk}" asterisk -rx "core reload" >/dev/null 2>&1 || echo "aviso: não consegui recarregar o Asterisk — reinicie o container na próxima janela" >&2
