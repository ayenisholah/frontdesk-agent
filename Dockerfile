# syntax=docker/dockerfile:1.7
# Frontdesk API image. Built in CI with VCS_REF=<full git sha>; the deploy script refuses
# an image whose revision label doesn't match the SHA it was asked to deploy.

FROM node:25-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY infra/package.json infra/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/
COPY packages/runtime/package.json packages/runtime/
COPY packages/agent/package.json packages/agent/
COPY packages/channels/package.json packages/channels/
COPY packages/db/package.json packages/db/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages
COPY scripts/build-api.mjs scripts/build-api.mjs
RUN npm run db:generate
RUN npm run build

FROM node:25-alpine AS deps
WORKDIR /app
COPY --from=build /src/package.json /src/package-lock.json ./
COPY --from=build /src/infra/package.json infra/
COPY --from=build /src/apps/api/package.json apps/api/
COPY --from=build /src/apps/worker/package.json apps/worker/
COPY --from=build /src/apps/dashboard/package.json apps/dashboard/
COPY --from=build /src/packages/core/package.json packages/core/
COPY --from=build /src/packages/runtime/package.json packages/runtime/
COPY --from=build /src/packages/agent/package.json packages/agent/
COPY --from=build /src/packages/channels/package.json packages/channels/
COPY --from=build /src/packages/db/package.json packages/db/
RUN npm ci --omit=dev --ignore-scripts -w @frontdesk/api -w @frontdesk/worker && npm cache clean --force

FROM build AS migration-runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="frontdesk-migrate" \
      org.opencontainers.image.revision="${VCS_REF}"
ENV NODE_ENV=production NODE_EXTRA_CA_CERTS=/app/certs/rds-eu-west-1.crt
COPY certs/rds-eu-west-1.crt /app/certs/rds-eu-west-1.crt
WORKDIR /src/packages/db
USER node
CMD ["node", "--import", "tsx", "scripts/prepare-runtime.ts"]

FROM node:25-alpine AS worker-runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="frontdesk-worker" \
      org.opencontainers.image.revision="${VCS_REF}"
ENV NODE_ENV=production WORKER_PORT=3111 RELEASE_SHA=${VCS_REF}
WORKDIR /app
ENV NODE_EXTRA_CA_CERTS=/app/certs/rds-eu-west-1.crt
COPY certs/rds-eu-west-1.crt ./certs/rds-eu-west-1.crt
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /src/apps/worker/dist ./dist
COPY --from=build /src/apps/worker/package.json ./package.json
USER node
EXPOSE 3111
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.WORKER_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/start.js"]

FROM node:25-alpine AS runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="frontdesk-api" \
      org.opencontainers.image.source="https://github.com/ayenisholah/frontdesk-agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${VCS_REF}"
ENV NODE_ENV=production PORT=3110 RELEASE_SHA=${VCS_REF}
WORKDIR /app
ENV NODE_EXTRA_CA_CERTS=/app/certs/rds-eu-west-1.crt
COPY certs/rds-eu-west-1.crt ./certs/rds-eu-west-1.crt
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /src/apps/api/dist ./dist
COPY --from=build --chown=root:root /src/apps/api/package.json ./package.json
USER node
EXPOSE 3110
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
