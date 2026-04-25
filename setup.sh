#!/bin/bash
# ══════════════════════════════════════════════════════════════════
#  ZapScript — Setup Automático
#  Roda uma vez após clonar o repositório.
#  Uso: bash setup.sh
# ══════════════════════════════════════════════════════════════════
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${BLUE}→${NC} $1"; }

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      ZapScript — Setup Inicial        ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""

# ── 1. Verificar pré-requisitos ───────────────────────────────────
info "Verificando pré-requisitos..."

NODE_VER=$(node -v 2>/dev/null || echo "none")
if [[ "$NODE_VER" == "none" ]]; then
  err "Node.js não encontrado. Instale em https://nodejs.org (v20 LTS)"
fi
MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
if [ "$MAJOR" -lt 18 ]; then
  err "Node.js v18+ necessário. Versão atual: $NODE_VER"
fi
ok "Node.js $NODE_VER"

if ! command -v pnpm &>/dev/null; then
  info "Instalando pnpm..."
  npm install -g pnpm
fi
ok "pnpm $(pnpm -v)"

if ! command -v ffmpeg &>/dev/null; then
  warn "ffmpeg não encontrado. Instale para converter áudios OGG→MP3"
  echo "     Mac:    brew install ffmpeg"
  echo "     Ubuntu: sudo apt install ffmpeg"
else
  ok "ffmpeg disponível"
fi

# ── 2. Instalar dependências ──────────────────────────────────────
echo ""
info "Instalando dependências..."
pnpm install
ok "Dependências instaladas"

# ── 3. Gerar secrets ─────────────────────────────────────────────
echo ""
info "Gerando segredos criptográficos..."

JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ok "JWT_SECRET e ENCRYPTION_KEY gerados"

# ── 4. Criar .env a partir do template ───────────────────────────
echo ""
if [ -f ".env" ]; then
  warn ".env já existe — pulando criação automática"
else
  info "Criando .env..."
  cp .env.example .env

  # Injetar os secrets gerados automaticamente
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|"           .env
    sed -i '' "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" .env
  else
    sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|"            .env
    sed -i "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" .env
  fi
  ok ".env criado com secrets preenchidos"
fi

# ── 5. Gerar Prisma client ────────────────────────────────────────
echo ""
info "Gerando Prisma client..."
cd packages/database
npx prisma generate
cd ../..
ok "Prisma client gerado"

# ── 6. Criar pasta de sessões WhatsApp ───────────────────────────
mkdir -p .sessions
ok "Pasta .sessions criada"

# ── 7. Verificar .env preenchido ─────────────────────────────────
echo ""
echo -e "${YELLOW}══════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  PRÓXIMOS PASSOS MANUAIS NECESSÁRIOS:${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════${NC}"
echo ""
echo "  Abra o arquivo .env e preencha as seguintes variáveis:"
echo ""
echo "  1. DATABASE_URL     → Supabase → Settings → Database → Connection String"
echo "  2. SUPABASE_URL     → Supabase → Settings → API → Project URL"
echo "  3. SUPABASE_ANON_KEY → Supabase → Settings → API → anon public"
echo "  4. SUPABASE_SERVICE_KEY → Supabase → Settings → API → service_role"
echo "  5. REDIS_URL        → Upstash → Redis → Connect → .env"
echo "  6. OPENAI_API_KEY   → platform.openai.com/api-keys"
echo "  7. ANTHROPIC_API_KEY → console.anthropic.com/api-keys"
echo "  8. STRIPE_*         → Rodar: bash infra/stripe-setup.sh"
echo ""
echo -e "${YELLOW}══════════════════════════════════════════════════${NC}"
echo ""
echo "  Após preencher o .env, rode:"
echo ""
echo -e "    ${GREEN}bash setup.sh --db${NC}    → rodar migrations + seed"
echo -e "    ${GREEN}pnpm dev${NC}              → subir todos os serviços"
echo ""

# ── 8. Rodar DB se flag --db ──────────────────────────────────────
if [[ "$1" == "--db" ]]; then
  echo ""
  info "Rodando migrations no banco..."
  cd packages/database

  # Checar se DATABASE_URL foi preenchido
  source ../../.env 2>/dev/null || true
  if [[ -z "$DATABASE_URL" || "$DATABASE_URL" == *"SUASENHA"* ]]; then
    err "DATABASE_URL não configurado no .env. Preencha antes de rodar --db"
  fi

  npx prisma migrate deploy
  ok "Migrations aplicadas"

  info "Rodando seed dos planos..."
  npx ts-node --project tsconfig.json prisma/seed.ts
  ok "Planos criados (Free, Starter, Pro)"
  cd ../..
fi

echo ""
echo -e "${GREEN}✅ Setup concluído!${NC}"
echo ""
