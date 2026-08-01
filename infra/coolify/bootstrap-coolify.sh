#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ZapScript — Automatiza a parte chata do setup do Coolify: subir todas as
# environment variables de uma vez (em vez de colar uma por uma na UI) e
# disparar o deploy, via API do Coolify.
#
# O QUE ISTO NÃO SUBSTITUI (só dá pra fazer pelo navegador, uma vez só):
#   1. Criar o usuário admin no primeiro acesso (Coolify não expõe isso por
#      API por razões óbvias de segurança)
#   2. Gerar um API token: Coolify UI → Keys & Tokens → Create New Token
#   3. Criar o projeto "zapscript" e o resource "Docker Compose" apontando
#      pro repo (New Resource → Docker Compose → conectar GitHub → branch
#      master → infra/coolify/docker-compose.coolify.yml) — depois de criado,
#      pegue o UUID do application na URL (…/project/<p>/application/<UUID>)
#
# Depois disso, este script:
#   - Lê os pares KEY=VALUE de um arquivo .env local (NÃO committado)
#   - Cadastra cada um via API no application indicado
#   - Dispara o deploy
#
# Uso:
#   export COOLIFY_URL="https://coolify.zapscript.me"     # sem barra no final
#   export COOLIFY_API_TOKEN="..."                          # Keys & Tokens
#   export COOLIFY_APP_UUID="..."                           # da URL do app
#   cp infra/coolify/env.coolify.example infra/coolify/.env.coolify.local
#   # preencha infra/coolify/.env.coolify.local com os valores reais
#   ./bootstrap-coolify.sh infra/coolify/.env.coolify.local
#
# Nota sobre versão da API: os endpoints abaixo seguem a API pública do
# Coolify v4 (coolify.io/docs/api-reference) no melhor do meu conhecimento —
# se algum retornar 404, confira o Swagger da SUA instância em
# $COOLIFY_URL/docs/api antes de reportar bug, versões diferentes mudam path.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${COOLIFY_URL:?Defina COOLIFY_URL (ex.: https://coolify.zapscript.me)}"
: "${COOLIFY_API_TOKEN:?Defina COOLIFY_API_TOKEN (UI → Keys & Tokens)}"
: "${COOLIFY_APP_UUID:?Defina COOLIFY_APP_UUID (UUID do application, da URL na UI)}"

ENV_FILE="${1:?Uso: ./bootstrap-coolify.sh caminho/para/.env.coolify.local}"
[[ -f "$ENV_FILE" ]] || { echo "❌ Arquivo não encontrado: $ENV_FILE"; exit 1; }

command -v curl >/dev/null || { echo "❌ curl não encontrado"; exit 1; }

api() { # api METHOD PATH [BODY]
  curl -sS -X "$1" "${COOLIFY_URL}/api/v1${2}" \
    -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -w '\n%{http_code}' \
    ${3:+-d "$3"}
}

echo "════════════════════════════════════════════════════════"
echo "  ZapScript — Bootstrap do resource no Coolify"
echo "════════════════════════════════════════════════════════"

# ── 0. Validar token ─────────────────────────────────────────
echo "[0/2] Validando API token..."
OUT=$(api GET "/teams/current")
CODE=$(echo "$OUT" | tail -1)
[[ "$CODE" == "200" ]] || { echo "❌ Token inválido ou instância inacessível (HTTP $CODE)"; echo "$OUT"; exit 1; }
echo "✅ Token OK"

# ── 1. Cadastrar env vars ────────────────────────────────────
echo "[1/2] Cadastrando environment variables no application $COOLIFY_APP_UUID..."
OK=0; FAIL=0
while IFS='=' read -r KEY VALUE; do
  # ignora linhas vazias e comentários
  [[ -z "$KEY" || "$KEY" == \#* ]] && continue
  KEY="$(echo "$KEY" | xargs)"
  BODY=$(printf '{"key":%s,"value":%s,"is_build_time":false,"is_literal":true}' \
    "$(printf '%s' "$KEY" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$VALUE" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")
  OUT=$(api POST "/applications/${COOLIFY_APP_UUID}/envs" "$BODY")
  CODE=$(echo "$OUT" | tail -1)
  if [[ "$CODE" == "200" || "$CODE" == "201" ]]; then
    OK=$((OK+1))
  else
    # tenta update (PATCH) caso já exista
    OUT2=$(api PATCH "/applications/${COOLIFY_APP_UUID}/envs" "$BODY")
    CODE2=$(echo "$OUT2" | tail -1)
    if [[ "$CODE2" == "200" || "$CODE2" == "201" ]]; then
      OK=$((OK+1))
    else
      echo "   ⚠️  Falhou: $KEY (POST=$CODE PATCH=$CODE2) — cadastre manualmente na UI"
      FAIL=$((FAIL+1))
    fi
  fi
done < "$ENV_FILE"
echo "✅ $OK variáveis cadastradas, $FAIL falharam (verifique na UI se houver falhas)"

# ── 2. Disparar deploy ───────────────────────────────────────
echo "[2/2] Disparando deploy..."
OUT=$(api POST "/deploy?uuid=${COOLIFY_APP_UUID}")
CODE=$(echo "$OUT" | tail -1)
if [[ "$CODE" == "200" || "$CODE" == "201" ]]; then
  echo "✅ Deploy disparado — acompanhe em ${COOLIFY_URL}"
else
  echo "⚠️  Não consegui disparar via API (HTTP $CODE) — clique 'Deploy' manualmente na UI"
  echo "$OUT"
fi
