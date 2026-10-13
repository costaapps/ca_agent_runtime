# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

FROM --platform=linux/amd64 ${NODE_IMAGE} AS build-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM --platform=linux/amd64 ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=build-dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN ./node_modules/.bin/tsc --project tsconfig.build.json

FROM --platform=linux/amd64 ${NODE_IMAGE} AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --include=optional --no-audit --no-fund \
    && npm cache clean --force

FROM --platform=linux/amd64 ${NODE_IMAGE} AS runtime
WORKDIR /app

ARG OCI_VERSION=0.2.0
ARG OCI_REVISION=unknown
ARG OCI_SOURCE=https://github.com/costaapps/ca_agent_runtime

ENV NODE_ENV=production \
    PORT=3101

LABEL org.opencontainers.image.title="ca-agent-runtime" \
      org.opencontainers.image.description="Central multi-tenant Costa Apps AgentRuntime" \
      org.opencontainers.image.source=${OCI_SOURCE} \
      org.opencontainers.image.version=${OCI_VERSION} \
      org.opencontainers.image.revision=${OCI_REVISION}

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node drizzle ./drizzle

USER node
EXPOSE 3101

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3101/health/ready', { signal: AbortSignal.timeout(4000) }).then((response) => { if (!response.ok) process.exitCode = 1; }).catch(() => process.exit(1))"]

CMD ["node", "dist/src/server.js"]
