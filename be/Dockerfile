FROM node:20-alpine AS base
RUN apk add --no-cache openssl

# Install deps
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 expressjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

RUN chown -R expressjs:nodejs /app

USER expressjs

EXPOSE 4000

# Regenerate client in-container to guarantee engine matches runtime target, then apply committed migrations.
CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && node dist/index.js"]
