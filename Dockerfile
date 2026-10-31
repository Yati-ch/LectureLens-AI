# LectureLens AI runtime: Node.js plus the media/PDF utilities used by processing.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

# These tools are invoked by server.mjs when processing uploaded lecture files.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       ffmpeg \
       poppler-utils \
       libreoffice-impress \
       libreoffice-writer \
       fonts-dejavu-core \
       fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The app uses Node built-ins; there are no runtime npm dependencies to install.
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public

RUN mkdir -p /app/data/files \
    && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--env-file-if-exists=.env", "server.mjs"]
