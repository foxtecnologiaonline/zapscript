#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Cria uma instância de TESTE no Evolution recém-subido e devolve o QR Code.
# Objetivo: conectar um número de teste pelo VPS BR e ver se o aviso de
# fraude/golpe some. Rode na sua máquina OU no VPS (precisa do .env preenchido).
#
#   chmod +x test-instance.sh && ./test-instance.sh
#   ./test-instance.sh meu-nome-de-teste     # opcional: nome da instância
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")"
[[ -f .env ]] && set -a && . ./.env && set +a

: "${DOMAIN:?Defina DOMAIN no .env}"
: "${AUTHENTICATION_API_KEY:?Defina AUTHENTICATION_API_KEY no .env}"

INSTANCE="${1:-teste-br}"
BASE="https://${DOMAIN}"

echo "▶ Criando instância '${INSTANCE}' em ${BASE} …"
curl -fsS -X POST "${BASE}/instance/create" \
  -H "apikey: ${AUTHENTICATION_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"${INSTANCE}\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\"}" \
  | sed 's/,/,\n/g' || true

echo
echo "▶ Buscando QR Code (abra o link 'base64' num conversor ou use o pairingCode)…"
curl -fsS "${BASE}/instance/connect/${INSTANCE}" \
  -H "apikey: ${AUTHENTICATION_API_KEY}" \
  | sed 's/,/,\n/g'

echo
echo "ℹ️  Dica: o campo 'base64' é a imagem do QR. Cole em https://base64.guru/converter/decode/image"
echo "    ou use 'pairingCode' no WhatsApp (Aparelhos conectados → Conectar com número)."
echo "    Para apagar o teste depois:"
echo "    curl -X DELETE ${BASE}/instance/delete/${INSTANCE} -H \"apikey: \${AUTHENTICATION_API_KEY}\""
