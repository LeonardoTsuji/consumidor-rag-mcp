FROM node:24-bookworm-slim AS workspace
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@12.11.2
WORKDIR /app
COPY . .
RUN chmod 644 pnpm-lock.yaml
RUN pnpm install --frozen-lockfile && pnpm build

FROM workspace AS api
ENV API_HOST=0.0.0.0 DATA_DIR=/app/data/runtime API_PORT=3001
RUN mkdir -p /app/data/runtime && chown -R node:node /app/data/runtime
USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "apps/api/src/docker-start.ts"]

FROM workspace AS mcp
USER node
ENTRYPOINT ["node", "--import", "tsx", "apps/mcp/src/main.ts"]

FROM nginx:1.28-alpine AS web
COPY --from=workspace /app/apps/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
