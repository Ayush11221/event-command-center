FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
ARG FRONTEND_ORIGIN=https://127.0.0.1:8443
ENV VITE_API_ORIGIN=$FRONTEND_ORIGIN
RUN npm run build --workspace frontend
FROM caddy:2.11-alpine@sha256:881bbc60f9986d5ab8e7cfd6cf7e4ef3c9c0439fef2429d035d065577882f028
COPY --from=build /app/frontend/dist /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/Caddyfile.railway /etc/caddy/Caddyfile.railway
COPY docker/frontend-entry.sh /usr/local/bin/frontend-entry.sh
RUN setcap -r /usr/bin/caddy && chown -R 1000:1000 /data /config
USER 1000:1000
EXPOSE 8443
CMD ["sh", "/usr/local/bin/frontend-entry.sh"]
