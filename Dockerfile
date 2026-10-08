# PlanB: one container for the API, MCP endpoint and web client.
# Data (SQLite database + image/drawing assets) lives in the /data volume, never in the image.

FROM node:22-bookworm-slim AS build
# Toolchain for native modules (better-sqlite3) when no prebuilt binary matches the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# Fonts are needed to render storyboard text into PNG previews; tar is used by backup/restore.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig tar ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PLANB_DATA_DIR=/data \
    PLANB_STATIC_DIR=/app/dist/client \
    PLANB_HOST=0.0.0.0 \
    PLANB_PORT=8787
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY docs ./docs
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.js"]
