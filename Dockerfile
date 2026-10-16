FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY src ./src

RUN useradd --create-home --uid 10001 appuser \
  && mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache \
  && chown -R appuser:appuser /app

USER appuser

VOLUME ["/app/.wwebjs_auth", "/app/.wwebjs_cache"]

CMD ["node", "src/index.js"]
