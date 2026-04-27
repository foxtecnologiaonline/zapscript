# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* yarn.lock* package-lock.json* ./
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma

# Install dependencies
RUN npm ci

# Copy source
COPY apps/worker ./apps/worker
COPY tsconfig.json ./

# Build
RUN npm run build --workspace=worker

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install FFmpeg (required for audio processing)
RUN apk add --no-cache ffmpeg

# Copy package files
COPY package.json pnpm-lock.yaml* yarn.lock* package-lock.json* ./
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma

# Install production dependencies only
RUN npm ci --production

# Copy built application
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('redis').createClient(process.env.REDIS_URL || 'redis://localhost:6379').ping((err) => {if (err) throw err})" || exit 1

CMD ["node", "apps/worker/dist/index.js"]
