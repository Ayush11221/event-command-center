FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY database database
COPY backend backend
RUN npm run db:generate && npm run build --workspace backend

FROM build AS migrate
COPY docker/migrate.mjs docker/migrate.mjs
USER node
CMD ["node", "docker/migrate.mjs"]

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn*
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
USER node
EXPOSE 3000
CMD ["node", "--import", "./backend/dist/observability/startup.js", "backend/dist/server.js"]
