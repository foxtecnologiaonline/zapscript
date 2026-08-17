#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Bootstrap da API + Worker num VPS Oracle OCI (Ubuntu 22.04, ARM A1.Flex —
# Always Free). Redis é o Upstash free tier (fora da VM — ver README). Builda
# as imagens NA PRÓPRIA VM (a A1.Flex tem RAM de sobra pra isso) em vez de
# puxar do ghcr.io, porque as imagens publicadas lá hoje são só amd64 (ver
# .github/workflows/build-and-push.yml) — não rodam no ARM da OCI sem build
# multi-arch, que este script não pressupõe.
#
# Rode UMA vez, a partir da RAIZ do repo clonado (não de dentro desta pasta):
#   git clone https://github.com/foxtecnologiaonline/zapscript.git
#   cd zapscript
#   cp .env.example .env && nano .env   # preencher os segredos (incl. REDIS_URL do Upstash)
#   chmod +x deploy/oci-backend/setup.sh && ./deploy/oci-backend/setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/../.."   # volta pra raiz do repo

# --env-file explícito: por padrão o Compose procura o .env na pasta do
# arquivo -f (deploy/oci-backend/), não na raiz do repo — sem isso, ${DOMAIN}
# fica em branco dentro do docker-compose.yml.
COMPOSE="docker compose -f deploy/oci-backend/docker-compose.yml --env-file .env"

if [[ ! -f .env ]]; then
  echo "❌ .env não encontrado na raiz do repo. Rode: cp .env.example .env  e preencha." >&2
  exit 1
fi

if ! grep -q '^DOMAIN=' .env; then
  echo "❌ Falta DOMAIN no .env (necessário pro Caddy emitir o certificado)." >&2
  exit 1
fi

if ! grep -Eq '^REDIS_URL=rediss?://' .env; then
  echo "❌ REDIS_URL ausente ou não parece uma URL do Upstash (rediss://...). Crie um" >&2
  echo "   banco grátis em upstash.com e cole a connection string no .env antes de continuar." >&2
  exit 1
fi

echo "▶ 1/4 — Abrindo portas 80/443 no firewall do Ubuntu (camada do SO da OCI)…"
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
echo "  ⚠️  Lembre-se: isso libera só a camada do SO. As portas 80/443 também"
echo "     precisam estar liberadas na Security List da VCN (console OCI)."

echo "▶ 2/4 — Instalando Docker (se necessário)…"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "  ✅ Docker instalado. (O grupo 'docker' vale após relogar; usaremos sudo agora.)"
else
  echo "  ✅ Docker já instalado."
fi

echo "▶ 3/4 — Buildando as imagens (API + Worker) na própria VM — pode levar alguns minutos…"
sudo $COMPOSE build

echo "▶ 4/4 — Subindo a stack (API → Worker → Caddy; Redis é o Upstash, fora da VM)…"
sudo $COMPOSE up -d api
sudo $COMPOSE up -d worker
sudo $COMPOSE up -d caddy

echo
echo "✅ Pronto. Acompanhe o SSL:  sudo $COMPOSE logs -f caddy"
echo "   Quando aparecer 'certificate obtained', teste:"
echo "   curl https://$(grep -E '^DOMAIN=' .env | cut -d= -f2)/health"
echo
echo "⚠️  Não esqueça de apontar o DNS de \$DOMAIN pra este IP e, se for"
echo "   substituir a api.zapscript.me antiga, atualizar o registro A dela."
