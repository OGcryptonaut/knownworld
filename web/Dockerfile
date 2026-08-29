# Knownworld web dashboard — Next.js standalone build for Cloud Run.
# Build context is web/ (deploy.sh runs `gcloud run deploy --source web/`).

# --- builder ------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runner -------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# output:'standalone' (next.config.ts) emits a self-contained server.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

# Cloud Run injects PORT; the standalone server honors PORT + HOSTNAME.
ENV PORT=8080 \
    HOSTNAME=0.0.0.0
EXPOSE 8080

CMD ["node", "server.js"]
