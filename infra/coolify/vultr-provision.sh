#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ZapScript — Provisiona o VPS do Coolify na Vultr via API (zero cliques no painel)
#
# Roda a partir de UMA MÁQUINA COM ACESSO À INTERNET pública (sua máquina local,
# CI, etc.) — não roda dentro desta sessão do Claude porque a rede daqui bloqueia
# api.vultr.com por política de egress (ver /root/.ccr/README.md do ambiente).
#
# O que faz:
#   1. Descobre o os_id do Ubuntu 24.04 LTS x64 na API da Vultr
#   2. Garante uma SSH key cadastrada na conta (usa VULTR_SSHKEY_ID existente,
#      ou registra a chave pública apontada por VULTR_SSH_PUBLIC_KEY)
#   3. Cria a instância já com um cloud-init que instala o Coolify sozinho no
#      primeiro boot (embute infra/coolify/install-coolify.sh, sem precisar
#      de SSH manual nem baixar nada de fora)
#   4. Espera o servidor ficar "active" e imprime o IP público
#
# Uso:
#   export VULTR_API_KEY="..."                      # obrigatório — my.vultr.com/settings/api
#   export VULTR_SSHKEY_ID="..."                     # OU VULTR_SSH_PUBLIC_KEY abaixo
#   export VULTR_SSH_PUBLIC_KEY="$(cat ~/.ssh/id_ed25519.pub)"
#   # opcionais (têm default sensato):
#   export VULTR_REGION=sao                          # São Paulo
#   export VULTR_PLAN=vc2-2c-4gb                      # 2 vCPU / 4GB RAM
#   export VULTR_LABEL=zapscript-coolify
#   ./vultr-provision.sh
#
# Requisitos locais: curl, jq
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="https://api.vultr.com/v2"

: "${VULTR_API_KEY:?Defina VULTR_API_KEY (my.vultr.com → Account → API)}"
VULTR_REGION="${VULTR_REGION:-sao}"
VULTR_PLAN="${VULTR_PLAN:-vc2-2c-4gb}"
VULTR_LABEL="${VULTR_LABEL:-zapscript-coolify}"

command -v curl >/dev/null || { echo "❌ curl não encontrado"; exit 1; }
command -v jq   >/dev/null || { echo "❌ jq não encontrado (apt install jq / brew install jq)"; exit 1; }

api() { # api METHOD PATH [BODY]
  curl -sS -X "$1" "$API$2" \
    -H "Authorization: Bearer $VULTR_API_KEY" \
    -H "Content-Type: application/json" \
    ${3:+-d "$3"}
}

echo "════════════════════════════════════════════════════════"
echo "  ZapScript — Provisionando VPS Coolify na Vultr"
echo "════════════════════════════════════════════════════════"

# ── 1. Descobrir os_id do Ubuntu 24.04 LTS x64 ─────────────────
echo "[1/5] Buscando imagem Ubuntu 24.04 LTS x64..."
OS_ID=$(api GET "/os" | jq -r '.os[] | select(.name=="Ubuntu 24.04 LTS x64") | .id' | head -1)
[[ -n "$OS_ID" && "$OS_ID" != "null" ]] || { echo "❌ Não achei o os_id do Ubuntu 24.04 LTS x64 na API"; exit 1; }
echo "   os_id=$OS_ID"

# ── 2. Garantir SSH key cadastrada ──────────────────────────────
echo "[2/5] Resolvendo SSH key..."
if [[ -z "${VULTR_SSHKEY_ID:-}" ]]; then
  : "${VULTR_SSH_PUBLIC_KEY:?Defina VULTR_SSHKEY_ID (chave já cadastrada) ou VULTR_SSH_PUBLIC_KEY (conteúdo da .pub)}"
  RESP=$(api POST "/ssh-keys" "$(jq -n --arg name "$VULTR_LABEL" --arg key "$VULTR_SSH_PUBLIC_KEY" \
    '{name:$name, ssh_key:$key}')")
  VULTR_SSHKEY_ID=$(echo "$RESP" | jq -r '.ssh_key.id // empty')
  [[ -n "$VULTR_SSHKEY_ID" ]] || { echo "❌ Falha ao cadastrar SSH key: $RESP"; exit 1; }
  echo "   SSH key cadastrada: $VULTR_SSHKEY_ID"
