#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Bootstrap do Evolution API num VPS Oracle OCI (Ubuntu 22.04, ARM ou x86).
# Faz: abre o firewall do SO (gotcha da OCI) → instala Docker → sobe a stack.
# Rode UMA vez, dentro da pasta deploy/evolution-oci, já com o .env preenchido:
#   chmod +x setup.sh && ./setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "❌ Arquivo .env não encontrado. Rode: cp .env.example .env  e preencha." >&2
  exit 1
fi

echo "▶ 1/3 — Abrindo portas 80/443 no firewall do Ubuntu (camada do SO da OCI)…"
# A imagem Ubuntu da OCI vem com uma regra REJECT no iptables que bloqueia tudo.
# Inserimos ACCEPT para 80/443 ANTES dessa regra e persistimos.
sudo iptables -C INPUT -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null \
  || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null \
  || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq netfilter-persistent iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save
echo "  ✅ Firewall do SO liberado e salvo."

echo "▶ 2/3 — Instalando Docker (se necessário)…"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "  ✅ Docker instalado. (O grupo 'docker' vale após relogar; usaremos sudo agora.)"
else
  echo "  ✅ Docker já instalado."
fi

echo "▶ 3/3 — Subindo a stack do Evolution…"
sudo docker compose pull
sudo docker compose up -d
echo
echo "✅ Pronto. Acompanhe o SSL:  sudo docker compose logs -f caddy"
echo "   Quando aparecer 'certificate obtained', acesse: https://$(grep -E '^DOMAIN=' .env | cut -d= -f2)"
