#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ZapScript — Setup automático do VPS Vultr (Ubuntu 22.04)
# Executar como root: bash vultr-setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "════════════════════════════════════════════════════════"
echo "  ZapScript — Setup Vultr São Paulo"
echo "════════════════════════════════════════════════════════"

# ── 1. Sistema ────────────────────────────────────────────────
echo "[1/7] Atualizando sistema..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban nginx certbot python3-certbot-nginx

# ── 2. Docker ─────────────────────────────────────────────────
echo "[2/7] Instalando Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
echo "Docker $(docker --version) instalado ✅"

# ── 3. Firewall ───────────────────────────────────────────────
echo "[3/7] Configurando firewall (UFW)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
ufw --force enable
echo "Firewall ativo ✅"

# ── 4. Fail2ban ───────────────────────────────────────────────
echo "[4/7] Habilitando fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban
echo "Fail2ban ativo ✅"

# ── 5. Diretório da aplicação ─────────────────────────────────
echo "[5/7] Criando diretório /opt/zapscript..."
mkdir -p /opt/zapscript
chmod 700 /opt/zapscript

# ── 6. Nginx ──────────────────────────────────────────────────
echo "[6/7] Configurando Nginx..."
systemctl enable nginx
rm -f /etc/nginx/sites-enabled/default
echo "Nginx configurado ✅"

# ── 7. Finalizado ─────────────────────────────────────────────
echo "[7/7] Setup concluído ✅"
echo ""
echo "Próximos passos:"
echo "  1. Copie infra/docker-compose.prod.yml → /opt/zapscript/docker-compose.yml"
echo "  2. Crie /opt/zapscript/.env com as variáveis de produção"
echo "  3. Copie infra/nginx-zapscript.conf → /etc/nginx/sites-available/zapscript"
echo "  4. ative: ln -sf /etc/nginx/sites-available/zapscript /etc/nginx/sites-enabled/"
echo "  5. Emita SSL: certbot --nginx -d api.zapscript.me"
echo "  6. Suba os containers: cd /opt/zapscript && docker compose up -d"
echo ""
echo "IP do servidor: $(curl -s ifconfig.me)"
