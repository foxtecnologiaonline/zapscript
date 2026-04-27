# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* yarn.lock* package-lock.json* ./
COPY packages/database/package.json ./packages/database/
COPY packages/database/tsconfig.json ./packages/database/

# Install dependencies
RUN npm ci

# Copy source
COPY apps/web ./apps/web
COPY tsconfig.json ./

# Build Next.js
RUN npm run build --workspace=web

# Production stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY package.json pnpm-lock.yaml* yarn.lock* package-lock.json* ./

# Install production dependencies only
RUN npm ci --production

# Copy built application
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY apps/web/package.json ./apps/web/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["npm", "start", "--workspace=web"]
