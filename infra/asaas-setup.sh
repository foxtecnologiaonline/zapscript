#!/bin/bash
# ZapScript — Asaas Setup
# Testa conexão com a API Asaas e exibe instruções de webhook
set -e

echo "🔧 Verificando conexão com Asaas..."
echo ""

if [ -z "$ASAAS_API_KEY" ]; then
  echo "❌ ASAAS_API_KEY não definida no ambiente."
  echo "   Exporte: export ASAAS_API_KEY=\$aact_..."
  exit 1
fi

BASE="https://sandbox.asaas.com/api/v3"
if [[ "$NODE_ENV" == "production" ]]; then
  BASE="https://api.asaas.com/v3"
fi

RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/myAccount" \
  -H "access_token: $ASAAS_API_KEY")

if [ "$RESP" = "200" ]; then
  echo "✅ Conexão com Asaas OK (HTTP $RESP)"
else
  echo "❌ Erro na conexão: HTTP $RESP"
  echo "   Verifique ASAAS_API_KEY e o ambiente (sandbox vs produção)"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 ASAAS NÃO PRECISA DE PRICE IDs PRÉ-CRIADOS"
echo ""
echo "   Os planos Pro (R\$29,90) e Ultra (R\$59,90)"
echo "   têm os valores definidos diretamente no código."
echo ""
echo "   Basta garantir que ASAAS_API_KEY está no .env."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔗 WEBHOOK — Configure em:"
echo "   app.asaas.com → Configurações → Integrações → Webhooks"
echo ""
echo "   URL:   https://zapscript-api.railway.app/billing/webhook"
echo "   Token: (o mesmo valor de ASAAS_WEBHOOK_TOKEN no .env)"
echo ""
echo "   Eventos para selecionar:"
echo "   ✓ PAYMENT_CONFIRMED"
echo "   ✓ PAYMENT_RECEIVED"
echo "   ✓ PAYMENT_OVERDUE"
echo "   ✓ PAYMENT_REFUNDED"
echo "   ✓ SUBSCRIPTION_DELETED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
