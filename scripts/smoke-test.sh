#!/usr/bin/env bash
# Smoke test pós-deploy — roda manualmente ou via cron/CI depois de um deploy.
# Uso: ./scripts/smoke-test.sh [https://zapscript.onrender.com]
set -uo pipefail

API="${1:-https://zapscript.onrender.com}"
FAIL=0

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAIL=1; }

echo "🔎 Smoke test — $API"
echo ""

# 1) Health check
echo "1) Health"
HEALTH=$(curl -s -o /tmp/smoke_health.json -w "%{http_code}" "$API/health")
if [ "$HEALTH" = "200" ]; then
  if grep -q '"status":"ok"' /tmp/smoke_health.json 2>/dev/null; then
    pass "GET /health → 200 status=ok ($(cat /tmp/smoke_health.json))"
  else
    fail "GET /health → 200 mas body inesperado: $(cat /tmp/smoke_health.json)"
  fi
else
  fail "GET /health → $HEALTH (esperado 200)"
fi

# 2) Headers de segurança
echo "2) Security headers"
HEADERS=$(curl -s -I "$API/health")
for h in "strict-transport-security" "x-content-type-options" "x-frame-options" "content-security-policy" "permissions-policy"; do
  if echo "$HEADERS" | grep -qi "^$h:"; then
    pass "$h presente"
  else
    fail "$h AUSENTE"
  fi
done

# 3) Escudo — path de sondagem deve levar 403
echo "3) Escudo cibernético (probe-block)"
PROBE=$(curl -s -o /dev/null -w "%{http_code}" "$API/.env")
if [ "$PROBE" = "403" ]; then
  pass "GET /.env → 403 (bloqueado)"
else
  fail "GET /.env → $PROBE (esperado 403)"
fi

# 4) Rota autenticada sem token deve levar 401 (nunca vazar dados)
echo "4) Auth obrigatória"
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$API/sys/g5r8t2/stats")
if [ "$NOAUTH" = "401" ]; then
  pass "GET /sys/g5r8t2/stats sem token → 401"
else
  fail "GET /sys/g5r8t2/stats sem token → $NOAUTH (esperado 401)"
fi

# 5) Rate limit headers presentes numa rota normal
echo "5) Rate limit"
RL=$(curl -s -I "$API/health" | grep -i "x-ratelimit" | wc -l)
echo "  ℹ️  /health é isento de rate-limit por padrão — checagem informativa apenas"

echo ""
if [ "$FAIL" = "0" ]; then
  echo "✅ Smoke test OK — $API saudável"
else
  echo "❌ Smoke test com falhas — revisar acima antes de considerar o deploy saudável"
fi
exit $FAIL
