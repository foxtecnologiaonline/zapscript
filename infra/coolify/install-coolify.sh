#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ZapScript — Instalação do Coolify num VPS Vultr novo (Ubuntu 22.04/24.04)
# Executar como root, no servidor NOVO dedicado ao Coolify: bash install-coolify.sh
#
# O que este script faz:
#   1. Checagens de segurança (root, SO suportado, RAM mínima, portas 80/443 livres)
#   2. Atualiza o sistema e instala pré-requisitos (curl, git, ufw, fail2ban)
#   3. Configura o firewall (UFW) liberando só 22/80/443/8000
#   4. Roda o instalador oficial do Coolify (script mantido pelo próprio projeto)
#   5. Mostra os próximos passos manuais (finalizar setup pelo navegador)
#
# O que este script NÃO faz (de propósito):
#   - Não mexe no servidor de produção atual (216.238.114.73)
#   - Não move DNS, não desliga nada que já está no ar
#   - Não cria os recursos (API/Worker/Redis/Evolution) dentro do Coolify —
#     isso é feito pela UI do Coolify, ver README.md deste diretório
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "════════════════════════════════════════════════════════"
echo "  ZapScript — Instalação do Coolify (Vultr)"
echo "════════════════════════════════════════════════════════"

# ── 0. Checagens de segurança ────────────────────────────────
echo "[0/6] Checagens pré-instalação..."

if [[ $EUID -ne 0 ]]; then
  echo "❌ Rode como root: sudo bash install-coolify.sh"
  exit 1
fi

if ! grep -qiE "ubuntu|debian" /etc/os-release; then
  echo "❌ Este script foi validado em Ubuntu/Debian. SO detectado:"
  cat /etc/os-release | grep PRETTY_NAME
  exit 1
fi

RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
if (( RAM_MB < 1800 )); then
  echo "❌ RAM insuficiente (${RAM_MB}MB). O Coolify recomenda no mínimo 2GB (ideal 4GB+)."
  echo "   Redimensione o plano Vultr antes de continuar."
  exit 1
elif (( RAM_MB < 3800 )); then
  echo "⚠️  RAM = ${RAM_MB}MB. Funciona, mas o Coolify recomenda 4GB+ para folga com builds."
fi

if command -v docker >/dev/null 2>&1; then
  echo "⚠️  Docker já está instalado neste servidor. O instalador do Coolify reaproveita"
  echo "    a instalação existente, mas confirme que não há OUTRA stack usando as portas 80/443"
  echo "    (ex.: nginx, caddy, outro proxy) — o Coolify precisa delas para o proxy próprio (Traefik)."
  read -rp "    Continuar mesmo assim? [y/N] " CONFIRM
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Abortado."; exit 1; }
fi

for PORT in 80 443; do
  if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
    echo "❌ Porta ${PORT} já está em uso neste servidor:"
    ss -tlnp | grep ":${PORT} "
    echo "   O proxy do Coolify (Traefik) precisa das portas 80/443 livres."
    echo "   Se este é o servidor de PRODUÇÃO atual (com nginx/Evolution), pare — use um"
    echo "   servidor novo. Veja a seção 'Decisão: servidor novo vs. existente' no README.md."
    exit 1
  fi
done
echo "✅ Checagens OK (RAM=${RAM_MB}MB, portas 80/443 livres)"

# ── 1. Sistema ────────────────────────────────────────────────
echo "[1/6] Atualizando sistema..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban

# ── 2. Firewall ───────────────────────────────────────────────
echo "[2/6] Configurando firewall (UFW)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
ufw allow 8000/tcp comment 'Coolify dashboard (setup inicial)'
ufw --force enable
echo "Firewall ativo ✅"

# ── 3. Fail2ban ───────────────────────────────────────────────
echo "[3/6] Habilitando fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban
echo "Fail2ban ativo ✅"

# ── 4. Instalador oficial do Coolify ─────────────────────────
echo "[4/6] Instalando Coolify (script oficial coollabsio/coolify)..."
curl -fsSL https://cdn.coollabs.io/coolify/install.sh -o /tmp/coolify-install.sh
echo "   Script baixado. Revise antes de rodar se quiser: cat /tmp/coolify-install.sh"
bash /tmp/coolify-install.sh

# ── 5. Status ─────────────────────────────────────────────────
echo "[5/6] Verificando containers do Coolify..."
sleep 5
docker ps --filter "name=coolify" --format "table {{.Names}}\t{{.Status}}"

# ── 6. Finalizado ─────────────────────────────────────────────
IP=$(curl -s ifconfig.me || echo "SEU_IP")
echo "[6/6] Instalação concluída ✅"
echo ""
echo "════════════════════════════════════════════════════════"
echo "Próximos passos (manuais, pelo navegador):"
echo "  1. Acesse: http://${IP}:8000"
echo "  2. Crie o usuário admin do Coolify (primeiro acesso)"
echo "  3. Aponte o DNS do domínio que vai usar (ex.: coolify.zapscript.me) para ${IP}"
echo "     e configure esse domínio nas Settings do Coolify para ter HTTPS na própria UI"
echo "  4. Siga o README.md deste diretório para criar o projeto 'zapscript' e os recursos"
echo "════════════════════════════════════════════════════════"
