#!/usr/bin/env bash
# Gera o pairing code (parear por numero) de uma instancia.
# Uso: ./get-pair.sh <numero_com_DDI>  [instancia]
set -e
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
NUM="${1:?informe o numero com DDI, ex: 5534998136522}"
INST="${2:-teste-br}"
curl -s "https://${DOMAIN}/instance/connect/${INST}?number=${NUM}" -H "apikey: ${AUTHENTICATION_API_KEY}" > /tmp/pair.json
echo "RAW: $(cat /tmp/pair.json | head -c 200)"
echo "PAIRING=$(grep -oE '"pairingCode":"[^"]*"' /tmp/pair.json | sed 's/"pairingCode":"//; s/"$//')"
