#!/usr/bin/env bash
# Busca o QR da instancia e salva como PNG + imprime o base64 puro.
set -e
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
INST="${1:-teste-br}"
curl -s "https://${DOMAIN}/instance/connect/${INST}" -H "apikey: ${AUTHENTICATION_API_KEY}" > /tmp/connect.json
grep -oE '"base64":"[^"]*"' /tmp/connect.json | sed 's/"base64":"//; s/"$//' > /tmp/qr_dataurl.txt
sed 's#^data:image/png;base64,##' /tmp/qr_dataurl.txt > /tmp/qr_b64.txt
base64 -d /tmp/qr_b64.txt > /tmp/qr.png 2>/dev/null || true
echo "PNG_BYTES=$(wc -c < /tmp/qr.png)"
echo "PAIRING=$(grep -oE '"pairingCode":"[^"]*"' /tmp/connect.json | sed 's/"pairingCode":"//; s/"$//')"
