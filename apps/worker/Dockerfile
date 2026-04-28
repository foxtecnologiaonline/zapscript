# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Prisma schema (needed for prisma generate during build)
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma       ./packages/database/prisma

# Worker package + source
COPY apps/worker/package.json       ./apps/worker/
COPY apps/worker/tsconfig.json      ./apps/worker/
COPY apps/worker/src                ./apps/worker/src

# Install ALL deps (including devDeps: typescript, prisma CLI)
RUN cd apps/worker && npm install

# Build: prisma generate + tsc
RUN cd apps/worker && npm run build

# ── Production stage ──────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# FFmpeg required for audio conversion
RUN apk add --no-cache ffmpeg

# Prisma schema
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma       ./packages/database/prisma

# Worker package
COPY apps/worker/package.json       ./apps/worker/

# Install production deps only
RUN cd apps/worker && npm install --omit=dev

# Copy compiled JS from build stage
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# Copy generated Prisma client from build stage (avoids re-generating)
COPY --from=builder /app/apps/worker/node_modules/.prisma \
                    ./apps/worker/node_modules/.prisma
COPY --from=builder /app/apps/worker/node_modules/@prisma/client \
                    ./apps/worker/node_modules/@prisma/client

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "const Redis=require('ioredis');const r=new Redis(process.env.REDIS_URL||'redis://localhost:6379',{maxRetriesPerRequest:1});r.ping().then(()=>r.quit()).then(()=>process.exit(0)).catch(()=>process.exit(1))" || exit 1

CMD ["node", "apps/worker/dist/index.js"]
