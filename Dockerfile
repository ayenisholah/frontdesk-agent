# syntax=docker/dockerfile:1.7
# Frontdesk API image. Built in CI with VCS_REF=<full git sha>; the deploy script refuses
# an image whose revision label doesn't match the SHA it was asked to deploy.

FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/
COPY packages/agent/package.json packages/agent/
COPY packages/channels/package.json packages/channels/
COPY packages/db/package.json packages/db/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build -w @frontdesk/api

FROM node:24-alpine AS deps
WORKDIR /app
COPY --from=build /src/package.json /src/package-lock.json ./
COPY --from=build /src/apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts -w @frontdesk/api && npm cache clean --force

FROM node:24-alpine AS runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="frontdesk-api" \
      org.opencontainers.image.source="https://github.com/ayenisholah/frontdesk-agent" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${VCS_REF}"
ENV NODE_ENV=production PORT=3110 RELEASE_SHA=${VCS_REF}
WORKDIR /app
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /src/apps/api/dist ./dist
COPY --from=build --chown=root:root /src/apps/api/package.json ./package.json
USER node
EXPOSE 3110
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