else
  echo "   Usando SSH key existente: $VULTR_SSHKEY_ID"
fi

# ── 3. Montar cloud-init com o install-coolify.sh embutido ─────
echo "[3/5] Montando cloud-init (instalação do Coolify no primeiro boot)..."
INSTALL_SCRIPT="$SCRIPT_DIR/install-coolify.sh"
[[ -f "$INSTALL_SCRIPT" ]] || { echo "❌ Não achei $INSTALL_SCRIPT"; exit 1; }
INSTALL_B64=$(base64 -w0 "$INSTALL_SCRIPT" 2>/dev/null || base64 "$INSTALL_SCRIPT" | tr -d '\n')

CLOUD_INIT=$(mktemp)
trap 'rm -f "$CLOUD_INIT"' EXIT
cat > "$CLOUD_INIT" <<EOF
#cloud-config
write_files:
  - path: /root/install-coolify.sh
    encoding: b64
    permissions: '0755'
    content: ${INSTALL_B64}
runcmd:
  - [ bash, -c, "/root/install-coolify.sh > /var/log/coolify-install.log 2>&1" ]
EOF
USER_DATA_B64=$(base64 -w0 "$CLOUD_INIT" 2>/dev/null || base64 "$CLOUD_INIT" | tr -d '\n')

# ── 4. Criar a instância ────────────────────────────────────────
echo "[4/5] Criando instância (region=$VULTR_REGION plan=$VULTR_PLAN)..."
BODY=$(jq -n \
  --arg region "$VULTR_REGION" \
  --arg plan "$VULTR_PLAN" \
  --argjson os_id "$OS_ID" \
  --arg label "$VULTR_LABEL" \
  --arg hostname "$VULTR_LABEL" \
  --arg sshkey "$VULTR_SSHKEY_ID" \
  --arg user_data "$USER_DATA_B64" \
  '{region:$region, plan:$plan, os_id:$os_id, label:$label, hostname:$hostname,
    sshkey_id:[$sshkey], backups:"disabled", enable_ipv6:true, user_data:$user_data,
    tags:["zapscript","coolify"]}')

RESP=$(api POST "/instances" "$BODY")
INSTANCE_ID=$(echo "$RESP" | jq -r '.instance.id // empty')
[[ -n "$INSTANCE_ID" ]] || { echo "❌ Falha ao criar instância: $RESP"; exit 1; }
echo "   Instância criada: $INSTANCE_ID"

# ── 5. Esperar ficar ativa e pegar o IP ─────────────────────────
echo "[5/5] Aguardando provisionamento..."
for i in $(seq 1 60); do
  INFO=$(api GET "/instances/$INSTANCE_ID")
  STATUS=$(echo "$INFO" | jq -r '.instance.status')
  IP=$(echo "$INFO" | jq -r '.instance.main_ip')
  if [[ "$STATUS" == "active" && "$IP" != "0.0.0.0" ]]; then
    echo ""
    echo "════════════════════════════════════════════════════════"
    echo "✅ Servidor no ar: $IP"
    echo "════════════════════════════════════════════════════════"
    echo "O cloud-init está instalando o Coolify em background (~3-5 min)."
    echo "Acompanhar:  ssh root@$IP 'tail -f /var/log/coolify-install.log'"
    echo "Quando terminar, acesse:  http://$IP:8000"
    echo ""
    echo "Não esqueça de criar o registro DNS (ex.: coolify.zapscript.me → $IP)"
    echo "manualmente no painel da Vercel — não existe API/ferramenta disponível"
    echo "aqui para automatizar essa parte (ver README.md, seção 3)."
    exit 0
  fi
  sleep 5
done

echo "⚠️  Instância criada (id=$INSTANCE_ID) mas ainda não apareceu como 'active'"
echo "   depois de 5 minutos. Verifique no painel: https://my.vultr.com/"
