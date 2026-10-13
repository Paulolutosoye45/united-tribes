# United Tribes as a container, for a host that is not Vercel (a VPS, Fly, Railway, Render, a church server).
#
#   docker build -t united-tribes \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://unitedtribes.example.org .
#   docker run -p 3000:3000 --env-file .env.production united-tribes
#
# The NEXT_PUBLIC_ values are written into the site when it is built, so they are build arguments, and changing one
# means building again. Everything secret (WORKER_TOKEN, CRON_SECRET, provider keys, DATA_ENCRYPTION_KEYS,
# TURNSTILE_SECRET_KEY) is read when the container starts: pass it with --env-file or the host's secret store, never
# into the image. This container has no scheduler: point one at https://YOUR-SITE/api/cron/tick every 5 minutes with
# the header  Authorization: Bearer <CRON_SECRET>  (docs/OPERATIONS.md).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    BUILD_STANDALONE=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN useradd --system --uid 10001 --no-create-home app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
# Unhealthy when the site or its database cannot be reached (the same answer an uptime monitor reads).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
