# The KiloMita measurement server. Build from the repository root:
#   docker build -f apps/server/deploy/Dockerfile .
# Base images are pinned by digest (seen 2026-11-03); update the digest, not just the tag.

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS deps
WORKDIR /app
# Every workspace manifest, so the frozen lockfile matches; only the server's runtime packages are
# installed. bunfig.toml keeps the 7-day release-age rule, and no install scripts run.
COPY package.json bun.lock bunfig.toml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY scripts/package.json scripts/
RUN bun install --frozen-lockfile --production --filter @kilomita/server

FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3940 \
    KILOMITA_SERVER_PROTOCOL=h2c \
    KILOMITA_STATE_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
# Every file main.ts and healthcheck.ts import, and nothing else (image.test.ts checks this list).
COPY apps/server/package.json apps/server/main.ts apps/server/app.ts apps/server/budget.ts \
     apps/server/config.ts apps/server/cors.ts apps/server/log.ts apps/server/ticket.ts \
     apps/server/healthcheck.ts ./apps/server/
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3940
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "apps/server/healthcheck.ts"]
CMD ["node", "apps/server/main.ts"]
